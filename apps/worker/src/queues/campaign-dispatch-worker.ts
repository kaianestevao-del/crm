import { Queue, Worker } from "bullmq";
import { getPrismaClient, MessageDirection, MessageStatus, MessageType, TemplateCategory } from "@crm/db";
import {
  QUEUE_CAMPAIGN_DISPATCH,
  QUEUE_OUTBOUND_MESSAGES,
  CampaignDispatchJob,
  OutboundMessageJob,
  fillTemplateBody,
  renderCampaignParam,
} from "@crm/shared";
import { createRedisClient } from "../redis";
import { publishRealtimeEvent } from "../pubsub";

const prisma = getPrismaClient();

// Producer only — outbound-messages-worker.ts's Worker is what actually consumes this queue.
// Same "shared queue name, separate producer/consumer files" pattern as transcribeAudioQueue.
const outboundMessagesQueue = new Queue<OutboundMessageJob>(QUEUE_OUTBOUND_MESSAGES, {
  connection: createRedisClient(),
});

const CLOUD_API_BASE = "https://graph.facebook.com/v21.0";

// Meta re-classifies UTILITY templates as MARKETING after approval when the copy reads as
// promotional, and the category decides which endpoint each send goes through (see
// sendCloudApiMessage). The Templates/Campaigns pages sync it on open, but a scheduled campaign
// can fire days later — so check once more right before dispatching. Any failure here keeps the
// stored category; a stale UTILITY is still caught by the 131063 retry on the send itself.
async function refreshTemplateCategory(
  template: { id: string; metaTemplateId: string | null; category: TemplateCategory },
  whatsappSessionId: string,
): Promise<TemplateCategory> {
  if (!template.metaTemplateId) return template.category;
  try {
    const session = await prisma.whatsappSession.findUnique({ where: { id: whatsappSessionId } });
    if (!session?.cloudApiAccessToken) return template.category;
    const res = await fetch(`${CLOUD_API_BASE}/${template.metaTemplateId}?fields=category`, {
      headers: { Authorization: `Bearer ${session.cloudApiAccessToken}` },
    });
    const data = (await res.json()) as { category?: string };
    const metaCategory = Object.values(TemplateCategory).find((c) => c === data.category);
    if (!res.ok || !metaCategory) return template.category;
    if (metaCategory !== template.category) {
      await prisma.messageTemplate.update({ where: { id: template.id }, data: { category: metaCategory } });
    }
    return metaCategory;
  } catch (err) {
    console.error("refresh_template_category_failed", err);
    return template.category;
  }
}

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

  const templateCategory = await refreshTemplateCategory(campaign.template, campaign.whatsappSessionId);

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: "PENDING" },
    include: { contact: true },
  });

  for (const recipient of recipients) {
    const templateParams = campaign.templateParams.map((value) => renderCampaignParam(value, recipient.contact));
    // e.g. "{{nome}}" alone for a contact saved without a name — Meta would reject the empty
    // parameter anyway, so fail this recipient up front with a reason the attendant can act on.
    if (templateParams.some((p) => !p)) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", error: "template_param_empty" },
      });
      continue;
    }

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
        content: fillTemplateBody(campaign.template.bodyText, templateParams),
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
      templateParams,
      templateCategory,
      campaignRecipientId: recipient.id,
    });
  }

  // If every recipient failed up front, no outbound job will ever run to close the campaign
  // (that normally happens in outbound-messages-worker's updateCampaignRecipient).
  const stillPending = await prisma.campaignRecipient.count({ where: { campaignId: campaign.id, status: "PENDING" } });
  if (stillPending === 0) {
    await prisma.campaign.updateMany({
      where: { id: campaign.id, status: "SENDING" },
      data: { status: "DONE", finishedAt: new Date() },
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
