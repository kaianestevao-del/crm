import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  WAMessageStubType,
  WASocket,
  WAMessage,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode";
import pino from "pino";
import { getPrismaClient, MessageDirection, MessageStatus, MessageType, SessionStatus } from "@crm/db";
import { MONTH_NAMES_PT, type OutboundMessageJob, type InboundCloudMessageJob } from "@crm/shared";
import { env } from "../env";
import { publishRealtimeEvent } from "../pubsub";
import { transcribeAudioQueue } from "../queues/transcribe-audio-worker";

const prisma = getPrismaClient();
const logger = pino({ level: "warn" });

// One WASocket instance per WhatsappSession row, kept in memory for the lifetime of the worker process.
const activeSockets = new Map<string, WASocket>();
const reconnecting = new Set<string>();

function sessionDir(sessionId: string) {
  return path.join(env.SESSIONS_DIR, sessionId);
}

function normalizeJid(jid: string) {
  return jid.split(":")[0] + "@" + jid.split("@")[1];
}

export async function startSession(sessionId: string, pairingPhoneNumber?: string): Promise<void> {
  if (activeSockets.has(sessionId)) return;

  const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    console.warn(`session ${sessionId} not found, skipping start`);
    return;
  }
  // A deleted (archived) session must never come back on its own — without this, a Baileys
  // socket that keeps closing with a non-loggedOut code (e.g. a stream conflict from the same
  // number now registered elsewhere) reconnects every 5s forever, even after the row is gone.
  if (session.archivedAt) return;
  // Cloud API sessions have no socket to hold open — they're "connected" the moment valid
  // credentials are saved, and messages flow through the webhook/Graph API instead.
  if (session.provider === "CLOUD_API") return;

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir(sessionId));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    // Ask the phone to replay its full chat history after pairing, instead of only the
    // last handful of messages per chat — so nothing that happened before we connected
    // is missing from the CRM.
    syncFullHistory: true,
  });

  activeSockets.set(sessionId, sock);

  sock.ev.on("creds.update", saveCreds);

  // Baileys' own guidance: request the pairing code only after the first QR event fires (not
  // immediately after creating the socket), and only once per connection attempt.
  let pairingCodeRequested = false;

  sock.ev.on("connection.update", async (update) => {
    // A single failed DB write here (e.g. the session row was deleted while this socket was
    // still live) must never crash the whole worker process — that would drop every other
    // connected session too. Every branch below is independent, so one failing doesn't stop
    // the others from running.
    try {
      const { connection, lastDisconnect, qr } = update;

      if (qr && pairingPhoneNumber && !pairingCodeRequested && !state.creds.registered) {
        pairingCodeRequested = true;
        try {
          const pairingCode = await sock.requestPairingCode(pairingPhoneNumber);
          await prisma.whatsappSession.update({
            where: { id: sessionId },
            data: { status: SessionStatus.PENDING, pairingCode, qrCode: null },
          });
          publishRealtimeEvent({
            type: "session.pairingCode",
            organizationId: session.organizationId,
            sessionId,
            pairingCode,
          });
        } catch (err) {
          console.error(`pairing_code_request_failed:${sessionId}`, err);
        }
      } else if (qr && !pairingPhoneNumber) {
        const qrDataUrl = await qrcode.toDataURL(qr);
        await prisma.whatsappSession.update({
          where: { id: sessionId },
          data: { status: SessionStatus.PENDING, qrCode: qrDataUrl, pairingCode: null },
        });
        publishRealtimeEvent({
          type: "session.qr",
          organizationId: session.organizationId,
          sessionId,
          qr: qrDataUrl,
        });
      }

      if (connection === "open") {
        const phoneNumber = sock.user?.id ? normalizeJid(sock.user.id).split("@")[0] : null;
        await prisma.whatsappSession.update({
          where: { id: sessionId },
          data: { status: SessionStatus.CONNECTED, qrCode: null, pairingCode: null, phoneNumber },
        });
        publishRealtimeEvent({
          type: "session.status",
          organizationId: session.organizationId,
          sessionId,
          status: SessionStatus.CONNECTED,
          phoneNumber,
        });
      }

      if (connection === "close") {
        activeSockets.delete(sessionId);
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        console.error(`session_closed:${sessionId} statusCode=${statusCode} message=${lastDisconnect?.error?.message}`);

        await prisma.whatsappSession.update({
          where: { id: sessionId },
          data: { status: loggedOut ? SessionStatus.LOGGED_OUT : SessionStatus.DISCONNECTED, qrCode: null, pairingCode: null },
        });
        publishRealtimeEvent({
          type: "session.status",
          organizationId: session.organizationId,
          sessionId,
          status: loggedOut ? SessionStatus.LOGGED_OUT : SessionStatus.DISCONNECTED,
        });

        // A QR/pairing code that nobody ever scanned times out with the same statusCode (408)
        // Baileys also uses for "connection dropped mid-session" — without telling these apart,
        // an abandoned pairing attempt reconnects, regenerates a QR, times out, and repeats
        // forever (every 5s, indefinitely) instead of just sitting disconnected until an
        // attendant is ready to actually scan it via "Reiniciar".
        const neverPaired = !state.creds.registered;
        const qrTimedOut = statusCode === DisconnectReason.timedOut || statusCode === DisconnectReason.connectionLost;

        if (loggedOut) {
          await fs.rm(sessionDir(sessionId), { recursive: true, force: true }).catch(() => {});
        } else if (neverPaired && qrTimedOut) {
          console.warn(`session_abandoned_pairing:${sessionId} — not auto-reconnecting, use Reiniciar when ready`);
        } else if (!reconnecting.has(sessionId)) {
          reconnecting.add(sessionId);
          setTimeout(() => {
            reconnecting.delete(sessionId);
            startSession(sessionId).catch((err) => console.error(`reconnect_failed:${sessionId}`, err));
          }, 5000);
        }
      }
    } catch (err) {
      // Most commonly Prisma P2025 ("record not found") if the session row was deleted (or
      // never existed) while this socket was still open — the session is gone, so drop the
      // socket instead of leaving it running against nothing.
      console.error(`connection_update_error:${sessionId}`, err);
      activeSockets.delete(sessionId);
      sock.end(undefined);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      await recordMessage(sessionId, session.organizationId, msg, { isHistorical: false }, sock).catch((err) =>
        console.error("record_message_error", err),
      );
    }
  });

  // WhatsApp replays the full chat history in one or more batches after pairing (only when
  // syncFullHistory is on). Each batch is independent — we just record whatever it contains.
  sock.ev.on("messaging-history.set", async ({ messages }) => {
    for (const msg of messages) {
      await recordMessage(sessionId, session.organizationId, msg, { isHistorical: true }, sock).catch((err) =>
        console.error("record_history_message_error", err),
      );
    }
  });

  // Fires when a message is deleted — including "delete for everyone". We deliberately never
  // touch `content`/`mediaUrl` on our own copy; we only flag it as revoked so the attendant
  // can still read what was sent. Also carries delivery/read receipts for messages we sent
  // (update.status) — without handling those, an outbound message sits at SENT forever in the
  // UI even once the customer's phone confirms delivery or the number turns out unreachable.
  sock.ev.on("messages.update", async (updates) => {
    for (const { key, update } of updates) {
      if (!key.id) continue;

      if (update.messageStubType === WAMessageStubType.REVOKE) {
        try {
          const existing = await prisma.message.findFirst({ where: { waMessageId: key.id } });
          if (!existing || existing.revokedAt) continue;
          const revoked = await prisma.message.update({
            where: { id: existing.id },
            data: { revokedAt: new Date() },
          });
          publishRealtimeEvent({
            type: "message.updated",
            organizationId: session.organizationId,
            conversationId: revoked.conversationId,
            message: revoked,
          });
        } catch (err) {
          console.error("mark_revoked_error", err);
        }
        continue;
      }

      if (update.status != null) {
        await applyMessageStatusUpdate(session.organizationId, key.id, baileysStatusToOurs(update.status)).catch(
          (err) => console.error("apply_message_status_error", err),
        );
      }
    }
  });

  // WhatsApp's own native labels (Business feature). `labels.edit` syncs the label
  // definitions themselves (create/rename/delete); `labels.association` syncs which chats
  // wear which label. Both fire automatically during app-state sync, and again whenever the
  // label is changed from any device — including our own addLabel/addChatLabel calls below.
  sock.ev.on("labels.edit", async (label) => {
    try {
      if (label.deleted) {
        await prisma.whatsappLabel.deleteMany({ where: { whatsappSessionId: sessionId, waLabelId: label.id } });
        return;
      }
      await prisma.whatsappLabel.upsert({
        where: { whatsappSessionId_waLabelId: { whatsappSessionId: sessionId, waLabelId: label.id } },
        update: { name: label.name, color: label.color },
        create: { whatsappSessionId: sessionId, waLabelId: label.id, name: label.name, color: label.color },
      });
    } catch (err) {
      console.error("sync_label_edit_error", err);
    }
  });

  sock.ev.on("labels.association", async ({ association, type }) => {
    if (association.type !== "label_jid") return; // we only track chat-level labels, not per-message ones
    try {
      const [label, contact] = await Promise.all([
        prisma.whatsappLabel.findUnique({
          where: { whatsappSessionId_waLabelId: { whatsappSessionId: sessionId, waLabelId: association.labelId } },
        }),
        prisma.contact.findUnique({
          where: { organizationId_waJid: { organizationId: session.organizationId, waJid: association.chatId } },
        }),
      ]);
      if (!label || !contact) return; // label/contact not known to us yet — nothing to associate

      if (type === "add") {
        await prisma.contactWhatsappLabel.upsert({
          where: { contactId_labelId: { contactId: contact.id, labelId: label.id } },
          update: {},
          create: { contactId: contact.id, labelId: label.id },
        });
      } else {
        await prisma.contactWhatsappLabel.deleteMany({ where: { contactId: contact.id, labelId: label.id } });
      }
      publishRealtimeEvent({ type: "contact.updated", organizationId: session.organizationId, contactId: contact.id });
    } catch (err) {
      console.error("sync_label_association_error", err);
    }
  });
}

