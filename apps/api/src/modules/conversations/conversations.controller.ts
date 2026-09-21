import path from "path";
import { Request, Response } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { MessageDirection, MessageStatus, MessageType } from "@crm/shared";
import { prisma } from "../../prisma";
import { env } from "../../env";
import { HttpError } from "../../utils/httpError";
import { outboundMessagesQueue } from "../../queues";
import { publishRealtimeEvent } from "../../pubsub";
import { transcodeToOpusOgg } from "../../media/transcodeAudio";

export async function listConversations(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const conversations = await prisma.conversation.findMany({
    // CLOSED = the attendant "deleted" it from the inbox (see closeConversation below) — it
    // comes back on its own the next time the contact writes in (see session-manager.ts).
    where: { organizationId, status: "OPEN" },
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

// Total of unread messages across the inbox, for the sidebar badge.
export async function getUnreadCount(req: Request, res: Response) {
  const result = await prisma.conversation.aggregate({
    where: { organizationId: req.auth!.organizationId, status: "OPEN" },
    _sum: { unreadCount: true },
  });
  res.json({ count: result._sum.unreadCount ?? 0 });
}

// "Ir para a Caixa de Entrada" from the Dashboard/Contatos/Kanban: a conversation the
// attendant had "deleted" (CLOSED) isn't in the inbox list, so navigating by contact alone
// would silently open nothing — reopen it here so it's always findable.
export async function openConversationByContact(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const { contactId } = z.object({ contactId: z.string() }).parse(req.body);
  const conversation = await prisma.conversation.findFirst({
    where: { organizationId, contactId },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) throw new HttpError(404, "conversation_not_found");
  if (conversation.status !== "OPEN") {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "OPEN" } });
  }
  res.json({ id: conversation.id });
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

const WEEKDAY_NAMES = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

// Placeholders a quick reply's text can use, filled in with the actual contact/date at the
// moment the message is about to be sent (or previewed) — never stored pre-substituted, so
// editing the quick reply later doesn't leave stale names/dates baked into old messages.
function applyTags(text: string, contact: { name: string | null; phoneNumber: string }): string {
  if (!text) return text;
  const hour = new Date().getHours();
  const saudacao = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";
  const primeiroNome = contact.name?.trim().split(/\s+/)[0] || "";
  return text
    .replaceAll("{{nome}}", primeiroNome)
    .replaceAll("{{telefone}}", contact.phoneNumber)
    .replaceAll("{{saudacao}}", saudacao)
    .replaceAll("{{diaSemana}}", WEEKDAY_NAMES[new Date().getDay()]);
}

// Shows what each part of a multi-step quick reply will actually say once sent — tags already
// substituted with the real contact's data — so the attendant can review/edit before sending.
export async function previewQuickReply(req: Request, res: Response) {
  const auth = req.auth!;
  const conversation = await getOwnedConversation(auth.organizationId, req.params.id);
  const [contact, quickReply] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } }),
    prisma.quickReply.findFirst({
      where: { id: req.params.quickReplyId, organizationId: auth.organizationId },
      include: { steps: { orderBy: { order: "asc" } } },
    }),
  ]);
  if (!quickReply) throw new HttpError(404, "quick_reply_not_found");

  res.json({
    steps: quickReply.steps.map((step) => ({
      type: step.type,
      content: step.content ? applyTags(step.content, contact) : step.content,
      mediaUrl: step.mediaUrl,
      mediaName: step.mediaName,
    })),
  });
}

