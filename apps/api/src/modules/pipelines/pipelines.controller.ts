import { Request, Response } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { Prisma } from "@crm/db";
import { PLAN_TYPES, PLAN_TYPE_LABELS, PlanType, PIPELINE_STAGE_ROLES, Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

type Tx = Prisma.TransactionClient;

// Every place that creates or moves a Deal goes through these two helpers so
// DealStageHistory always reflects reality — the Dashboard's stage-dwell-time and
// follow-up metrics have nothing to compute from otherwise.
async function createDealWithHistory(tx: Tx, data: Prisma.DealCreateInput) {
  const deal = await tx.deal.create({ data });
  await tx.dealStageHistory.create({
    data: { dealId: deal.id, stageId: deal.stageId, enteredAt: deal.createdAt },
  });
  return deal;
}

async function transitionDealStage(tx: Tx, dealId: string, fromStageId: string, toStageId: string) {
  if (fromStageId === toStageId) return;
  const now = new Date();
  await tx.dealStageHistory.updateMany({
    where: { dealId, stageId: fromStageId, exitedAt: null },
    data: { exitedAt: now },
  });
  await tx.dealStageHistory.create({ data: { dealId, stageId: toStageId, enteredAt: now } });
}

// Attaches `followUpProgress` (outbound messages sent since the deal's current stage began,
// out of the org's configured target) to every deal currently sitting in a FOLLOW_UP-role
// stage. Deals not in such a stage get `null`.
async function attachFollowUpProgress(
  organizationId: string,
  deals: { id: string; stage?: { role: string | null } | null }[],
) {
  const followUpDealIds = deals.filter((d) => d.stage?.role === "FOLLOW_UP").map((d) => d.id);
  const progress = new Map<string, { sent: number; target: number }>();
  if (followUpDealIds.length === 0) return progress;

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { followUpMessageTarget: true },
  });
  const rows = await prisma.$queryRaw<{ dealId: string; sent: bigint }[]>`
    SELECT d.id AS "dealId", COUNT(m.id) AS sent
    FROM "Deal" d
    JOIN "DealStageHistory" dsh ON dsh."dealId" = d.id AND dsh."exitedAt" IS NULL
    JOIN "Conversation" conv ON conv."contactId" = d."contactId" AND conv."organizationId" = d."organizationId"
    LEFT JOIN "Message" m ON m."conversationId" = conv.id
      AND m.direction = 'OUTBOUND' AND m."createdAt" >= dsh."enteredAt"
    WHERE d.id = ANY(${followUpDealIds}::text[])
    GROUP BY d.id
  `;
  for (const row of rows) {
    progress.set(row.dealId, { sent: Number(row.sent), target: org.followUpMessageTarget });
  }
  return progress;
}