export async function addWhatsappLabelToChat(sessionId: string, waJid: string, waLabelId: string) {
  const sock = activeSockets.get(sessionId);
  if (!sock) throw new Error(`session_not_connected:${sessionId}`);
  await sock.addChatLabel(waJid, waLabelId);
}

export async function removeWhatsappLabelFromChat(sessionId: string, waJid: string, waLabelId: string) {
  const sock = activeSockets.get(sessionId);
  if (!sock) throw new Error(`session_not_connected:${sessionId}`);
  await sock.removeChatLabel(waJid, waLabelId);
}

// Best-effort: creating a brand-new label (as opposed to toggling one that already exists)
// relies on WhatsApp accepting a client-generated id, which isn't as thoroughly documented
// as the read path above. Picks the first small integer id (as a string) not already used by
// this session, mirroring how the official apps number their first ~20 custom labels.
export async function createWhatsappLabel(sessionId: string, name: string, color = 0) {
  const sock = activeSockets.get(sessionId);
  if (!sock || !sock.user?.id) throw new Error(`session_not_connected:${sessionId}`);

  const existingIds = new Set(
    (await prisma.whatsappLabel.findMany({ where: { whatsappSessionId: sessionId }, select: { waLabelId: true } })).map(
      (l) => l.waLabelId,
    ),
  );
  let nextId = 1;
  while (existingIds.has(String(nextId)) && nextId < 100) nextId++;

  await sock.addLabel(sock.user.id, { id: String(nextId), name, color, deleted: false });
}

