import { Request, Response } from "express";
import { z } from "zod";
import { MessageDirection, MessageStatus, MessageType } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { outboundMessagesQueue } from "../../queues";

async function getOwnedCampaign(organizationId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId },
    include: { template: true, whatsappSession: true },
  });
  if (!campaign) throw new HttpError(404, "campaign_not_found");
  return campaign;
}

async function resolveRecipients(
  organizationId: string,
  audienceType: "TAG" | "LABEL" | "ALL",
  audienceTagId?: string,
  audienceLabelId?: string,
) {
  if (audienceType === "TAG") {
    if (!audienceTagId) throw new HttpError(400, "audienceTagId_required");
    return prisma.contact.findMany({ where: { organizationId, tags: { some: { tagId: audienceTagId } } } });
  }
  if (audienceType === "LABEL") {
    if (!audienceLabelId) throw new HttpError(400, "audienceLabelId_required");
    return prisma.contact.findMany({ where: { organizationId, whatsappLabels: { some: { labelId: audienceLabelId } } } });
  }
  return prisma.contact.findMany({ where: { organizationId } });
}

function priceForCategory(org: { templatePriceMarketing: unknown; templatePriceUtility: unknown }, category: string) {
  return Number(category === "MARKETING" ? org.templatePriceMarketing : org.templatePriceUtility);
}

export async function listCampaigns(req: Request, res: Response) {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { template: { select: { name: true, category: true } }, _count: { select: { recipients: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(campaigns);
}

const createSchema = z
  .object({
    name: z.string().min(1),
    templateId: z.string().min(1),
    audienceType: z.enum(["TAG", "LABEL", "ALL"]),
    audienceTagId: z.string().optional(),
    audienceLabelId: z.string().optional(),
  })
  .refine((d) => d.audienceType !== "TAG" || !!d.audienceTagId, { message: "audienceTagId_required" })
  .refine((d) => d.audienceType !== "LABEL" || !!d.audienceLabelId, { message: "audienceLabelId_required" });

// Creates the campaign as DRAFT with its recipients already resolved, and returns a cost
// preview — nothing is sent yet. The attendant confirms via POST /:id/send once they've seen
// the estimated cost, which is when the actual price gets locked onto the campaign.
export async function createCampaign(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);

  const [template, session, org] = await Promise.all([
    prisma.messageTemplate.findFirst({ where: { id: input.templateId, organizationId } }),
    prisma.whatsappSession.findFirst({ where: { organizationId, provider: "CLOUD_API", archivedAt: null } }),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
  ]);
  if (!template) throw new HttpError(404, "template_not_found");
  if (template.status !== "APPROVED") throw new HttpError(400, "template_not_approved");
  if (!session) throw new HttpError(400, "no_cloud_api_session_connected");

  const recipients = await resolveRecipients(organizationId, input.audienceType, input.audienceTagId, input.audienceLabelId);
  if (recipients.length === 0) throw new HttpError(400, "no_recipients_found");

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        organizationId,
        whatsappSessionId: session.id,
        templateId: template.id,
        name: input.name,
        audienceType: input.audienceType,
        audienceTagId: input.audienceType === "TAG" ? input.audienceTagId : null,
        audienceLabelId: input.audienceType === "LABEL" ? input.audienceLabelId : null,
      },
    });
    await tx.campaignRecipient.createMany({
      data: recipients.map((c) => ({ campaignId: created.id, contactId: c.id })),
    });
    return created;
  });

  res.status(201).json({
    ...campaign,
    recipientCount: recipients.length,
    previewCost: recipients.length * priceForCategory(org, template.category),
  });
}

export async function getCampaign(req: Request, res: Response) {
  const campaign = await getOwnedCampaign(req.auth!.organizationId, req.params.id);
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id },
    select: { status: true, message: { select: { status: true } } },
  });

  const recipientStatusCounts: Record<string, number> = {};
  const messageStatusCounts: Record<string, number> = {};
  for (const r of recipients) {
    recipientStatusCounts[r.status] = (recipientStatusCounts[r.status] ?? 0) + 1;
    if (r.message) messageStatusCounts[r.message.status] = (messageStatusCounts[r.message.status] ?? 0) + 1;
  }

  res.json({ ...campaign, recipientCount: recipients.length, recipientStatusCounts, messageStatusCounts });
}

// Explicit, separate step from creation — the frontend shows the cost preview from
// createCampaign and only calls this once the attendant confirms. Enqueues one job per
// recipient (not the "send-sequence" pattern used for quick replies) since a campaign can have
// thousands of recipients and each one is independent — the outbound queue's existing
// concurrency + retry handles throughput, no single job should block on the whole batch.
export async function sendCampaign(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const campaign = await getOwnedCampaign(organizationId, req.params.id);
  if (campaign.status !== "DRAFT") throw new HttpError(400, "campaign_not_in_draft");
  if (campaign.template.status !== "APPROVED") throw new HttpError(400, "template_not_approved");

  const [org, recipients] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id }, include: { contact: true } }),
  ]);

  const estimatedCost = recipients.length * priceForCategory(org, campaign.template.category);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "SENDING", startedAt: new Date(), estimatedCost },
  });

  for (const recipient of recipients) {
    const conversation = await prisma.conversation.upsert({
      where: { whatsappSessionId_contactId: { whatsappSessionId: campaign.whatsappSessionId, contactId: recipient.contactId } },
      update: {},
      create: { organizationId, whatsappSessionId: campaign.whatsappSessionId, contactId: recipient.contactId },
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
      organizationId,
      sessionId: campaign.whatsappSessionId,
      conversationId: conversation.id,
      messageId: message.id,
      waJid: recipient.contact.waJid,
      templateName: campaign.template.name,
      templateLanguage: campaign.template.language,
      campaignRecipientId: recipient.id,
    });
  }

  res.json({ ok: true, recipientCount: recipients.length, estimatedCost });
}
