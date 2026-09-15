import { Worker } from "bullmq";
import { QUEUE_OUTBOUND_MESSAGES, OutboundMessageJob, OutboundMessageSequenceJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { sendOutboundMessage } from "../baileys/session-manager";

export function createOutboundMessagesWorker() {
  return new Worker<OutboundMessageJob | OutboundMessageSequenceJob>(
    QUEUE_OUTBOUND_MESSAGES,
    async (job) => {
      // A multi-step quick reply's parts must reach the customer in order — looping with
      // awaits here (one worker slot, sequential) guarantees that regardless of the
      // concurrency below, which only bounds how many *different* jobs run in parallel.
      if (job.name === "send-sequence") {
        const { steps, ...shared } = job.data as OutboundMessageSequenceJob;
        for (const step of steps) {
          await sendOutboundMessage({ ...shared, ...step });
        }
        return;
      }
      await sendOutboundMessage(job.data as OutboundMessageJob);
    },
    { connection: createRedisClient(), concurrency: 5 },
  );
}
