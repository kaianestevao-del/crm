import { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { ORIGIN_TAGS_PT, OBJECTIVE_TAGS_PT } from "@crm/shared";
import { AiError, buildSystemPrompt, findActivationKeyword, generateAiReply } from "@crm/ai";

// The whole AI tab is OWNER/ADMIN only — it holds the API key and the rules the assistant
// follows when talking to patients.
function assertOwnerOrAdmin(req: Request) {
  const { role } = req.auth!;
  if (role !== Role.OWNER && role !== Role.ADMIN) throw new HttpError(403, "only_owner_or_admin_can_change_this");
}

function serializePlan(plan: { id: string; name: string; price: unknown; description: string; link: string | null; order: number }) {
  return { ...plan, price: Number(plan.price) };
}

type OrgAiSettings = {
  anthropicApiKey: string | null;
  aiPrompt: string;
  aiEnabled: boolean;
  aiSchedulingUrl: string | null;
  aiSchedulingEnabled: boolean;
  aiStageStartId: string | null;
  aiStageQualifyingId: string | null;
  aiStageNegotiationId: string | null;
};

function settingsResponse(org: OrgAiSettings) {
  return {
    hasApiKey: !!org.anthropicApiKey,
    prompt: org.aiPrompt,
    enabled: org.aiEnabled,
    schedulingUrl: org.aiSchedulingUrl,
    schedulingEnabled: org.aiSchedulingEnabled,
    stageStartId: org.aiStageStartId,
    stageQualifyingId: org.aiStageQualifyingId,
    stageNegotiationId: org.aiStageNegotiationId,
  };
}

// The scheduling link only reaches the assistant while it's switched on.
function activeSchedulingUrl(org: OrgAiSettings) {
  return org.aiSchedulingEnabled && org.aiSchedulingUrl?.trim() ? org.aiSchedulingUrl.trim() : null;
}

export async function getAiSettings(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const [org, plans, links, keywords, stages] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.aiPlan.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.aiLink.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.aiKeyword.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.pipelineStage.findMany({
      where: { pipeline: { organizationId } },
      orderBy: [{ pipeline: { createdAt: "asc" } }, { order: "asc" }],
      select: { id: true, name: true, pipeline: { select: { name: true } } },
    }),
  ]);
  res.json({
    ...settingsResponse(org),
    plans: plans.map(serializePlan),
    links,
    keywords,
    stages: stages.map((s) => ({ id: s.id, name: s.name, pipelineName: s.pipeline.name })),
  });
}

const updateSettingsSchema = z.object({
  anthropicApiKey: z.string().nullable().optional(),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
  schedulingUrl: z.string().trim().url().nullable().or(z.literal("")).optional(),
  schedulingEnabled: z.boolean().optional(),
  stageStartId: z.string().nullable().optional(),
  stageQualifyingId: z.string().nullable().optional(),
  stageNegotiationId: z.string().nullable().optional(),
});

export async function updateAiSettings(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const input = updateSettingsSchema.parse(req.body);

  const stageIds = [input.stageStartId, input.stageQualifyingId, input.stageNegotiationId].filter((id): id is string => !!id);
  if (stageIds.length) {
    const found = await prisma.pipelineStage.count({ where: { id: { in: stageIds }, pipeline: { organizationId } } });
    if (found !== new Set(stageIds).size) throw new HttpError(404, "stage_not_found");
  }

  const current = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (input.enabled && !(input.anthropicApiKey?.trim() || current.anthropicApiKey)) {
    throw new HttpError(400, "anthropic_api_key_missing");
  }
  const schedulingUrl = input.schedulingUrl !== undefined ? input.schedulingUrl || null : current.aiSchedulingUrl;
  if (input.schedulingEnabled && !schedulingUrl) throw new HttpError(400, "scheduling_url_missing");

  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      ...(input.anthropicApiKey !== undefined ? { anthropicApiKey: input.anthropicApiKey?.trim() || null } : {}),
      ...(input.prompt !== undefined ? { aiPrompt: input.prompt } : {}),
      ...(input.enabled !== undefined ? { aiEnabled: input.enabled } : {}),
      ...(input.schedulingUrl !== undefined ? { aiSchedulingUrl: schedulingUrl } : {}),
      // Clearing the link also switches it off, so the toggle never shows "on" with nothing to send.
      ...(input.schedulingEnabled !== undefined || !schedulingUrl
        ? { aiSchedulingEnabled: !!schedulingUrl && (input.schedulingEnabled ?? current.aiSchedulingEnabled) }
        : {}),
      ...(input.stageStartId !== undefined ? { aiStageStartId: input.stageStartId } : {}),
      ...(input.stageQualifyingId !== undefined ? { aiStageQualifyingId: input.stageQualifyingId } : {}),
      ...(input.stageNegotiationId !== undefined ? { aiStageNegotiationId: input.stageNegotiationId } : {}),
    },
  });
  res.json(settingsResponse(org));
}

