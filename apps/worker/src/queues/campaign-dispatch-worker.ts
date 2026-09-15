import { Queue, Worker } from "bullmq";
import { getPrismaClient, MessageDirection, MessageStatus, MessageType } from "@crm/db";
import { QUEUE_CAMPAIGN_DISPATCH, QUEUE_OUTBOUND_MESSAGES, CampaignDispatchJob, OutboundMessageJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { publishRealtimeEvent } from "../pubsub";

const prisma = getPrismaClient();

// Producer only — outbound-messages-worker.ts's Worker is what actually consumes this queue.
// Same "shared queue name, separate producer/consumer files" pattern as transcribeAudioQueue.
const outboundMessagesQueue = new Queue<OutboundMessageJob>(QUEUE_OUTBOUND_MESSAGES, {
  connection: createRedisClient(),
});

// The whole per-recipient dispatch loop the API used to run inline (blocking the HTTP
// response) now lives here instead, reached via a delayed BullMQ job (jobId = campaign id).
// An immediate "send now" just uses delay: 0 — same code path as a scheduled send, the only
// difference being when this job fires.
async function dispatchCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { template: true } });
  // Cancelled after the job was already queued (see cancelScheduledCampaign), or somehow
  // fired twice — nothing to do either way.
  if (!campaign || (campaign.status !== "SCHEDULED" && campaign.status !== "SENDING")) return;

  if (campaign.status === "SCHEDULED") {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENDING", startedAt: new Date() } });
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: "PENDING" },
    include: { contact: true },
  });

  for (const recipient of recipients) {
    const conversation = await prisma.conversation.upsert({
      where: { whatsappSessionId_contactId: { whatsappSessionId: campaign.whatsappSessionId, contactId: recipient.contactId } },
      update: {},
      create: { organizationId: campaign.organizationId, whatsappSessionId: campaign.whatsappSessionId, contactId: recipient.contactId },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        content: campaign.template.bodyText,
        status: MessageStatus.PENDING,
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

    await outboundMessagesQueue.add("send-template", {
      organizationId: campaign.organizationId,
      sessionId: campaign.whatsappSessionId,
      conversationId: conversation.id,
      messageId: message.id,
      waJid: recipient.contact.waJid,
      templateName: campaign.template.name,
      templateLanguage: campaign.template.language,
      campaignRecipientId: recipient.id,
    });
  }

  publishRealtimeEvent({ type: "campaign.updated", organizationId: campaign.organizationId, campaignId: campaign.id });
}

export function createCampaignDispatchWorker() {
  return new Worker<CampaignDispatchJob>(
    QUEUE_CAMPAIGN_DISPATCH,
    async (job) => {
      await dispatchCampaign(job.data.campaignId);
    },
    { connection: createRedisClient(), concurrency: 2 },
  );
}
