import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { sessionCommandsQueue } from "../../queues";

const createSchema = z.object({
  name: z.string().min(2),
  // When set, the worker requests a WhatsApp pairing code for this number instead of showing a
  // scannable QR code — for a team member linking their own number remotely.
  pairingPhoneNumber: z.string().min(8).optional(),
});

export async function listSessions(req: Request, res: Response) {
  const sessions = await prisma.whatsappSession.findMany({
    where: { organizationId: req.auth!.organizationId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  res.json(sessions);
}

export async function createSession(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);

  // Default product rule: one active WhatsApp connection per organization. An org that
  // genuinely needs more can still be special-cased later, but nothing today asks for it.
  const existing = await prisma.whatsappSession.findFirst({ where: { organizationId, archivedAt: null } });
  if (existing) throw new HttpError(409, "organization_already_has_a_connection");

  const pairingPhoneNumber = input.pairingPhoneNumber?.replace(/\D/g, "");
  const session = await prisma.whatsappSession.create({
    data: { organizationId, name: input.name },
  });
  await sessionCommandsQueue.add("start", { sessionId: session.id, command: "START", pairingPhoneNumber });
  res.status(201).json(session);
}

async function getOwnedSession(organizationId: string, sessionId: string) {
  const session = await prisma.whatsappSession.findFirst({ where: { id: sessionId, organizationId } });
  if (!session) throw new HttpError(404, "session_not_found");
  return session;
}

export async function getSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  res.json(session);
}

export async function restartSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  await sessionCommandsQueue.add("restart", { sessionId: session.id, command: "RESTART" });
  res.json({ ok: true });
}

export async function logoutSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  await sessionCommandsQueue.add("logout", { sessionId: session.id, command: "LOGOUT" });
  res.json({ ok: true });
}

export async function resyncLabels(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  await sessionCommandsQueue.add("resync-labels", { sessionId: session.id, command: "RESYNC_LABELS" });
  res.json({ ok: true });
}

// Soft-delete only — the underlying Conversations/Messages that went through this number are
// never touched, so a patient's history stays intact even after the connection linking it is
// removed. Logs the device out first so it stops appearing in the phone's own linked-devices
// list too.
export async function deleteSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  await sessionCommandsQueue.add("logout", { sessionId: session.id, command: "LOGOUT" });
  await prisma.whatsappSession.update({ where: { id: session.id }, data: { archivedAt: new Date() } });
  res.json({ ok: true });
}
