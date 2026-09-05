import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

export async function listTags(req: Request, res: Response) {
  const tags = await prisma.tag.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { name: "asc" },
  });
  res.json(tags);
}

const createTagSchema = z.object({ name: z.string().min(1), color: z.string().optional() });

export async function createTag(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createTagSchema.parse(req.body);
  const tag = await prisma.tag.upsert({
    where: { organizationId_name: { organizationId, name: input.name } },
    update: {},
    create: { organizationId, name: input.name, color: input.color },
  });
  res.status(201).json(tag);
}

export async function deleteTag(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const tag = await prisma.tag.findFirst({ where: { id: req.params.id, organizationId } });
  if (!tag) throw new HttpError(404, "tag_not_found");
  await prisma.tag.delete({ where: { id: tag.id } });
  res.json({ ok: true });
}
