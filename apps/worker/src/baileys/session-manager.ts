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
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode";
import pino from "pino";
import { getPrismaClient, MessageDirection, MessageStatus, MessageType, SessionStatus } from "@crm/db";
import type { OutboundMessageJob } from "@crm/shared";
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

export async function startSession(sessionId: string): Promise<void> {
  if (activeSockets.has(sessionId)) return;

  const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    console.warn(`session ${sessionId} not found, skipping start`);
    return;
  }

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

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrDataUrl = await qrcode.toDataURL(qr);
      await prisma.whatsappSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.PENDING, qrCode: qrDataUrl },
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
        data: { status: SessionStatus.CONNECTED, qrCode: null, phoneNumber },
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

      await prisma.whatsappSession.update({
        where: { id: sessionId },
        data: { status: loggedOut ? SessionStatus.LOGGED_OUT : SessionStatus.DISCONNECTED, qrCode: null },
      });
      publishRealtimeEvent({
        type: "session.status",
        organizationId: session.organizationId,
        sessionId,
        status: loggedOut ? SessionStatus.LOGGED_OUT : SessionStatus.DISCONNECTED,
      });

      if (loggedOut) {
        await fs.rm(sessionDir(sessionId), { recursive: true, force: true }).catch(() => {});
      } else if (!reconnecting.has(sessionId)) {
        reconnecting.add(sessionId);
        setTimeout(() => {
          reconnecting.delete(sessionId);
          startSession(sessionId).catch((err) => console.error(`reconnect_failed:${sessionId}`, err));
        }, 5000);
      }
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
  // can still read what was sent.
  sock.ev.on("messages.update", async (updates) => {
    for (const { key, update } of updates) {
      if (update.messageStubType !== WAMessageStubType.REVOKE || !key.id) continue;
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
  if (!mediaMsg) return null;

  try {
    const buffer = (await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage })) as Buffer;
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

async function recordMessage(
  sessionId: string,
  organizationId: string,
  msg: proto.IWebMessageInfo,
  opts: { isHistorical: boolean },
  sock: WASocket,
) {
  if (!msg.message || !msg.key.id) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return;

  const fromMe = !!msg.key.fromMe;
  const type = detectMessageType(msg);
  const text =
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    msg.message.imageMessage?.caption ??
    msg.message.videoMessage?.caption ??
    "";
  const phoneNumber = jid.split("@")[0];
  const pushName = msg.pushName ?? undefined;
  const messageDate = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date();

  const contact = await prisma.contact.upsert({
    where: { organizationId_waJid: { organizationId, waJid: jid } },
    update: pushName && !fromMe ? { name: pushName } : {},
    create: { organizationId, waJid: jid, phoneNumber, name: fromMe ? undefined : pushName },
  });

  const conversation = await prisma.conversation.upsert({
    where: { whatsappSessionId_contactId: { whatsappSessionId: sessionId, contactId: contact.id } },
    update:
      !opts.isHistorical && !fromMe
        ? { lastMessageAt: messageDate, unreadCount: { increment: 1 } }
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
    where: { conversationId_waMessageId: { conversationId: conversation.id, waMessageId: msg.key.id } },
  });
  if (existing) return; // already recorded (live message arriving again in a history batch, etc.)

  let mediaUrl: string | null = null;
  let absoluteMediaUrl: string | null = null;
  if (type === MessageType.IMAGE || type === MessageType.AUDIO || type === MessageType.VIDEO || type === MessageType.DOCUMENT) {
    const downloaded = await downloadAndSaveMedia(msg, sock);
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
      waMessageId: msg.key.id,
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

export async function sendTextMessage(sessionId: string, waJid: string, text: string, messageId?: string) {
  try {
    const sock = activeSockets.get(sessionId);
    if (!sock) throw new Error(`session_not_connected:${sessionId}`);

    const result = await sock.sendMessage(waJid, { text });
    if (messageId) {
      await prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.SENT, waMessageId: result?.key.id ?? undefined },
      });
    }
    return result;
  } catch (err) {
    if (messageId) {
      await prisma.message.update({ where: { id: messageId }, data: { status: MessageStatus.FAILED } });
    }
    throw err;
  }
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

export async function sendOutboundMessage(job: OutboundMessageJob) {
  try {
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
    await prisma.message.update({
      where: { id: job.messageId },
      data: { status: MessageStatus.SENT, waMessageId: result?.key.id ?? undefined },
    });

    if (job.mediaType === "AUDIO" && job.mediaUrl) {
      await transcribeAudioQueue
        .add("transcribe", { organizationId: job.organizationId, messageId: job.messageId, mediaUrl: job.mediaUrl })
        .catch((err) => console.error("enqueue_transcription_failed", err));
    }

    return result;
  } catch (err) {
    await prisma.message.update({ where: { id: job.messageId }, data: { status: MessageStatus.FAILED } });
    throw err;
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
  const sessions = await prisma.whatsappSession.findMany({
    where: { status: { not: SessionStatus.LOGGED_OUT } },
  });
  for (const session of sessions) {
    await startSession(session.id).catch((err) => console.error(`start_session_failed:${session.id}`, err));
  }
}
