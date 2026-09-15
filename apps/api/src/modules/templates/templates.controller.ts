import { Request, Response } from "express";
import { z } from "zod";
import { TemplateCategory } from "@crm/db";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

const CLOUD_API_BASE = "https://graph.facebook.com/v21.0";

// Every org here is single-tenant in practice (one clinic per deployment, same assumption the
// daily backup worker already makes) — Templates/Campaigns act on whichever Cloud API session
// is currently connected, with no per-org picker to build.
async function getOwnedCloudApiSession(organizationId: string) {
  const session = await prisma.whatsappSession.findFirst({
    where: { organizationId, provider: "CLOUD_API", archivedAt: null },
  });
  if (!session) throw new HttpError(400, "no_cloud_api_session_connected");
  if (!session.cloudApiWabaId || !session.cloudApiAccessToken) {
    throw new HttpError(400, "cloud_api_waba_not_configured");
  }
  return session as typeof session & { cloudApiWabaId: string; cloudApiAccessToken: string };
}

function countVariables(bodyText: string): number {
  const matches = new Set(Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]));
  return matches.size;
}

export async function listTemplates(req: Request, res: Response) {
  const templates = await prisma.messageTemplate.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
  });
  res.json(templates);
}

const createSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/, "name_must_be_lowercase_underscore"),
  category: z.nativeEnum(TemplateCategory),
  language: z.string().min(1).default("pt_BR"),
  bodyText: z.string().min(1),
  bodyExamples: z.array(z.string().min(1)).optional().default([]),
});

export async function createTemplate(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);
  const session = await prisma.whatsappSession.findFirst({
    where: { organizationId, provider: "CLOUD_API", archivedAt: null },
  });
  if (!session) throw new HttpError(400, "no_cloud_api_session_connected");

  const variableCount = countVariables(input.bodyText);
  if (input.bodyExamples.length !== variableCount) {
    throw new HttpError(400, "body_examples_count_mismatch");
  }

  const template = await prisma.messageTemplate.create({
    data: {
      organizationId,
      whatsappSessionId: session.id,
      name: input.name,
      category: input.category,
      language: input.language,
      bodyText: input.bodyText,
      variableCount,
      bodyExamples: input.bodyExamples,
    },
  });
  res.status(201).json(template);
}

async function getOwnedTemplate(organizationId: string, id: string) {
  const template = await prisma.messageTemplate.findFirst({ where: { id, organizationId } });
  if (!template) throw new HttpError(404, "template_not_found");
  return template;
}

// Only DRAFT/REJECTED templates can be edited in place — once submitted (PENDING/APPROVED),
// Meta owns that name/version, so changing it here would just diverge from what Meta has.
export async function updateTemplate(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const template = await getOwnedTemplate(organizationId, req.params.id);
  if (template.status !== "DRAFT" && template.status !== "REJECTED") {
    throw new HttpError(400, "template_not_editable");
  }
  const input = createSchema.parse(req.body);
  const variableCount = countVariables(input.bodyText);
  if (input.bodyExamples.length !== variableCount) {
    throw new HttpError(400, "body_examples_count_mismatch");
  }

  const updated = await prisma.messageTemplate.update({
    where: { id: template.id },
    data: {
      name: input.name,
      category: input.category,
      language: input.language,
      bodyText: input.bodyText,
      variableCount,
      bodyExamples: input.bodyExamples,
      // Editing a rejected template clears the old reason — it no longer describes the new content.
      rejectionReason: null,
    },
  });
  res.json(updated);
}

// Sends the template to Meta for review. Meta's own create-template response already includes
// a status (usually PENDING, sometimes APPROVED instantly for simple templates), so that's used
// directly instead of always assuming PENDING.
export async function submitTemplate(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const template = await getOwnedTemplate(organizationId, req.params.id);
  if (template.status !== "DRAFT" && template.status !== "REJECTED") {
    throw new HttpError(400, "template_already_submitted");
  }
  const session = await getOwnedCloudApiSession(organizationId);

  const res_ = await fetch(`${CLOUD_API_BASE}/${session.cloudApiWabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.cloudApiAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: template.name,
      category: template.category,
      language: template.language,
      components: [
        {
          type: "BODY",
          text: template.bodyText,
          ...(template.bodyExamples.length ? { example: { body_text: [template.bodyExamples] } } : {}),
        },
      ],
    }),
  });
  const data = (await res_.json()) as {
    id?: string;
    status?: string;
    error?: { message?: string; error_user_msg?: string; error_data?: { details?: string } };
  };
  if (!res_.ok || !data.id) {
    const detail = data.error?.error_user_msg ?? data.error?.error_data?.details ?? data.error?.message ?? JSON.stringify(data);
    throw new HttpError(400, `meta_template_submit_failed:${detail}`);
  }

  const updated = await prisma.messageTemplate.update({
    where: { id: template.id },
    data: { metaTemplateId: data.id, status: (data.status as "PENDING" | "APPROVED") ?? "PENDING", rejectionReason: null },
  });
  res.json(updated);
}

// Meta doesn't push approval/rejection to us — this is a manual "check now" the UI can call
// (Templates page has an "Atualizar status" button), plus a periodic worker job for
// templates the org never comes back to check on.
export async function syncTemplateStatus(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const template = await getOwnedTemplate(organizationId, req.params.id);
  if (!template.metaTemplateId) throw new HttpError(400, "template_not_submitted");
  const session = await getOwnedCloudApiSession(organizationId);

  const res_ = await fetch(
    `${CLOUD_API_BASE}/${template.metaTemplateId}?fields=status,rejected_reason`,
    { headers: { Authorization: `Bearer ${session.cloudApiAccessToken}` } },
  );
  const data = (await res_.json()) as { status?: string; rejected_reason?: string };
  if (!res_.ok || !data.status) throw new HttpError(400, "meta_template_status_check_failed");

  const updated = await prisma.messageTemplate.update({
    where: { id: template.id },
    data: {
      status: data.status as "PENDING" | "APPROVED" | "REJECTED",
      rejectionReason: data.status === "REJECTED" ? data.rejected_reason ?? null : null,
    },
  });
  res.json(updated);
}

export async function deleteTemplate(req: Request, res: Response) {
  const template = await getOwnedTemplate(req.auth!.organizationId, req.params.id);
  await prisma.messageTemplate.delete({ where: { id: template.id } });
  res.json({ ok: true });
}