// Baileys only pulls the account's *entire* label set automatically once, right after a fresh
// QR pairing (when it first receives the app-state encryption key). A plain reconnect — or
// pairing while a duplicate worker process is also racing to sync the same account, which is
// what actually happened here — never repeats that full sync, so labels that already existed
// before pairing can end up silently missing. This re-runs that same sync on demand, without
// requiring the user to log out and re-scan a QR code.
export async function resyncLabels(sessionId: string) {
  const sock = activeSockets.get(sessionId);
  if (!sock) throw new Error(`session_not_connected:${sessionId}`);
  await sock.resyncAppState(["critical_block", "critical_unblock_low", "regular_high", "regular_low", "regular"], true);
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function extensionFor(mimetype?: string | null, fileName?: string | null) {
  if (fileName?.includes(".")) return fileName.split(".").pop()!;
  const base = mimetype?.split(";")[0];
  return (base && EXTENSION_BY_MIME[base]) || "bin";
}

async function downloadAndSaveMedia(
  msg: proto.IWebMessageInfo,
  sock: WASocket,
): Promise<{ mediaUrl: string; absoluteMediaUrl: string; mediaName?: string } | null> {
  const m = msg.message;
  const mediaMsg = m?.imageMessage ?? m?.audioMessage ?? m?.videoMessage ?? m?.documentMessage;
  if (!mediaMsg || !msg.key?.id) return null;

  try {
    const buffer = (await downloadMediaMessage(msg as WAMessage, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage })) as Buffer;
    const fileName = m?.documentMessage?.fileName ?? undefined;
    const ext = extensionFor(mediaMsg.mimetype, fileName);
    const savedName = `${crypto.randomUUID()}.${ext}`;
    const dir = path.join(env.UPLOADS_DIR, "messages");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, savedName), buffer);
    const mediaUrl = `/uploads/messages/${savedName}`;
    return { mediaUrl, absoluteMediaUrl: `${env.PUBLIC_URL}${mediaUrl}`, mediaName: fileName };
  } catch (err) {
    console.error("download_media_failed", err);
    return null;
  }
}

