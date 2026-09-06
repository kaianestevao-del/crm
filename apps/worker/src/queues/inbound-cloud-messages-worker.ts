import { Worker } from "bullmq";
import { QUEUE_INBOUND_CLOUD_MESSAGES, InboundCloudMessageJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { processInboundCloudMessage } from "../baileys/session-manager";

export function createInboundCloudMessagesWorker() {
  return new Worker<InboundCloudMessageJob>(
    QUEUE_INBOUND_CLOUD_MESSAGES,
    async (job) => {
      await processInboundCloudMessage(job.data);
    },
    { connection: createRedisClient(), concurrency: 5 },
  );
}
