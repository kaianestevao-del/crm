import { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { buildSystemPrompt, generateAiReply } from "./ai-prompt";

// The whole AI tab is OWNER/ADMIN only — it holds the API key and the rules the assistant
// follows when talking to patients.
function assertOwnerOrAdmin(req: Request) {
  const { role } = req.auth!;
  if (role !== Role.OWNER && role !== Role.ADMIN) throw new HttpError(403, "only_owner_or_admin_can_change_this");
}

function serializePlan(plan: { id: string; name: string; price: unknown; description: string; link: string | null; order: number }) {
  return { ...plan, price: Number(plan.price) };
}

export async function getAiSettings(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const [org, plans] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.aiPlan.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
  ]);
  res.json({ hasApiKey: !!org.anthropicApiKey, prompt: org.aiPrompt, plans: plans.map(serializePlan) });
}

const updateSettingsSchema = z.object({
  anthropicApiKey: z.string().nullable().optional(),
  prompt: z.string().optional(),
});

export async function updateAiSettings(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const input = updateSettingsSchema.parse(req.body);
  const org = await prisma.organization.update({
    where: { id: req.auth!.organizationId },
    data: {
      ...(input.anthropicApiKey !== undefined ? { anthropicApiKey: input.anthropicApiKey?.trim() || null } : {}),
      ...(input.prompt !== undefined ? { aiPrompt: input.prompt } : {}),
    },
  });
  res.json({ hasApiKey: !!org.anthropicApiKey, prompt: org.aiPrompt });
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
  const [org, plans] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.aiPlan.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
  ]);
  if (!org.anthropicApiKey) throw new HttpError(400, "anthropic_api_key_missing");

  const systemPrompt = buildSystemPrompt(org.name, org.aiPrompt, plans);
  res.json(await generateAiReply(org.anthropicApiKey, systemPrompt, turns));
}
