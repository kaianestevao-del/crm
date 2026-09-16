import { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

function toOrgResponse(org: {
  id: string;
  name: string;
  groqApiKey: string | null;
  autoTaggingEnabled: boolean;
  followUpMessageTarget: number;
  quickReplyStepDelaySeconds: number;
  templatePriceMarketing: unknown;
  templatePriceUtility: unknown;
}) {
  return {
    id: org.id,
    name: org.name,
    hasGroqApiKey: !!org.groqApiKey,
    autoTaggingEnabled: org.autoTaggingEnabled,
    followUpMessageTarget: org.followUpMessageTarget,
    quickReplyStepDelaySeconds: org.quickReplyStepDelaySeconds,
    templatePriceMarketing: Number(org.templatePriceMarketing),
    templatePriceUtility: Number(org.templatePriceUtility),
  };
}

export async function getMyOrganization(req: Request, res: Response) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth!.organizationId } });
  res.json(toOrgResponse(org));
}

const updateSchema = z.object({
  groqApiKey: z.string().nullable().optional(),
  autoTaggingEnabled: z.boolean().optional(),
  followUpMessageTarget: z.number().int().min(1).optional(),
  quickReplyStepDelaySeconds: z.number().int().min(0).max(30).optional(),
  templatePriceMarketing: z.number().min(0).optional(),
  templatePriceUtility: z.number().min(0).optional(),
});

export async function updateMyOrganization(req: Request, res: Response) {
  const auth = req.auth!;
  if (auth.role !== Role.OWNER && auth.role !== Role.ADMIN) {
    throw new HttpError(403, "only_owner_or_admin_can_change_this");
  }
  const input = updateSchema.parse(req.body);
  const org = await prisma.organization.update({
    where: { id: auth.organizationId },
    data: {
      ...(input.groqApiKey !== undefined ? { groqApiKey: input.groqApiKey?.trim() || null } : {}),
      ...(input.autoTaggingEnabled !== undefined ? { autoTaggingEnabled: input.autoTaggingEnabled } : {}),
      ...(input.followUpMessageTarget !== undefined ? { followUpMessageTarget: input.followUpMessageTarget } : {}),
      ...(input.quickReplyStepDelaySeconds !== undefined ? { quickReplyStepDelaySeconds: input.quickReplyStepDelaySeconds } : {}),
      ...(input.templatePriceMarketing !== undefined ? { templatePriceMarketing: input.templatePriceMarketing } : {}),
      ...(input.templatePriceUtility !== undefined ? { templatePriceUtility: input.templatePriceUtility } : {}),
    },
  });
  res.json(toOrgResponse(org));
}
