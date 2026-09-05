import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

function serialize(rule: { id: string; name: string; keywords: string[]; isActive: boolean; order: number; createdAt: Date; tags: { tag: { id: string; name: string; color: string | null } }[] }) {
  const { tags, ...rest } = rule;
  return { ...rest, tags: tags.map((t) => t.tag) };
}

export async function listAutoTagRules(req: Request, res: Response) {
  const rules = await prisma.autoTagRule.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { tags: { include: { tag: true } } },
    orderBy: { order: "asc" },
  });
  res.json(rules.map(serialize));
}

const createSchema = z.object({
  name: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  tagIds: z.array(z.string()).min(1),
});

export async function createAutoTagRule(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);

  const tags = await prisma.tag.findMany({ where: { id: { in: input.tagIds }, organizationId } });
  if (tags.length !== input.tagIds.length) throw new HttpError(404, "tag_not_found");

  const lastRule = await prisma.autoTagRule.findFirst({ where: { organizationId }, orderBy: { order: "desc" } });

  const rule = await prisma.autoTagRule.create({
    data: {
      organizationId,
      name: input.name.trim(),
      keywords: input.keywords.map((k) => k.trim()).filter(Boolean),
      order: (lastRule?.order ?? -1) + 1,
      tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
    },
    include: { tags: { include: { tag: true } } },
  });
  res.status(201).json(serialize(rule));
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).min(1).optional(),
  tagIds: z.array(z.string()).min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function updateAutoTagRule(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const rule = await prisma.autoTagRule.findFirst({ where: { id: req.params.id, organizationId } });
  if (!rule) throw new HttpError(404, "auto_tag_rule_not_found");

  const input = updateSchema.parse(req.body);

  if (input.tagIds) {
    const tags = await prisma.tag.findMany({ where: { id: { in: input.tagIds }, organizationId } });
    if (tags.length !== input.tagIds.length) throw new HttpError(404, "tag_not_found");
    await prisma.autoTagRuleTag.deleteMany({ where: { ruleId: rule.id } });
    await prisma.autoTagRuleTag.createMany({ data: tags.map((tag) => ({ ruleId: rule.id, tagId: tag.id })) });
  }

  const updated = await prisma.autoTagRule.update({
    where: { id: rule.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.keywords ? { keywords: input.keywords.map((k) => k.trim()).filter(Boolean) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: { tags: { include: { tag: true } } },
  });
  res.json(serialize(updated));
}

export async function deleteAutoTagRule(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const rule = await prisma.autoTagRule.findFirst({ where: { id: req.params.id, organizationId } });
  if (!rule) throw new HttpError(404, "auto_tag_rule_not_found");
  await prisma.autoTagRule.delete({ where: { id: rule.id } });
  res.json({ ok: true });
}