const sendMessageSchema = z
  .object({
    text: z.string().min(1).optional(),
    quickReplyId: z.string().optional(),
    // One entry per step of the quick reply, in order — the (possibly attendant-edited) text
    // from the preview. Falls back to re-substituting the quick reply's own saved text when a
    // step's override is missing, so calling this endpoint without previewing first still works.
    steps: z.array(z.object({ content: z.string().optional() })).optional(),
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

  // Each entry becomes one Message row and one WhatsApp send, in this order.
  let parts: { type: MessageType; content: string | null; mediaUrl: string | null; mediaName: string | null }[];

  if (input.quickReplyId) {
    const quickReply = await prisma.quickReply.findFirst({
      where: { id: input.quickReplyId, organizationId: auth.organizationId },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!quickReply) throw new HttpError(404, "quick_reply_not_found");
    parts = quickReply.steps.map((step, i) => ({
      // QuickReplyType (from @crm/db) and MessageType (from @crm/shared) are separately
      // generated/declared but share the same TEXT/IMAGE/AUDIO/DOCUMENT string values.
      type: step.type as MessageType,
      content: input.steps?.[i]?.content ?? (step.content ? applyTags(step.content, contact) : step.content),
      mediaUrl: step.mediaUrl,
      mediaName: step.mediaName,
    }));
  } else {
    parts = [{ type: MessageType.TEXT, content: applyTags(input.text!.trim(), contact), mediaUrl: null, mediaName: null }];
  }

  if (parts.every((p) => !p.content && !p.mediaUrl)) throw new HttpError(400, "empty_message");

  const messages = await prisma.$transaction(
    parts.map((part) =>
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.OUTBOUND,
          type: part.type,
          content: part.content,
          mediaUrl: part.mediaUrl,
          status: MessageStatus.PENDING,
          sentByUserId: auth.sub,
        },
      }),
    ),
  );

  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  // The signature belongs only at the end of the whole sequence, not after every part.
  const lastTextIndex = parts.reduce((acc, p, i) => (p.type === MessageType.TEXT ? i : acc), -1);

  const jobSteps = messages.map((message, i) => {
    const part = parts[i];
    const text = i === lastTextIndex ? withSignature(part.content, sender) : (part.content ?? undefined);
    return {
      messageId: message.id,
      text: text || undefined,
      mediaUrl: part.mediaUrl ? `${env.PUBLIC_URL}${part.mediaUrl}` : undefined,
      mediaType: part.mediaUrl ? part.type : undefined,
      mediaName: part.mediaName ?? undefined,
    };
  });

  if (jobSteps.length === 1) {
    await outboundMessagesQueue.add("send", {
      organizationId: auth.organizationId,
      sessionId: conversation.whatsappSessionId,
      conversationId: conversation.id,
      waJid: contact.waJid,
      ...jobSteps[0],
    });
  } else {
    const org = await prisma.organization.findUnique({
      where: { id: auth.organizationId },
      select: { quickReplyStepDelaySeconds: true },
    });
    await outboundMessagesQueue.add("send-sequence", {
      organizationId: auth.organizationId,
      sessionId: conversation.whatsappSessionId,
      conversationId: conversation.id,
      waJid: contact.waJid,
      delayMs: (org?.quickReplyStepDelaySeconds ?? 3) * 1000,
      steps: jobSteps,
    });
  }

  res.status(201).json({ messages });
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
  let mediaUrl = `/uploads/messages/${file.filename}`;

  if (type === MessageType.AUDIO) {
    try {
      const { filename } = await transcodeToOpusOgg(file.path, path.dirname(file.path));
      mediaUrl = `/uploads/messages/${filename}`;
    } catch (err) {
      // Fail open — keep the original file and let the send attempt it as-is rather than
      // blocking the message entirely on a transcoder bug.
      console.error("audio_transcode_failed", err);
    }
  }

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
  const auth = req.auth!;
  const conversation = await getOwnedConversation(auth.organizationId, req.params.id);
  await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
  // So another attendant's tab/session for the same org sees the unread badge clear too —
  // without this, only the tab that made the request ever reflects the change.
  publishRealtimeEvent({ type: "conversation.updated", organizationId: auth.organizationId, conversationId: conversation.id });
  res.json({ ok: true });
}

export async function markAsUnread(req: Request, res: Response) {
  const auth = req.auth!;
  const conversation = await getOwnedConversation(auth.organizationId, req.params.id);
  await prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 1 } });
  publishRealtimeEvent({ type: "conversation.updated", organizationId: auth.organizationId, conversationId: conversation.id });
  res.json({ ok: true });
}

// Soft-delete only — hides the conversation from the inbox list, but every Message stays in
// the database. Reappears on its own (status flips back to OPEN) the next time the contact
// sends a message — see the conversation.upsert in session-manager.ts.
export async function closeConversation(req: Request, res: Response) {
  const conversation = await getOwnedConversation(req.auth!.organizationId, req.params.id);
  await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } });
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
