import path from "path";
import fs from "fs/promises";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WASocket,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode";
import pino from "pino";
import { getPrismaClient, MessageDirection, MessageStatus, MessageType, SessionStatus } from "@crm/db";
import { env } from "../env";
import { publishRealtimeEvent } from "../pubsub";

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
      await handleIncomingMessage(sessionId, session.organizationId, msg).catch((err) =>
        console.error("handle_incoming_message_error", err),
      );
    }
  });
}

async function handleIncomingMessage(sessionId: string, organizationId: string, msg: proto.IWebMessageInfo) {
  if (!msg.message || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return;

  const text =
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    msg.message.imageMessage?.caption ??
    msg.message.videoMessage?.caption ??
    "";

  const type = detectMessageType(msg);
  const phoneNumber = jid.split("@")[0];
  const pushName = msg.pushName ?? undefined;

  const contact = await prisma.contact.upsert({
    where: { organizationId_waJid: { organizationId, waJid: jid } },
    update: pushName ? { name: pushName } : {},
    create: { organizationId, waJid: jid, phoneNumber, name: pushName },
  });

  const conversation = await prisma.conversation.upsert({
    where: { whatsappSessionId_contactId: { whatsappSessionId: sessionId, contactId: contact.id } },
    update: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
    create: {
      organizationId,
      whatsappSessionId: sessionId,
      contactId: contact.id,
      lastMessageAt: new Date(),
      unreadCount: 1,
    },
  });

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND,
      type,
      content: text || null,
      waMessageId: msg.key.id ?? undefined,
      status: MessageStatus.DELIVERED,
    },
  });

  publishRealtimeEvent({ type: "message.new", organizationId, conversationId: conversation.id, message });
  publishRealtimeEvent({ type: "conversation.updated", organizationId, conversationId: conversation.id });
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
  const sock = activeSockets.get(sessionId);
  if (!sock) throw new Error(`session_not_connected:${sessionId}`);

  try {
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