const planSchema = z.object({
  name: z.string().trim().min(1),
  price: z.number().min(0),
  description: z.string().default(""),
  link: z.string().trim().nullable().optional(),
});

export async function createAiPlan(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const input = planSchema.parse(req.body);
  const last = await prisma.aiPlan.findFirst({ where: { organizationId }, orderBy: { order: "desc" } });
  const plan = await prisma.aiPlan.create({
    data: { ...input, link: input.link || null, organizationId, order: (last?.order ?? -1) + 1 },
  });
  res.status(201).json(serializePlan(plan));
}

export async function updateAiPlan(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const plan = await prisma.aiPlan.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!plan) throw new HttpError(404, "ai_plan_not_found");
  const input = planSchema.partial().parse(req.body);
  const updated = await prisma.aiPlan.update({
    where: { id: plan.id },
    data: { ...input, ...(input.link !== undefined ? { link: input.link || null } : {}) },
  });
  res.json(serializePlan(updated));
}

export async function deleteAiPlan(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const plan = await prisma.aiPlan.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!plan) throw new HttpError(404, "ai_plan_not_found");
  await prisma.aiPlan.delete({ where: { id: plan.id } });
  res.json({ ok: true });
}

const linkSchema = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().url(),
  whenToUse: z.string().default(""),
});

export async function createAiLink(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const input = linkSchema.parse(req.body);
  const last = await prisma.aiLink.findFirst({ where: { organizationId }, orderBy: { order: "desc" } });
  const link = await prisma.aiLink.create({ data: { ...input, organizationId, order: (last?.order ?? -1) + 1 } });
  res.status(201).json(link);
}

export async function updateAiLink(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const link = await prisma.aiLink.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!link) throw new HttpError(404, "ai_link_not_found");
  const updated = await prisma.aiLink.update({ where: { id: link.id }, data: linkSchema.partial().parse(req.body) });
  res.json(updated);
}

export async function deleteAiLink(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const link = await prisma.aiLink.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!link) throw new HttpError(404, "ai_link_not_found");
  await prisma.aiLink.delete({ where: { id: link.id } });
  res.json({ ok: true });
}

const keywordSchema = z.object({
  phrase: z.string().trim().min(1),
  origin: z.enum(ORIGIN_TAGS_PT).nullable().optional(),
});

export async function createAiKeyword(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const input = keywordSchema.parse(req.body);
  const keyword = await prisma.aiKeyword.create({
    data: { phrase: input.phrase, origin: input.origin ?? null, organizationId: req.auth!.organizationId },
  });
  res.status(201).json(keyword);
}

export async function updateAiKeyword(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const keyword = await prisma.aiKeyword.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!keyword) throw new HttpError(404, "ai_keyword_not_found");
  const updated = await prisma.aiKeyword.update({ where: { id: keyword.id }, data: keywordSchema.partial().parse(req.body) });
  res.json(updated);
}

export async function deleteAiKeyword(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const keyword = await prisma.aiKeyword.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!keyword) throw new HttpError(404, "ai_keyword_not_found");
  await prisma.aiKeyword.delete({ where: { id: keyword.id } });
  res.json({ ok: true });
}

const simulateSchema = z.object({
  turns: z
    .array(z.object({ role: z.enum(["customer", "assistant"]), text: z.string().trim().min(1) }))
    .min(1)
    .refine((turns) => turns[0].role === "customer", "first_turn_must_be_customer"),
});

// Simulator only: runs the saved prompt + plans against a conversation typed in the AI tab and
// returns the reply. Nothing is read from or sent to WhatsApp.
export async function simulateAiReply(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const { turns } = simulateSchema.parse(req.body);
  const [org, plans, links, keywords] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.aiPlan.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.aiLink.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.aiKeyword.findMany({ where: { organizationId } }),
  ]);
  if (!org.anthropicApiKey) throw new HttpError(400, "anthropic_api_key_missing");

  const systemPrompt = buildSystemPrompt(org.name, org.aiPrompt, plans, links, activeSchedulingUrl(org), [...OBJECTIVE_TAGS_PT]);
  let reply;
  try {
    reply = await generateAiReply(org.anthropicApiKey, systemPrompt, turns);
  } catch (err) {
    if (err instanceof AiError) throw new HttpError(err.status, err.code);
    throw err;
  }
  // Whether the conversation's opening message would have switched the assistant on for real —
  // the simulator always answers, so it shows this as a warning instead of staying silent.
  const keyword = findActivationKeyword(turns[0].text, keywords);
  res.json({ ...reply, activated: !!keyword, origin: keyword?.origin ?? null });
}