interface NormalizedInboundMessage {
  jid: string;
  phoneNumber: string;
  pushName?: string;
  fromMe: boolean;
  type: MessageType;
  text: string;
  waMessageId: string;
  messageDate: Date;
}

interface RecordMessageHooks {
  // Both optional and best-effort — a provider that can't cheaply supply one (or fails) just
  // means that contact goes without an avatar / that message goes without its media, not a
  // failure of the whole write.
  fetchAvatarUrl?: (jid: string) => Promise<string | null>;
  downloadMedia?: () => Promise<{ mediaUrl: string; absoluteMediaUrl: string } | null>;
}

// The actual Contact/Conversation/Message bookkeeping — arrival-month tagging, avatar, dedupe
// by waMessageId, realtime events, transcription, autoatendimento — is identical no matter
// which WhatsApp provider the message came from. Baileys' recordMessage() and the Cloud API's
// processInboundCloudMessage() both normalize their own payload shape and call this.
async function upsertContactAndRecordMessage(
  sessionId: string,
  organizationId: string,
  msg: NormalizedInboundMessage,
  opts: { isHistorical: boolean },
  hooks: RecordMessageHooks = {},
) {
  const { jid, phoneNumber, pushName, fromMe, type, text, waMessageId, messageDate } = msg;

  const existingContact = await prisma.contact.findUnique({
    where: { organizationId_waJid: { organizationId, waJid: jid } },
    select: { id: true },
  });

  const contact = await prisma.contact.upsert({
    where: { organizationId_waJid: { organizationId, waJid: jid } },
    update: pushName && !fromMe ? { name: pushName } : {},
    create: { organizationId, waJid: jid, phoneNumber, name: fromMe ? undefined : pushName },
  });

  // First time we ever see this contact — tag with the month/year they arrived, independent
  // of autoatendimento (which only tags by keyword match). Lets the Dashboard/Contatos view
  // group leads by when they first showed up without relying on manual tagging.
  if (!existingContact) {
    await tagContactWithArrivalMonth(organizationId, contact.id, messageDate).catch((err) =>
      console.error("arrival_month_tag_error", err),
    );
  }

  // Fetch the profile photo once, the first time we see this contact — avoids hammering the
  // provider on every single message for a photo that rarely changes.
  if (!contact.avatarUrl && hooks.fetchAvatarUrl) {
    try {
      const avatarUrl = await hooks.fetchAvatarUrl(jid);
      if (avatarUrl) {
        await prisma.contact.update({ where: { id: contact.id }, data: { avatarUrl } });
        contact.avatarUrl = avatarUrl;
      }
    } catch {
      // No photo set, or privacy settings hide it — leave avatarUrl null.
    }
  }

  const conversation = await prisma.conversation.upsert({
    where: { whatsappSessionId_contactId: { whatsappSessionId: sessionId, contactId: contact.id } },
    // status: "OPEN" un-hides a conversation the attendant "deleted" (soft-closed) from the
    // inbox — a real inbound message means it belongs back in the list.
    update:
      !opts.isHistorical && !fromMe
        ? { lastMessageAt: messageDate, unreadCount: { increment: 1 }, status: "OPEN" }
        : {},
    create: {
      organizationId,
      whatsappSessionId: sessionId,
      contactId: contact.id,
      lastMessageAt: messageDate,
      unreadCount: !opts.isHistorical && !fromMe ? 1 : 0,
    },
  });

  // History arrives newest-batch-first in some cases; never let an older message regress
  // the conversation's "last activity" timestamp shown in the inbox list.
  if (messageDate > conversation.lastMessageAt) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: messageDate } });
  }

  const existing = await prisma.message.findUnique({
    where: { conversationId_waMessageId: { conversationId: conversation.id, waMessageId } },
  });
  if (existing) return; // already recorded (live message arriving again in a history batch, etc.)

  let mediaUrl: string | null = null;
  let absoluteMediaUrl: string | null = null;
  if (
    hooks.downloadMedia &&
    (type === MessageType.IMAGE || type === MessageType.AUDIO || type === MessageType.VIDEO || type === MessageType.DOCUMENT)
  ) {
    const downloaded = await hooks.downloadMedia();
    if (downloaded) {
      mediaUrl = downloaded.mediaUrl;
      absoluteMediaUrl = downloaded.absoluteMediaUrl;
    }
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: fromMe ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
      type,
      content: text || null,
      mediaUrl,
      waMessageId,
      status: fromMe ? MessageStatus.SENT : MessageStatus.DELIVERED,
      createdAt: messageDate,
    },
  });

  if (!opts.isHistorical) {
    publishRealtimeEvent({ type: "message.new", organizationId, conversationId: conversation.id, message });
    publishRealtimeEvent({ type: "conversation.updated", organizationId, conversationId: conversation.id });
  }

  if (type === MessageType.AUDIO && absoluteMediaUrl) {
    await transcribeAudioQueue
      .add("transcribe", { organizationId, messageId: message.id, mediaUrl: absoluteMediaUrl })
      .catch((err) => console.error("enqueue_transcription_failed", err));
  }

  // Autoatendimento here means auto-tagging, not auto-replying: a keyword in a live inbound
  // message links the contact to one or more Abas (e.g. to record which ad/story/bio link a
  // lead came from). Nothing is ever sent back to the contact, and history-sync replay never
  // triggers it (it would otherwise re-tag every contact off their oldest messages).
  if (!opts.isHistorical && !fromMe) {
    await maybeAutoTag(organizationId, contact.id, text).catch((err) => console.error("auto_tag_error", err));
  }
}

