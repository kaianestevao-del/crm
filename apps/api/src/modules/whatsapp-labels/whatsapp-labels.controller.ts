import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { labelCommandsQueue } from "../../queues";

export async function listWhatsappLabels(req: Request, res: Response) {
  const labels = await prisma.whatsappLabel.findMany({
    where: { whatsappSession: { organizationId: req.auth!.organizationId } },
    orderBy: { name: "asc" },
  });
  res.json(labels);
}

const createSchema = z.object({ name: z.string().min(1), color: z.number().int().min(0).max(19).optional() });

export async function createWhatsappLabel(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const session = await prisma.whatsappSession.findFirst({
    where: { organizationId, status: "CONNECTED", archivedAt: null },
  });
  if (!session) throw new HttpError(400, "no_connected_whatsapp_session");

  const input = createSchema.parse(req.body);
  // Fire-and-forget: WhatsApp's own `labels.edit` event is what actually creates the row in
  // our database once the phone confirms it (see session-manager.ts).
  await labelCommandsQueue.add("create", { action: "create", sessionId: session.id, name: input.name, color: input.color });
  res.status(202).json({ ok: true });
}
