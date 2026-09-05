import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

export async function listPipelines(req: Request, res: Response) {
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: {
      stages: {
        orderBy: { order: "asc" },
        include: {
          deals: {
            orderBy: { order: "asc" },
            include: { contact: true, assignedUser: { select: { id: true, name: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(pipelines);
}

const createDealSchema = z.object({
  pipelineId: z.string(),
  stageId: z.string(),
  contactId: z.string(),
  title: z.string().min(1),
  value: z.number().optional(),
});

export async function createDeal(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createDealSchema.parse(req.body);

  const [pipeline, stage, contact] = await Promise.all([
    prisma.pipeline.findFirst({ where: { id: input.pipelineId, organizationId } }),
    prisma.pipelineStage.findFirst({ where: { id: input.stageId, pipeline: { organizationId } } }),
    prisma.contact.findFirst({ where: { id: input.contactId, organizationId } }),
  ]);
  if (!pipeline || !stage || !contact) throw new HttpError(404, "related_entity_not_found");

  const lastDeal = await prisma.deal.findFirst({ where: { stageId: stage.id }, orderBy: { order: "desc" } });

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: contact.id,
      title: input.title,
      value: input.value,
      order: (lastDeal?.order ?? -1) + 1,
    },
  });
  res.status(201).json(deal);
}

const moveDealSchema = z.object({
  stageId: z.string(),
  order: z.number().int().min(0),
});

export async function moveDeal(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = moveDealSchema.parse(req.body);

  const deal = await prisma.deal.findFirst({ where: { id: req.params.id, organizationId } });
  if (!deal) throw new HttpError(404, "deal_not_found");

  const stage = await prisma.pipelineStage.findFirst({ where: { id: input.stageId, pipeline: { organizationId } } });
  if (!stage) throw new HttpError(404, "stage_not_found");

  await prisma.$transaction(async (tx) => {
    // Shift existing deals in the destination stage to make room, then place this one at `order`.
    await tx.deal.updateMany({
      where: { stageId: input.stageId, order: { gte: input.order } },
      data: { order: { increment: 1 } },
    });
    await tx.deal.update({
      where: { id: deal.id },
      data: { stageId: input.stageId, order: input.order },
    });
  });

  const updated = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  res.json(updated);
}

export async function deleteDeal(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const deal = await prisma.deal.findFirst({ where: { id: req.params.id, organizationId } });
  if (!deal) throw new HttpError(404, "deal_not_found");
  await prisma.deal.delete({ where: { id: deal.id } });
  res.json({ ok: true });
}