async function recordMessage(
  sessionId: string,
  organizationId: string,
  msg: proto.IWebMessageInfo,
  opts: { isHistorical: boolean },
  sock: WASocket,
) {
  const key = msg.key;
  if (!msg.message || !key?.id) return;
  const jid = key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return;

  const type = detectMessageType(msg);
  const text =
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    msg.message.imageMessage?.caption ??
    msg.message.videoMessage?.caption ??
    "";

  await upsertContactAndRecordMessage(
    sessionId,
    organizationId,
    {
      jid,
      phoneNumber: jid.split("@")[0],
      pushName: msg.pushName ?? undefined,
      fromMe: !!key.fromMe,
      type,
      text,
      waMessageId: key.id,
      messageDate: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date(),
    },
    opts,
    {
      fetchAvatarUrl: async (j) => (await sock.profilePictureUrl(j, "image")) ?? null,
      downloadMedia: () => downloadAndSaveMedia(msg, sock),
    },
  );
}

// Strips accents so a keyword like "preco" also matches "preço" — Portuguese customers
// type diacritics inconsistently, and a plain case-insensitive compare misses that.
function foldAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

async function maybeAutoTag(organizationId: string, contactId: string, text: string) {
  if (!text) return;

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org?.autoTaggingEnabled) return;

  const normalized = foldAccents(text.toLowerCase());
  const rules = await prisma.autoTagRule.findMany({
    where: { organizationId, isActive: true },
    orderBy: { order: "asc" },
    include: { tags: true },
  });
  const matched = rules.find((rule) => rule.keywords.some((keyword) => normalized.includes(foldAccents(keyword.toLowerCase()))));
  if (!matched || matched.tags.length === 0) return;

  await prisma.contactTag.createMany({
    data: matched.tags.map((t) => ({ contactId, tagId: t.tagId })),
    skipDuplicates: true,
  });

  publishRealtimeEvent({ type: "contact.updated", organizationId, contactId });
}

// Tags a brand-new contact with the month/year they first showed up (e.g. "Setembro/2026"),
// so leads can be grouped by arrival cohort without relying on autoatendimento (keyword-only,
// and off by default). Same tag-name convention as the WaSpeed export this org migrated from.
async function tagContactWithArrivalMonth(organizationId: string, contactId: string, date: Date) {
  const tagName = `${MONTH_NAMES_PT[date.getMonth()]}/${date.getFullYear()}`;
  const tag = await prisma.tag.upsert({
    where: { organizationId_name: { organizationId, name: tagName } },
    update: {},
    create: { organizationId, name: tagName },
  });
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    update: {},
    create: { contactId, tagId: tag.id },
  });
  publishRealtimeEvent({ type: "contact.updated", organizationId, contactId });
}

