import { Request, Response } from "express";
import { z } from "zod";
import { CampaignStatus } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { campaignJobsQueue } from "../../queues";

export async function listCampaigns(req: Request, res: Response) {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { _count: { select: { recipients: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(campaigns);
}

const createSchema = z.object({
  name: z.string().min(2),
  whatsappSessionId: z.string(),
  messageTemplate: z.string().min(1),
  contactIds: z.array(z.string()).min(1),
});

export async function createCampaign(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);

  const session = await prisma.whatsappSession.findFirst({
    where: { id: input.whatsappSessionId, organizationId },
  });
  if (!session) throw new HttpError(404, "session_not_found");

  const contacts = await prisma.contact.findMany({
    where: { organizationId, id: { in: input.contactIds } },
  });
  if (contacts.length === 0) throw new HttpError(400, "no_valid_contacts");

  const campaign = await prisma.campaign.create({
    data: {
      organizationId,
      whatsappSessionId: session.id,
      name: input.name,
      messageTemplate: input.messageTemplate,
      recipients: { create: contacts.map((c) => ({ contactId: c.id })) },
    },
  });
  res.status(201).json(campaign);
}

export async function startCampaign(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, organizationId } });
  if (!campaign) throw new HttpError(404, "campaign_not_found");
  if (campaign.status !== CampaignStatus.DRAFT) throw new HttpError(400, "campaign_already_started");

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: CampaignStatus.RUNNING } });
  await campaignJobsQueue.add("run", { organizationId, campaignId: campaign.id });
  res.json({ ok: true });
}

export async function getCampaign(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, organizationId },
    include: { recipients: { include: { contact: true } } },
  });
  if (!campaign) throw new HttpError(404, "campaign_not_found");
  res.json(campaign);
}
