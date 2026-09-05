import fs from "fs";
import { Request, Response } from "express";
import { z } from "zod";
import { QuickReplyType } from "@crm/db";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

export async function listQuickReplyCategories(req: Request, res: Response) {
  const categories = await prisma.quickReplyCategory.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { quickReplies: true },
  });
  res.json(categories);
}

const createCategorySchema = z.object({ name: z.string().min(1), hexColor: z.string().optional() });

export async function createQuickReplyCategory(req: Request, res: Response) {
  const input = createCategorySchema.parse(req.body);
  const category = await prisma.quickReplyCategory.create({
    data: { organizationId: req.auth!.organizationId, name: input.name, hexColor: input.hexColor },
  });
  res.status(201).json(category);
}

export async function deleteQuickReplyCategory(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const category = await prisma.quickReplyCategory.findFirst({ where: { id: req.params.id, organizationId } });
  if (!category) throw new HttpError(404, "category_not_found");
  await prisma.quickReplyCategory.delete({ where: { id: category.id } });
  res.json({ ok: true });
}

export async function listQuickReplies(req: Request, res: Response) {
  const quickReplies = await prisma.quickReply.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { category: { select: { id: true, name: true, hexColor: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(quickReplies);
}

async function getOwnedQuickReply(organizationId: string, id: string) {
  const quickReply = await prisma.quickReply.findFirst({ where: { id, organizationId } });
  if (!quickReply) throw new HttpError(404, "quick_reply_not_found");
  return quickReply;
}

const upsertSchema = z.object({
  title: z.string().min(1),
  type: z.nativeEnum(QuickReplyType).default(QuickReplyType.TEXT),
  content: z.string().optional(),
  categoryId: z.string().optional().nullable(),
});

export async function createQuickReply(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = upsertSchema.parse(req.body);
  const file = req.file;

  if (input.type !== QuickReplyType.TEXT && !file) {
    throw new HttpError(400, "media_file_required_for_this_type");
  }

  const quickReply = await prisma.quickReply.create({
    data: {
      organizationId,
      title: input.title,
      type: input.type,
      content: input.content || null,
      categoryId: input.categoryId || null,
      mediaUrl: file ? `/uploads/quick-replies/${file.filename}` : null,
      mediaName: file ? file.originalname : null,
    },
  });
  res.status(201).json(quickReply);
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  categoryId: z.string().optional().nullable(),
});

export async function updateQuickReply(req: Request, res: Response) {
  const quickReply = await getOwnedQuickReply(req.auth!.organizationId, req.params.id);
  const input = updateSchema.parse(req.body);
  const file = req.file;

  const updated = await prisma.quickReply.update({
    where: { id: quickReply.id },
    data: {
      title: input.title,
      content: input.content,
      categoryId: input.categoryId === undefined ? undefined : input.categoryId,
      ...(file
        ? { mediaUrl: `/uploads/quick-replies/${file.filename}`, mediaName: file.originalname }
        : {}),
    },
  });

  // Replacing the media file: remove the old one from disk now that the DB points elsewhere.
  if (file && quickReply.mediaUrl) {
    const oldPath = `${__dirname}/../../../uploads/quick-replies/${quickReply.mediaUrl.split("/").pop()}`;
    fs.unlink(oldPath, () => {});
  }

  res.json(updated);
}

export async function deleteQuickReply(req: Request, res: Response) {
  const quickReply = await getOwnedQuickReply(req.auth!.organizationId, req.params.id);
  await prisma.quickReply.delete({ where: { id: quickReply.id } });
  if (quickReply.mediaUrl) {
    const filePath = `${__dirname}/../../../uploads/quick-replies/${quickReply.mediaUrl.split("/").pop()}`;
    fs.unlink(filePath, () => {});
  }
  res.json({ ok: true });
}