function detectMessageType(msg: proto.IWebMessageInfo): MessageType {
  const m = msg.message;
  if (!m) return MessageType.UNKNOWN;
  if (m.conversation || m.extendedTextMessage) return MessageType.TEXT;
  if (m.imageMessage) return MessageType.IMAGE;
  if (m.audioMessage) return MessageType.AUDIO;
  if (m.videoMessage) return MessageType.VIDEO;
  if (m.documentMessage) return MessageType.DOCUMENT;
  if (m.stickerMessage) return MessageType.STICKER;
  return MessageType.UNKNOWN;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ogg: "audio/ogg; codecs=opus",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function guessMimeType(name?: string): string {
  const ext = name?.split(".").pop()?.toLowerCase();
  return (ext && MIME_BY_EXTENSION[ext]) || "application/octet-stream";
}

// Shared by both providers' delivery-receipt handling below. Never lets a status regress
// (e.g. a late-arriving DELIVERY_ACK after we've already seen READ) except FAILED, which always
// wins since Meta/WhatsApp reporting a real failure matters regardless of ordering.
const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  [MessageStatus.PENDING]: 0,
  [MessageStatus.SENT]: 1,
  [MessageStatus.DELIVERED]: 2,
  [MessageStatus.READ]: 3,
  [MessageStatus.FAILED]: 4,
};

function baileysStatusToOurs(status: number): MessageStatus {
  switch (status) {
    case proto.WebMessageInfo.Status.DELIVERY_ACK:
      return MessageStatus.DELIVERED;
    case proto.WebMessageInfo.Status.READ:
    case proto.WebMessageInfo.Status.PLAYED:
      return MessageStatus.READ;
    case proto.WebMessageInfo.Status.ERROR:
      return MessageStatus.FAILED;
    default:
      return MessageStatus.SENT;
  }
}

async function applyMessageStatusUpdate(organizationId: string, waMessageId: string, status: MessageStatus) {
  const existing = await prisma.message.findFirst({ where: { waMessageId, direction: MessageDirection.OUTBOUND } });
  if (!existing || existing.status === status) return;
  if (MESSAGE_STATUS_RANK[status] <= MESSAGE_STATUS_RANK[existing.status]) return;

  const updated = await prisma.message.update({ where: { id: existing.id }, data: { status } });
  publishRealtimeEvent({
    type: "message.updated",
    organizationId,
    conversationId: updated.conversationId,
    message: updated,
  });
}

const CLOUD_API_BASE = "https://graph.facebook.com/v21.0";

