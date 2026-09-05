import { Request, Response } from "express";
import { prisma } from "../../prisma";

export async function listQuickReplyCategories(req: Request, res: Response) {
  const categories = await prisma.quickReplyCategory.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { quickReplies: true },
  });
  res.json(categories);
}

export async function listQuickReplies(req: Request, res: Response) {
  const quickReplies = await prisma.quickReply.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { category: { select: { id: true, name: true, hexColor: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(quickReplies);
}