export async function listPipelines(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId },
    include: {
      stages: {
        orderBy: { order: "asc" },
        include: {
          deals: {
            orderBy: { order: "asc" },
            include: {
              contact: true,
              assignedUser: { select: { id: true, name: true } },
              payments: { orderBy: { paidAt: "asc" } },
              stage: { select: { role: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const allDeals = pipelines.flatMap((p) => p.stages.flatMap((s) => s.deals));
  const progress = await attachFollowUpProgress(organizationId, allDeals);
  const withProgress = pipelines.map((p) => ({
    ...p,
    stages: p.stages.map((s) => ({
      ...s,
      deals: s.deals.map((d) => ({ ...d, followUpProgress: progress.get(d.id) ?? null })),
    })),
  }));
  res.json(withProgress);
}

const createDealSchema = z.object({
  pipelineId: z.string(),
  stageId: z.string(),
  contactId: z.string(),
  title: z.string().min(1),
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

  const deal = await prisma.$transaction((tx) =>
    createDealWithHistory(tx, {
      organization: { connect: { id: organizationId } },
      pipeline: { connect: { id: pipeline.id } },
      stage: { connect: { id: stage.id } },
      contact: { connect: { id: contact.id } },
      title: input.title,
      order: (lastDeal?.order ?? -1) + 1,
    }),
  );
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
    await transitionDealStage(tx, deal.id, deal.stageId, input.stageId);
  });

  const updated = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  res.json(updated);
}

// Lets the inbox show/change a contact's current funnel stage and value without leaving the
// conversation. A contact's "current deal" is just their most recently created one — there's
// only ever one pipeline per org today, so this never has to pick between several.
export async function getContactDeal(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId } });
  if (!contact) throw new HttpError(404, "contact_not_found");

  const deal = await prisma.deal.findFirst({
    where: { contactId: contact.id, organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stageId: true,
      stage: { select: { role: true } },
      payments: { orderBy: { paidAt: "asc" }, select: { id: true, value: true, planType: true, paidAt: true } },
    },
  });
  if (!deal) return res.json(deal);
  const progress = await attachFollowUpProgress(organizationId, [deal]);
  res.json({ ...deal, followUpProgress: progress.get(deal.id) ?? null });
}

async function findOrCreateCurrentDeal(organizationId: string, contactId: string, stageId?: string) {
  const existingDeal = await prisma.deal.findFirst({
    where: { contactId, organizationId },
    orderBy: { createdAt: "desc" },
  });
  if (existingDeal) return existingDeal;

  const contact = await prisma.contact.findFirstOrThrow({ where: { id: contactId, organizationId } });
  let stage = stageId
    ? await prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline: { organizationId } } })
    : null;
  if (!stage) {
    const pipeline = await prisma.pipeline.findFirst({ where: { organizationId, isDefault: true } });
    if (!pipeline) throw new HttpError(400, "no_default_pipeline");
    stage = await prisma.pipelineStage.findFirst({ where: { pipelineId: pipeline.id }, orderBy: { order: "asc" } });
  }
  if (!stage) throw new HttpError(400, "pipeline_has_no_stages");
  const resolvedStage = stage;

  const lastInStage = await prisma.deal.findFirst({ where: { stageId: resolvedStage.id }, orderBy: { order: "desc" } });
  return prisma.$transaction((tx) =>
    createDealWithHistory(tx, {
      organization: { connect: { id: organizationId } },
      pipeline: { connect: { id: resolvedStage.pipelineId } },
      stage: { connect: { id: resolvedStage.id } },
      contact: { connect: { id: contact.id } },
      title: contact.name?.trim() || `+${contact.phoneNumber}`,
      order: (lastInStage?.order ?? -1) + 1,
    }),
  );
}

const setContactDealStageSchema = z.object({ stageId: z.string() });

export async function setContactDealStage(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = setContactDealStageSchema.parse(req.body);

  const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId } });
  if (!contact) throw new HttpError(404, "contact_not_found");

  const stage = await prisma.pipelineStage.findFirst({ where: { id: input.stageId, pipeline: { organizationId } } });
  if (!stage) throw new HttpError(404, "stage_not_found");

  const existingDeal = await prisma.deal.findFirst({
    where: { contactId: contact.id, organizationId },
    orderBy: { createdAt: "desc" },
  });

  if (existingDeal) {
    if (existingDeal.stageId === stage.id) return res.json(existingDeal);
    const lastInStage = await prisma.deal.findFirst({ where: { stageId: stage.id }, orderBy: { order: "desc" } });
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.deal.update({
        where: { id: existingDeal.id },
        data: { pipelineId: stage.pipelineId, stageId: stage.id, order: (lastInStage?.order ?? -1) + 1 },
      });
      await transitionDealStage(tx, existingDeal.id, existingDeal.stageId, stage.id);
      return result;
    });
    return res.json(updated);
  }

  // No deal yet for this contact — picking a stage from the conversation creates one, titled
  // with the contact's own name so it shows up sensibly on the Kanban board right away.
  const lastInStage = await prisma.deal.findFirst({ where: { stageId: stage.id }, orderBy: { order: "desc" } });
  const created = await prisma.$transaction((tx) =>
    createDealWithHistory(tx, {
      organization: { connect: { id: organizationId } },
      pipeline: { connect: { id: stage.pipelineId } },
      stage: { connect: { id: stage.id } },
      contact: { connect: { id: contact.id } },
      title: contact.name?.trim() || `+${contact.phoneNumber}`,
      order: (lastInStage?.order ?? -1) + 1,
    }),
  );
  res.status(201).json(created);
}

const updatePipelineStageRoleSchema = z.object({
  role: z.enum(PIPELINE_STAGE_ROLES).nullable(),
});

