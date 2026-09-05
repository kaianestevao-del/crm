import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

export async function listAutoReplyRules(req: Request, res: Response) {
  const rules = await prisma.autoReplyRule.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { order: "asc" },
  });
  res.json(rules);
}

const createSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  reply: z.string().min(1),
});

export async function createAutoReplyRule(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);

  const lastRule = await prisma.autoReplyRule.findFirst({ where: { organizationId }, orderBy: { order: "desc" } });

  const rule = await prisma.autoReplyRule.create({
    data: {
      organizationId,
      keywords: input.keywords.map((k) => k.trim()).filter(Boolean),
      reply: input.reply,
      order: (lastRule?.order ?? -1) + 1,
    },
  });
  res.status(201).json(rule);
}

const updateSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1).optional(),
  reply: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function updateAutoReplyRule(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const rule = await prisma.autoReplyRule.findFirst({ where: { id: req.params.id, organizationId } });
  if (!rule) throw new HttpError(404, "auto_reply_rule_not_found");

  const input = updateSchema.parse(req.body);
  const updated = await prisma.autoReplyRule.update({
    where: { id: rule.id },
    data: {
      ...(input.keywords ? { keywords: input.keywords.map((k) => k.trim()).filter(Boolean) } : {}),
      ...(input.reply !== undefined ? { reply: input.reply } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  res.json(updated);
}

export async function deleteAutoReplyRule(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const rule = await prisma.autoReplyRule.findFirst({ where: { id: req.params.id, organizationId } });
  if (!rule) throw new HttpError(404, "auto_reply_rule_not_found");
  await prisma.autoReplyRule.delete({ where: { id: rule.id } });
  res.json({ ok: true });
}
