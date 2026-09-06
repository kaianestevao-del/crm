import { Request, Response } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { MessageDirection, MessageStatus, MessageType } from "@crm/shared";
import { prisma } from "../../prisma";
import { env } from "../../env";
import { HttpError } from "../../utils/httpError";
import { outboundMessagesQueue } from "../../queues";

export async function listConversations(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const conversations = await prisma.conversation.findMany({
    where: { organizationId },
    include: {
      contact: { include: { tags: { include: { tag: true } }, whatsappLabels: { include: { label: true } } } },
      assignedUser: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  res.json(
    conversations.map(({ contact, ...conversation }) => ({
      ...conversation,
      contact: {
        ...contact,
        tags: contact.tags.map((t) => t.tag),
        whatsappLabels: contact.whatsappLabels.map((l) => l.label),
      },
    })),
  );
}

export async function getOwnedConversation(organizationId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId } });
  if (!conversation) throw new HttpError(404, "conversation_not_found");
  return conversation;
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

const startConversationSchema = z.object({
  phoneNumber: z.string().min(8),
  name: z.string().min(1).optional(),
});

export async function startConversation(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = startConversationSchema.parse(req.body);
  const phoneNumber = normalizePhone(input.phoneNumber);
  if (phoneNumber.length < 8) throw new HttpError(400, "invalid_phone_number");
  const waJid = `${phoneNumber}@s.whatsapp.net`;

  // Must exclude archived sessions — otherwise a deleted-but-not-yet-fully-torn-down Baileys
  // connection (still `status: CONNECTED` in the DB from before it was replaced) can outrank
  // the org's real, current connection since this picks the *oldest* match.
  const session = await prisma.whatsappSession.findFirst({
    where: { organizationId, status: "CONNECTED", archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!session) throw new HttpError(400, "no_connected_whatsapp_session");

  const contact = await prisma.contact.upsert({
    where: { organizationId_waJid: { organizationId, waJid } },
    update: input.name ? { name: input.name } : {},
    create: { organizationId, waJid, phoneNumber, name: input.name },
  });

  const conversation = await prisma.conversation.upsert({
    where: { whatsappSessionId_contactId: { whatsappSessionId: session.id, contactId: contact.id } },
    update: {},
    create: { organizationId, whatsappSessionId: session.id, contactId: contact.id },
    include: {
      contact: { include: { tags: { include: { tag: true } }, whatsappLabels: { include: { label: true } } } },
      assignedUser: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const { contact: fullContact, ...rest } = conversation;
  res.status(201).json({
    ...rest,
    contact: {
      ...fullContact,
      tags: fullContact.tags.map((t) => t.tag),
      whatsappLabels: fullContact.whatsappLabels.map((l) => l.label),
    },
  });
}

export async function listMessages(req: Request, res: Response) {
  const conversation = await getOwnedConversation(req.auth!.organizationId, req.params.id);
  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
}

// Appended to the text actually delivered over WhatsApp (never to what we store in our own
// Message.content) so customers on a shared number know which attendant is writing —
// unless the sender turned their signature off in their own settings.
function withSignature(text: string | undefined | null, sender: { name: string; signatureEnabled: boolean; signatureName: string | null }): string {
  if (!sender.signatureEnabled) return text ?? "";
  const suffix = `_- ${sender.signatureName || sender.name}_`;
  return text && text.trim().length > 0 ? `${text}\n\n${suffix}` : suffix;
}

const sendMessageSchema = z
  .object({
    text: z.string().min(1).optional(),
    quickReplyId: z.string().optional(),
  })
  .refine((d) => d.text || d.quickReplyId, { message: "text_or_quickReplyId_required" });

export async function sendMessage(req: Request, res: Response) {
  const auth = req.auth!;
  const input = sendMessageSchema.parse(req.body);
  const conversation = await getOwnedConversation(auth.organizationId, req.params.id);
  const [contact, sender] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } }),
    prisma.user.findUniqueOrThrow({ where: { id: auth.sub } }),
  ]);

  let type: MessageType = MessageType.TEXT;
  let content: string | null = input.text ?? null;
  let mediaUrl: string | null = null;
  let mediaName: string | null = null;

  if (input.quickReplyId) {
    const quickReply = await prisma.quickReply.findFirst({
      where: { id: input.quickReplyId, organizationId: auth.organizationId },
    });
    if (!quickReply) throw new HttpError(404, "quick_reply_not_found");
    // QuickReplyType (from @crm/db) and MessageType (from @crm/shared) are separately
    // generated/declared but share the same TEXT/IMAGE/AUDIO/DOCUMENT string values.
    type = quickReply.type as MessageType;
    // Lets the caller edit the caption/text in a preview before sending — falls back to
    // the quick reply's own saved content when nothing was typed over it.
    content = input.text && input.text.trim() ? input.text.trim() : quickReply.content;
    mediaUrl = quickReply.mediaUrl;
    mediaName = quickReply.mediaName;
  }

  if (!content && !mediaUrl) throw new HttpError(400, "empty_message");

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type,
      content,
      mediaUrl,
      status: MessageStatus.PENDING,
      sentByUserId: auth.sub,
    },
  });

  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  await outboundMessagesQueue.add("send", {
    organizationId: auth.organizationId,
    sessionId: conversation.whatsappSessionId,
    conversationId: conversation.id,
    messageId: message.id,
    waJid: contact.waJid,
    text: withSignature(content, sender),
    mediaUrl: mediaUrl ? `${env.PUBLIC_URL}${mediaUrl}` : undefined,
    mediaType: mediaUrl ? type : undefined,
    mediaName: mediaName ?? undefined,
  });

  res.status(201).json(message);
}

