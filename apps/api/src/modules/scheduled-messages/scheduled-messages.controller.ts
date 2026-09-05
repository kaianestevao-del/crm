import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { scheduledMessagesQueue } from "../../queues";
import { getOwnedConversation } from "../conversations/conversations.controller";

export async function listScheduledMessages(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const conversation = await getOwnedConversation(organizationId, req.params.id);
  const scheduledMessages = await prisma.scheduledMessage.findMany({
    where: { conversationId: conversation.id, status: "PENDING" },
    orderBy: { scheduledFor: "asc" },
  });
  res.json(scheduledMessages);
}

const createSchema = z.object({
  content: z.string().min(1),
  scheduledFor: z.string().datetime(),
});

export async function createScheduledMessage(req: Request, res: Response) {
  const auth = req.auth!;
  const input = createSchema.parse(req.body);
  const conversation = await getOwnedConversation(auth.organizationId, req.params.id);

  const scheduledFor = new Date(input.scheduledFor);
  if (scheduledFor.getTime() <= Date.now() + 30_000) {
    throw new HttpError(400, "scheduled_for_must_be_in_the_future");
  }

  const scheduledMessage = await prisma.scheduledMessage.create({
    data: {
      organizationId: auth.organizationId,
      conversationId: conversation.id,
      content: input.content,
      scheduledFor,
      createdByUserId: auth.sub,
    },
  });

  // jobId = the row's own id, so cancelling later is a single `queue.remove(jobId)` call
  // without needing to persist BullMQ's own job id anywhere.
  await scheduledMessagesQueue.add(
    "send",
    { scheduledMessageId: scheduledMessage.id },
    { jobId: scheduledMessage.id, delay: scheduledFor.getTime() - Date.now() },
  );

  res.status(201).json(scheduledMessage);
}

export async function cancelScheduledMessage(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const scheduledMessage = await prisma.scheduledMessage.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!scheduledMessage) throw new HttpError(404, "scheduled_message_not_found");
  if (scheduledMessage.status !== "PENDING") throw new HttpError(400, "scheduled_message_not_pending");

  await scheduledMessagesQueue.remove(scheduledMessage.id);
  const updated = await prisma.scheduledMessage.update({
    where: { id: scheduledMessage.id },
    data: { status: "CANCELLED" },
  });
  res.json(updated);
}
