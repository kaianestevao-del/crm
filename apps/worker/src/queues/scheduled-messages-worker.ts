import { Worker } from "bullmq";
import { getPrismaClient, MessageDirection, MessageStatus, MessageType } from "@crm/db";
import { QUEUE_SCHEDULED_MESSAGES, ScheduledMessageJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { sendOutboundMessage } from "../baileys/session-manager";
import { publishRealtimeEvent } from "../pubsub";

const prisma = getPrismaClient();

// Mirrors the API's own signature suffix (conversations.controller.ts `withSignature`) —
// duplicated here because the worker sends this message on its own, with no HTTP request to
// piggyback the signature computation on.
function withSignature(text: string, sender: { name: string; signatureEnabled: boolean; signatureName: string | null } | null): string {
  if (!sender || !sender.signatureEnabled) return text;
  const suffix = `_- ${sender.signatureName || sender.name}_`;
  return text.trim().length > 0 ? `${text}\n\n${suffix}` : suffix;
}

async function sendScheduledMessage(scheduledMessageId: string) {
  const scheduled = await prisma.scheduledMessage.findUnique({ where: { id: scheduledMessageId } });
  // Already cancelled, or somehow fired twice — nothing to do.
  if (!scheduled || scheduled.status !== "PENDING") return;

  const conversation = await prisma.conversation.findUnique({ where: { id: scheduled.conversationId } });
  if (!conversation) {
    await prisma.scheduledMessage.update({ where: { id: scheduled.id }, data: { status: "FAILED", error: "conversation_not_found" } });
    return;
  }

  const [contact, sender] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } }),
    scheduled.createdByUserId ? prisma.user.findUnique({ where: { id: scheduled.createdByUserId } }) : Promise.resolve(null),
  ]);

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      content: scheduled.content,
      status: MessageStatus.PENDING,
      sentByUserId: scheduled.createdByUserId,
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  try {
    await sendOutboundMessage({
      organizationId: scheduled.organizationId,
      sessionId: conversation.whatsappSessionId,
      conversationId: conversation.id,
      messageId: message.id,
      waJid: contact.waJid,
      text: withSignature(scheduled.content, sender),
    });
    await prisma.scheduledMessage.update({ where: { id: scheduled.id }, data: { status: "SENT", sentMessageId: message.id } });
  } catch (err) {
    await prisma.scheduledMessage.update({
      where: { id: scheduled.id },
      data: { status: "FAILED", sentMessageId: message.id, error: err instanceof Error ? err.message : String(err) },
    });
  }

  const updatedMessage = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
  publishRealtimeEvent({ type: "message.new", organizationId: scheduled.organizationId, conversationId: conversation.id, message: updatedMessage });
  publishRealtimeEvent({ type: "conversation.updated", organizationId: scheduled.organizationId, conversationId: conversation.id });
}

export function createScheduledMessagesWorker() {
  return new Worker<ScheduledMessageJob>(
    QUEUE_SCHEDULED_MESSAGES,
    async (job) => {
      await sendScheduledMessage(job.data.scheduledMessageId);
    },
    { connection: createRedisClient(), concurrency: 5 },
  );
}