export async function updatePipelineStageRole(req: Request, res: Response) {
  const auth = req.auth!;
  if (auth.role !== Role.OWNER && auth.role !== Role.ADMIN) {
    throw new HttpError(403, "only_owner_or_admin_can_change_this");
  }
  const input = updatePipelineStageRoleSchema.parse(req.body);

  const stage = await prisma.pipelineStage.findFirst({
    where: { id: req.params.id, pipeline: { organizationId: auth.organizationId } },
  });
  if (!stage) throw new HttpError(404, "stage_not_found");

  const updated = await prisma.pipelineStage.update({
    where: { id: stage.id },
    data: { role: input.role },
  });
  res.json(updated);
}

const addDealPaymentSchema = z.object({
  value: z.number().min(0),
  planType: z.enum(PLAN_TYPES).nullable().optional(),
});

// A patient can pay more than once over time (renewals, top-ups), so each entry from the
// conversation adds a new DealPayment rather than overwriting a single value — the Kanban
// card and the conversation both show the running total across all of them.
export async function addDealPayment(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = addDealPaymentSchema.parse(req.body);

  const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId } });
  if (!contact) throw new HttpError(404, "contact_not_found");

  const deal = await findOrCreateCurrentDeal(organizationId, contact.id);
  await prisma.dealPayment.create({
    data: { dealId: deal.id, value: input.value, planType: input.planType ?? null },
  });

  const updated = await prisma.deal.findUniqueOrThrow({
    where: { id: deal.id },
    select: {
      id: true,
      stageId: true,
      payments: { orderBy: { paidAt: "asc" }, select: { id: true, value: true, planType: true, paidAt: true } },
    },
  });
  res.status(201).json(updated);
}

export async function deleteDealPayment(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const payment = await prisma.dealPayment.findFirst({
    where: { id: req.params.paymentId, deal: { organizationId } },
  });
  if (!payment) throw new HttpError(404, "payment_not_found");
  await prisma.dealPayment.delete({ where: { id: payment.id } });

  const updated = await prisma.deal.findUniqueOrThrow({
    where: { id: payment.dealId },
    select: {
      id: true,
      stageId: true,
      payments: { orderBy: { paidAt: "asc" }, select: { id: true, value: true, planType: true, paidAt: true } },
    },
  });
  res.json(updated);
}

export async function deleteDeal(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const deal = await prisma.deal.findFirst({ where: { id: req.params.id, organizationId } });
  if (!deal) throw new HttpError(404, "deal_not_found");
  await prisma.deal.delete({ where: { id: deal.id } });
  res.json({ ok: true });
}

export async function exportDeals(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const deals = await prisma.deal.findMany({
    where: { organizationId },
    include: {
      pipeline: { select: { name: true } },
      stage: { select: { name: true } },
      contact: { select: { name: true, phoneNumber: true } },
      assignedUser: { select: { name: true } },
      payments: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Negócios");
  sheet.columns = [
    { header: "Funil", key: "pipeline", width: 20 },
    { header: "Etapa", key: "stage", width: 20 },
    { header: "Negócio", key: "title", width: 30 },
    { header: "Contato", key: "contact", width: 26 },
    { header: "Telefone", key: "phoneNumber", width: 18 },
    { header: "Valor total pago", key: "value", width: 16 },
    { header: "Lançamentos", key: "planType", width: 26 },
    { header: "Responsável", key: "assignedUser", width: 22 },
    { header: "Criado em", key: "createdAt", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn("value").numFmt = '"R$" #,##0.00';

  for (const deal of deals) {
    const totalValue = deal.payments.reduce((sum, p) => sum + p.value, 0);
    const planTypes = deal.payments
      .map((p) => (p.planType ? PLAN_TYPE_LABELS[p.planType as PlanType] ?? p.planType : null))
      .filter((label): label is string => Boolean(label));
    sheet.addRow({
      pipeline: deal.pipeline.name,
      stage: deal.stage.name,
      title: deal.title,
      contact: deal.contact.name ?? "",
      phoneNumber: `+${deal.contact.phoneNumber}`,
      value: totalValue || "",
      planType: planTypes.join(", "),
      assignedUser: deal.assignedUser?.name ?? "",
      createdAt: deal.createdAt.toLocaleString("pt-BR"),
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="negocios.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}
