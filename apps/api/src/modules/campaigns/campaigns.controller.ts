import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { campaignDispatchQueue } from "../../queues";

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
  audienceType: "TAG" | "LABEL" | "ALL" | "CONTACTS",
  audienceTagId?: string,
  audienceLabelId?: string,
  audienceContactIds?: string[],
) {
  if (audienceType === "TAG") {
    if (!audienceTagId) throw new HttpError(400, "audienceTagId_required");
    return prisma.contact.findMany({ where: { organizationId, tags: { some: { tagId: audienceTagId } } } });
  }
  if (audienceType === "LABEL") {
    if (!audienceLabelId) throw new HttpError(400, "audienceLabelId_required");
    return prisma.contact.findMany({ where: { organizationId, whatsappLabels: { some: { labelId: audienceLabelId } } } });
  }
  if (audienceType === "CONTACTS") {
    if (!audienceContactIds?.length) throw new HttpError(400, "audienceContactIds_required");
    return prisma.contact.findMany({ where: { organizationId, id: { in: audienceContactIds } } });
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
    audienceType: z.enum(["TAG", "LABEL", "ALL", "CONTACTS"]),
    audienceTagId: z.string().optional(),
    audienceLabelId: z.string().optional(),
    audienceContactIds: z.array(z.string()).optional(),
  })
  .refine((d) => d.audienceType !== "TAG" || !!d.audienceTagId, { message: "audienceTagId_required" })
  .refine((d) => d.audienceType !== "LABEL" || !!d.audienceLabelId, { message: "audienceLabelId_required" })
  .refine((d) => d.audienceType !== "CONTACTS" || !!d.audienceContactIds?.length, { message: "audienceContactIds_required" });

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

  const recipients = await resolveRecipients(
    organizationId,
    input.audienceType,
    input.audienceTagId,
    input.audienceLabelId,
    input.audienceContactIds,
  );
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
        audienceContactIds: input.audienceType === "CONTACTS" ? input.audienceContactIds! : [],
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

const sendSchema = z.object({ scheduledFor: z.string().datetime().optional() });

// Explicit, separate step from creation — the frontend shows the cost preview from
// createCampaign and only calls this once the attendant confirms. The actual per-recipient
// dispatch loop runs in the worker (see campaign-dispatch-worker.ts), reached through a
// delayed BullMQ job — delay: 0 for "send now", or delay until scheduledFor for a scheduled
// send. Same job-per-campaign pattern (jobId = campaign id) as ScheduledMessage, so a
// scheduled send can be cancelled the same way.
export async function sendCampaign(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const campaign = await getOwnedCampaign(organizationId, req.params.id);
  if (campaign.status !== "DRAFT") throw new HttpError(400, "campaign_not_in_draft");
  if (campaign.template.status !== "APPROVED") throw new HttpError(400, "template_not_approved");

  const input = sendSchema.parse(req.body);
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (scheduledFor && scheduledFor.getTime() <= Date.now() + 30_000) {
    throw new HttpError(400, "scheduled_for_must_be_in_the_future");
  }

  const [org, recipientCount] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.campaignRecipient.count({ where: { campaignId: campaign.id } }),
  ]);
  const estimatedCost = recipientCount * priceForCategory(org, campaign.template.category);

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: scheduledFor
      ? { status: "SCHEDULED", scheduledFor, estimatedCost }
      : { status: "SENDING", startedAt: new Date(), estimatedCost },
  });

  await campaignDispatchQueue.add(
    "dispatch",
    { campaignId: campaign.id },
    { jobId: campaign.id, delay: scheduledFor ? scheduledFor.getTime() - Date.now() : 0 },
  );

  res.json({ ok: true, recipientCount, estimatedCost, scheduledFor });
}

export async function cancelScheduledCampaign(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const campaign = await getOwnedCampaign(organizationId, req.params.id);
  if (campaign.status !== "SCHEDULED") throw new HttpError(400, "campaign_not_scheduled");

  await campaignDispatchQueue.remove(campaign.id);
  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "DRAFT", scheduledFor: null, estimatedCost: null },
  });
  res.json(updated);
}
