import { Worker } from "bullmq";
import { QUEUE_OUTBOUND_MESSAGES, OutboundMessageJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { sendTextMessage } from "../baileys/session-manager";

export function createOutboundMessagesWorker() {
  return new Worker<OutboundMessageJob>(
    QUEUE_OUTBOUND_MESSAGES,
    async (job) => {
      const { sessionId, waJid, text, messageId } = job.data;
      await sendTextMessage(sessionId, waJid, text, messageId);
    },
    { connection: createRedisClient(), concurrency: 5 },
  );
}
