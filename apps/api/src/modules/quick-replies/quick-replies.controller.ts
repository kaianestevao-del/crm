import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { z } from "zod";
import { QuickReplyType } from "@crm/db";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

const QUICK_REPLY_UPLOADS_DIR = path.join(__dirname, "../../../uploads/quick-replies");

function deleteMediaFile(mediaUrl: string | null) {
  if (!mediaUrl) return;
  const filePath = path.join(QUICK_REPLY_UPLOADS_DIR, mediaUrl.split("/").pop()!);
  fs.unlink(filePath, () => {});
}

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

const stepInclude = { steps: { orderBy: { order: "asc" as const } } };

export async function listQuickReplies(req: Request, res: Response) {
  const quickReplies = await prisma.quickReply.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { category: { select: { id: true, name: true, hexColor: true } }, ...stepInclude },
    orderBy: { createdAt: "asc" },
  });
  res.json(quickReplies);
}

async function getOwnedQuickReply(organizationId: string, id: string) {
  const quickReply = await prisma.quickReply.findFirst({ where: { id, organizationId }, include: stepInclude });
  if (!quickReply) throw new HttpError(404, "quick_reply_not_found");
  return quickReply;
}

// One entry per message the quick reply will send, in order. `hasNewFile: true` means the
// matching file for this step is the next one (in order) inside the `files` multipart field;
// otherwise, for a non-TEXT step, `existingMediaUrl`/`existingMediaName` carries over a file
// already uploaded on a previous save (editing a step's caption doesn't require re-uploading it).
const stepInputSchema = z.object({
  type: z.nativeEnum(QuickReplyType),
  content: z.string().optional(),
  hasNewFile: z.boolean().optional(),
  existingMediaUrl: z.string().optional(),
  existingMediaName: z.string().optional(),
});

const upsertSchema = z.object({
  title: z.string().min(1),
  categoryId: z.string().optional().nullable(),
  steps: z
    .string()
    .transform((raw, ctx) => {
      try {
        return z.array(stepInputSchema).min(1).parse(JSON.parse(raw));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_steps_json" });
        return z.NEVER;
      }
    }),
});

// Builds the create-input for each step, consuming uploaded files in order for steps flagged
// `hasNewFile`. Throws if a non-TEXT step has neither a new file nor an existing one to reuse.
function buildStepsData(steps: z.infer<typeof upsertSchema>["steps"], files: Express.Multer.File[]) {
  let fileIndex = 0;
  return steps.map((step, order) => {
    let mediaUrl = step.existingMediaUrl ?? null;
    let mediaName = step.existingMediaName ?? null;
    if (step.hasNewFile) {
      const file = files[fileIndex++];
      if (!file) throw new HttpError(400, "missing_file_for_step");
      mediaUrl = `/uploads/quick-replies/${file.filename}`;
      mediaName = file.originalname;
    }
    if (step.type !== QuickReplyType.TEXT && !mediaUrl) {
      throw new HttpError(400, "media_file_required_for_this_type");
    }
    return { order, type: step.type, content: step.content || null, mediaUrl, mediaName };
  });
}

export async function createQuickReply(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = upsertSchema.parse(req.body);
  const stepsData = buildStepsData(input.steps, (req.files as Express.Multer.File[] | undefined) ?? []);

  const quickReply = await prisma.quickReply.create({
    data: {
      organizationId,
      title: input.title,
      categoryId: input.categoryId || null,
      steps: { create: stepsData },
    },
    include: stepInclude,
  });
  res.status(201).json(quickReply);
}

export async function updateQuickReply(req: Request, res: Response) {
  const existing = await getOwnedQuickReply(req.auth!.organizationId, req.params.id);
  const input = upsertSchema.parse(req.body);
  const stepsData = buildStepsData(input.steps, (req.files as Express.Multer.File[] | undefined) ?? []);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.quickReplyStep.deleteMany({ where: { quickReplyId: existing.id } });
    return tx.quickReply.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        categoryId: input.categoryId === undefined ? undefined : input.categoryId,
        steps: { create: stepsData },
      },
      include: stepInclude,
    });
  });

  // Only delete files that are no longer referenced by any step after the save.
  const keptUrls = new Set(stepsData.map((s) => s.mediaUrl).filter((u): u is string => !!u));
  for (const oldStep of existing.steps) {
    if (oldStep.mediaUrl && !keptUrls.has(oldStep.mediaUrl)) deleteMediaFile(oldStep.mediaUrl);
  }

  res.json(updated);
}

export async function deleteQuickReply(req: Request, res: Response) {
  const quickReply = await getOwnedQuickReply(req.auth!.organizationId, req.params.id);
  await prisma.quickReply.delete({ where: { id: quickReply.id } });
  for (const step of quickReply.steps) deleteMediaFile(step.mediaUrl);
  res.json({ ok: true });
}
