import { Request, Response } from "express";
import { z } from "zod";
import { MessageDirection, MessageStatus, MessageType } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { outboundMessagesQueue } from "../../queues";

export async function listConversations(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const conversations = await prisma.conversation.findMany({
    where: { organizationId },
    include: {
      contact: true,
      assignedUser: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  res.json(conversations);
}

async function getOwnedConversation(organizationId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId } });
  if (!conversation) throw new HttpError(404, "conversation_not_found");
  return conversation;
}

export async function listMessages(req: Request, res: Response) {
  const conversation = await getOwnedConversation(req.auth!.organizationId, req.params.id);
  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
}

const sendMessageSchema = z.object({ text: z.string().min(1) });

export async function sendMessage(req: Request, res: Response) {
  const auth = req.auth!;
  const input = sendMessageSchema.parse(req.body);
  const conversation = await getOwnedConversation(auth.organizationId, req.params.id);
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } });

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      content: input.text,
      status: MessageStatus.PENDING,
      sentByUserId: auth.sub,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  await outboundMessagesQueue.add("send", {
    organizationId: auth.organizationId,
    sessionId: conversation.whatsappSessionId,
    conversationId: conversation.id,
    messageId: message.id,
    waJid: contact.waJid,
    text: input.text,
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
