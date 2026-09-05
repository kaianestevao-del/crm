import { Worker } from "bullmq";
import { QUEUE_CAMPAIGN_JOBS, CampaignJob } from "@crm/shared";
import { getPrismaClient, CampaignRecipientStatus, CampaignStatus } from "@crm/db";
import { createRedisClient } from "../redis";
import { sendTextMessage, isSessionActive } from "../baileys/session-manager";

const prisma = getPrismaClient();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Random delay between sends to keep bulk sending closer to human-like pacing
// and reduce the risk of the number being flagged/banned by WhatsApp.
function randomDelayMs() {
  return 3000 + Math.floor(Math.random() * 4000);
}

function renderTemplate(template: string, name: string | null) {
  return template.replace(/\{\{\s*name\s*\}\}/gi, name?.trim() || "");
}

export function createCampaignJobsWorker() {
  return new Worker<CampaignJob>(
    QUEUE_CAMPAIGN_JOBS,
    async (job) => {
      const { campaignId } = job.data;
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { recipients: { where: { status: CampaignRecipientStatus.PENDING }, include: { contact: true } } },
      });
      if (!campaign) return;

      if (!isSessionActive(campaign.whatsappSessionId)) {
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: CampaignStatus.FAILED } });
        return;
      }

      for (const recipient of campaign.recipients) {
        try {
          const text = renderTemplate(campaign.messageTemplate, recipient.contact.name);
          await sendTextMessage(campaign.whatsappSessionId, recipient.contact.waJid, text);
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: CampaignRecipientStatus.SENT, sentAt: new Date() },
          });
        } catch (err) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: CampaignRecipientStatus.FAILED, error: (err as Error).message },
          });
        }
        await sleep(randomDelayMs());
      }

      await prisma.campaign.update({ where: { id: campaignId }, data: { status: CampaignStatus.DONE } });
    },
    { connection: createRedisClient(), concurrency: 1 },
  );
}