function messageTypeFromMime(mime: string): MessageType {
  if (mime.startsWith("image/")) return MessageType.IMAGE;
  if (mime.startsWith("audio/")) return MessageType.AUDIO;
  if (mime.startsWith("video/")) return MessageType.VIDEO;
  return MessageType.DOCUMENT;
}

export async function sendAttachment(req: Request, res: Response) {
  const auth = req.auth!;
  const file = req.file;
  if (!file) throw new HttpError(400, "file_required");
  const caption = typeof req.body.caption === "string" && req.body.caption.trim() ? req.body.caption.trim() : null;

  const conversation = await getOwnedConversation(auth.organizationId, req.params.id);
  const [contact, sender] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } }),
    prisma.user.findUniqueOrThrow({ where: { id: auth.sub } }),
  ]);

  const type = messageTypeFromMime(file.mimetype);
  const mediaUrl = `/uploads/messages/${file.filename}`;

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type,
      content: caption,
      mediaUrl,
      status: MessageStatus.PENDING,
      sentByUserId: auth.sub,
    },
  });

  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  await outboundMessagesQueue.add("send", {
    organizationId: auth.organizationId,
    sessionId: conversation.whatsappSessionId,
    conversationId: conversation.id,
    messageId: message.id,
    waJid: contact.waJid,
    text: withSignature(caption, sender),
    mediaUrl: `${env.PUBLIC_URL}${mediaUrl}`,
    mediaType: type,
    mediaName: file.originalname,
  });

  res.status(201).json(message);
}

export async function markAsRead(req: Request, res: Response) {
  const conversation = await getOwnedConversation(req.auth!.organizationId, req.params.id);
  await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
  res.json({ ok: true });
}

const assignSchema = z.object({ userId: z.string().nullable() });

export async function assignConversation(req: Request, res: Response) {
  const input = assignSchema.parse(req.body);
  const conversation = await getOwnedConversation(req.auth!.organizationId, req.params.id);
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { assignedUserId: input.userId },
  });
  res.json(updated);
}

const MEDIA_LABEL: Partial<Record<MessageType, string>> = {
  [MessageType.IMAGE]: "Imagem",
  [MessageType.VIDEO]: "Vídeo",
  [MessageType.DOCUMENT]: "Documento",
};

export async function exportConversation(req: Request, res: Response) {
  const conversation = await getOwnedConversation(req.auth!.organizationId, req.params.id);
  const [contact, messages] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } }),
    prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      include: { sentByUser: { select: { name: true } } },
    }),
  ]);

  const contactLabel = contact.name?.trim() || `+${contact.phoneNumber}`;
  const safeName = contactLabel.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="conversa-${safeName}.pdf"`);

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  doc.pipe(res);

  doc.font("Helvetica-Bold").fontSize(16).text(`Histórico de conversa — ${contactLabel}`);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#666")
    .text(`+${contact.phoneNumber} · exportado em ${new Date().toLocaleString("pt-BR")} · ${messages.length} mensagens`);
  doc.moveDown();

  for (const message of messages) {
    const time = message.createdAt.toLocaleString("pt-BR");
    const sender = message.direction === MessageDirection.OUTBOUND ? message.sentByUser?.name ?? "Atendente" : contactLabel;

    let body: string;
    if (message.type === MessageType.AUDIO) {
      body = message.transcript ? `[Áudio — transcrição] "${message.transcript}"` : "[Áudio — transcrição indisponível]";
    } else if (message.content) {
      body = message.content;
    } else if (message.mediaUrl) {
      body = `[${MEDIA_LABEL[message.type] ?? "Anexo"}${message.type === MessageType.DOCUMENT ? "" : " enviado"}]`;
    } else {
      body = "(sem conteúdo)";
    }

    if (message.revokedAt) {
      body = `[Mensagem apagada pelo remetente no WhatsApp — conteúdo original preservado] ${body}`;
    }

    doc.fillColor("#000").font("Helvetica-Bold").fontSize(10).text(`[${time}] ${sender}`);
    doc.font("Helvetica").fontSize(11).text(body);
    doc.moveDown(0.6);
  }

  doc.end();
}