async function sendCloudApiMessage(
  job: OutboundMessageJob,
  session: { cloudApiPhoneNumberId: string; cloudApiAccessToken: string },
) {
  const to = job.waJid.split("@")[0];
  let payload: Record<string, unknown>;

  if (job.mediaType === "IMAGE" && job.mediaUrl) {
    payload = { type: "image", image: { link: job.mediaUrl, caption: job.text } };
  } else if (job.mediaType === "VIDEO" && job.mediaUrl) {
    payload = { type: "video", video: { link: job.mediaUrl, caption: job.text } };
  } else if (job.mediaType === "AUDIO" && job.mediaUrl) {
    payload = { type: "audio", audio: { link: job.mediaUrl } };
  } else if (job.mediaType === "DOCUMENT" && job.mediaUrl) {
    payload = { type: "document", document: { link: job.mediaUrl, filename: job.mediaName ?? "arquivo", caption: job.text } };
  } else {
    payload = { type: "text", text: { body: job.text ?? "" } };
  }

  const res = await fetch(`${CLOUD_API_BASE}/${session.cloudApiPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.cloudApiAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
  });
  const data = (await res.json()) as { messages?: { id: string }[] };
  if (!res.ok) throw new Error(`cloud_api_send_failed:${JSON.stringify(data)}`);

  return data.messages?.[0]?.id;
}

// Deliberately two separate try/catches: only a failure in the network call above means the
// message never reached the customer, so only that one is allowed to mark the message FAILED
// (and let the caller retry). Once WhatsApp/Meta has accepted the send, a hiccup persisting the
// result (a DB blip) must never look like a send failure — retrying from there would resend a
// message the customer already received, which is worse than an attendant seeing a stale ✓.
export async function sendOutboundMessage(job: OutboundMessageJob) {
  const session = await prisma.whatsappSession.findUniqueOrThrow({ where: { id: job.sessionId } });
  let waMessageId: string | undefined;

  try {
    if (session.provider === "CLOUD_API") {
      if (!session.cloudApiPhoneNumberId || !session.cloudApiAccessToken) {
        throw new Error(`cloud_api_not_configured:${job.sessionId}`);
      }
      waMessageId = await sendCloudApiMessage(job, {
        cloudApiPhoneNumberId: session.cloudApiPhoneNumberId,
        cloudApiAccessToken: session.cloudApiAccessToken,
      });
    } else {
      const sock = activeSockets.get(job.sessionId);
      if (!sock) throw new Error(`session_not_connected:${job.sessionId}`);

      const mimetype = guessMimeType(job.mediaName ?? job.mediaUrl);
      let content: Parameters<WASocket["sendMessage"]>[1];

      if (job.mediaType === "IMAGE" && job.mediaUrl) {
        content = { image: { url: job.mediaUrl }, mimetype, caption: job.text };
      } else if (job.mediaType === "VIDEO" && job.mediaUrl) {
        content = { video: { url: job.mediaUrl }, mimetype, caption: job.text };
      } else if (job.mediaType === "AUDIO" && job.mediaUrl) {
        // WhatsApp audio messages don't support a caption, so the signature (folded into `text`
        // by the API) is dropped here — there is nowhere for it to be shown.
        content = { audio: { url: job.mediaUrl }, mimetype, ptt: false };
      } else if (job.mediaType === "DOCUMENT" && job.mediaUrl) {
        content = { document: { url: job.mediaUrl }, mimetype, fileName: job.mediaName ?? "arquivo", caption: job.text };
      } else {
        content = { text: job.text ?? "" };
      }

      const result = await sock.sendMessage(job.waJid, content);
      waMessageId = result?.key.id ?? undefined;
    }
  } catch (err) {
    const failed = await prisma.message.update({ where: { id: job.messageId }, data: { status: MessageStatus.FAILED } });
    publishRealtimeEvent({
      type: "message.updated",
      organizationId: job.organizationId,
      conversationId: job.conversationId,
      message: failed,
    });
    throw err;
  }

  try {
    const updated = await prisma.message.update({
      where: { id: job.messageId },
      data: { status: MessageStatus.SENT, waMessageId },
    });
    publishRealtimeEvent({
      type: "message.updated",
      organizationId: job.organizationId,
      conversationId: job.conversationId,
      message: updated,
    });
  } catch (err) {
    console.error("record_sent_message_failed", err);
  }

  if (job.mediaType === "AUDIO" && job.mediaUrl) {
    await transcribeAudioQueue
      .add("transcribe", { organizationId: job.organizationId, messageId: job.messageId, mediaUrl: job.mediaUrl })
      .catch((err) => console.error("enqueue_transcription_failed", err));
  }
}

function detectCloudMessageType(type: string): MessageType {
  switch (type) {
    case "image":
      return MessageType.IMAGE;
    case "video":
      return MessageType.VIDEO;
    case "audio":
      return MessageType.AUDIO;
    case "document":
      return MessageType.DOCUMENT;
    default:
      return MessageType.TEXT;
  }
}

async function downloadCloudApiMedia(
  mediaId: string,
  accessToken: string,
  mimeType?: string,
  fileName?: string,
): Promise<{ mediaUrl: string; absoluteMediaUrl: string } | null> {
  try {
    // Cloud API media is two-step: resolve the id to a short-lived signed URL, then fetch it —
    // both requests need the same bearer token.
    const metaRes = await fetch(`${CLOUD_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) throw new Error(`media_lookup_failed:${metaRes.status}`);
    const { url } = (await metaRes.json()) as { url: string };

    const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!fileRes.ok) throw new Error(`media_download_failed:${fileRes.status}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const ext = extensionFor(mimeType, fileName);
    const savedName = `${crypto.randomUUID()}.${ext}`;
    const dir = path.join(env.UPLOADS_DIR, "messages");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, savedName), buffer);
    const mediaUrl = `/uploads/messages/${savedName}`;
    return { mediaUrl, absoluteMediaUrl: `${env.PUBLIC_URL}${mediaUrl}` };
  } catch (err) {
    console.error("download_cloud_media_failed", err);
    return null;
  }
}

interface CloudApiMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id: string; caption?: string; mime_type?: string };
  video?: { id: string; caption?: string; mime_type?: string };
  audio?: { id: string; mime_type?: string };
  document?: { id: string; filename?: string; caption?: string; mime_type?: string };
}

interface CloudApiStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  errors?: { title?: string; message?: string }[];
}

interface CloudApiWebhookValue {
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: CloudApiMessage[];
  statuses?: CloudApiStatus[];
}

function cloudStatusToOurs(status: CloudApiStatus["status"]): MessageStatus {
  switch (status) {
    case "delivered":
      return MessageStatus.DELIVERED;
    case "read":
      return MessageStatus.READ;
    case "failed":
      return MessageStatus.FAILED;
    default:
      return MessageStatus.SENT;
  }
}

// Called from the worker's inbound-cloud-messages queue processor — the API's webhook route
// only verifies the request and enqueues the raw `value` object, all the actual writing
// happens here so it goes through the exact same path as every Baileys-sourced message.
export async function processInboundCloudMessage(job: InboundCloudMessageJob) {
  const value = job.payload as CloudApiWebhookValue;

  for (const status of value.statuses ?? []) {
    await applyMessageStatusUpdate(job.organizationId, status.id, cloudStatusToOurs(status.status)).catch((err) =>
      console.error("apply_cloud_message_status_error", err),
    );
    if (status.status === "failed" && status.errors?.length) {
      console.error("cloud_api_message_failed", { waMessageId: status.id, errors: status.errors });
    }
  }

  if (!value.messages?.length) return; // status-only webhook, nothing left to record

  const session = await prisma.whatsappSession.findUniqueOrThrow({ where: { id: job.sessionId } });
  const pushName = value.contacts?.[0]?.profile?.name;

  for (const m of value.messages) {
    const type = detectCloudMessageType(m.type);
    const text = m.text?.body ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? "";
    const mediaRef = m.image ?? m.video ?? m.audio ?? m.document;

    await upsertContactAndRecordMessage(
      job.sessionId,
      job.organizationId,
      {
        // Same jid convention as Baileys (`<digits>@s.whatsapp.net`) so a contact matches
        // regardless of which provider's number they end up messaging.
        jid: `${m.from}@s.whatsapp.net`,
        phoneNumber: m.from,
        pushName,
        fromMe: false, // Meta only ever webhooks the customer's own messages, never our sends
        type,
        text,
        waMessageId: m.id,
        messageDate: new Date(Number(m.timestamp) * 1000),
      },
      { isHistorical: false },
      {
        downloadMedia:
          mediaRef && session.cloudApiAccessToken
            ? () =>
                downloadCloudApiMedia(
                  mediaRef.id,
                  session.cloudApiAccessToken!,
                  mediaRef.mime_type,
                  (mediaRef as { filename?: string }).filename,
                )
            : undefined,
      },
    ).catch((err) => console.error("process_inbound_cloud_message_failed", err));
  }
}

export async function restartSession(sessionId: string) {
  const sock = activeSockets.get(sessionId);
  if (sock) {
    activeSockets.delete(sessionId);
    sock.end(undefined);
  }
  await startSession(sessionId);
}

export async function logoutSession(sessionId: string) {
  const sock = activeSockets.get(sessionId);
  if (sock) {
    activeSockets.delete(sessionId);
    await sock.logout().catch(() => {});
    // Belt and suspenders: `logout()` can fail to fully tear down the transport for a socket
    // that's already in a broken state (e.g. the "Invalid account signature" conflict this
    // number hits once it's also registered on the Cloud API) — without this, the socket's own
    // event listeners (messages.upsert, messaging-history.set, connection.update) can keep
    // firing and writing to the DB for a session that's supposedly gone.
    sock.end(undefined);
    sock.ev.removeAllListeners("connection.update");
    sock.ev.removeAllListeners("messages.upsert");
    sock.ev.removeAllListeners("messaging-history.set");
  }
  await fs.rm(sessionDir(sessionId), { recursive: true, force: true }).catch(() => {});
  await prisma.whatsappSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.LOGGED_OUT, qrCode: null },
  });
}

export function isSessionActive(sessionId: string) {
  return activeSockets.has(sessionId);
}

export async function startAllPersistedSessions() {
  // Cloud API sessions have no persistent socket to (re)start — they just sit there and wait
  // for Meta to call the webhook, so only Baileys sessions go through this.
  const sessions = await prisma.whatsappSession.findMany({
    where: { status: { not: SessionStatus.LOGGED_OUT }, archivedAt: null, provider: "BAILEYS" },
  });
  for (const session of sessions) {
    await startSession(session.id).catch((err) => console.error(`start_session_failed:${session.id}`, err));
  }
}
