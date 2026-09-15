import { Worker } from "bullmq";
import { getPrismaClient } from "@crm/db";
import { QUEUE_OUTBOUND_MESSAGES, OutboundMessageJob, OutboundMessageSequenceJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { sendOutboundMessage } from "../baileys/session-manager";
import { publishRealtimeEvent } from "../pubsub";

const prisma = getPrismaClient();

// Only present on campaign sends (see conversations... campaigns.controller.ts) — marks the
// matching CampaignRecipient row so the Campaigns page can show live sent/failed counts without
// polling every Message. Delivered/read still come from Message.status via the existing
// Cloud API status webhook; this only covers the send attempt itself.
async function updateCampaignRecipient(job: OutboundMessageJob, outcome: { messageId: string } | { error: string }) {
  if (!job.campaignRecipientId) return;
  const recipient = await prisma.campaignRecipient.update({
    where: { id: job.campaignRecipientId },
    data:
      "error" in outcome
        ? { status: "FAILED", error: outcome.error }
        : { status: "SENT", messageId: outcome.messageId },
  });
  const campaign = await prisma.campaign.findUnique({ where: { id: recipient.campaignId } });
  if (!campaign) return;

  // Once nobody is left PENDING, the campaign is done — a recipient that later flips from
  // FAILED to SENT on a BullMQ retry is a fine loose end for Phase 1 (the campaign already
  // reflects "everyone was attempted"; per-recipient status still updates correctly either way).
  if (campaign.status === "SENDING") {
    const stillPending = await prisma.campaignRecipient.count({ where: { campaignId: campaign.id, status: "PENDING" } });
    if (stillPending === 0) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DONE", finishedAt: new Date() } });
    }
  }

  publishRealtimeEvent({ type: "campaign.updated", organizationId: campaign.organizationId, campaignId: campaign.id });
}

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
      const data = job.data as OutboundMessageJob;
      try {
        await sendOutboundMessage(data);
        await updateCampaignRecipient(data, { messageId: data.messageId });
      } catch (err) {
        await updateCampaignRecipient(data, { error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
    { connection: createRedisClient(), concurrency: 5 },
  );
}
