import { Worker } from "bullmq";
import { QUEUE_OUTBOUND_MESSAGES, OutboundMessageJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { sendOutboundMessage } from "../baileys/session-manager";

export function createOutboundMessagesWorker() {
  return new Worker<OutboundMessageJob>(
    QUEUE_OUTBOUND_MESSAGES,
    async (job) => {
      await sendOutboundMessage(job.data);
    },
    { connection: createRedisClient(), concurrency: 5 },
  );
}
