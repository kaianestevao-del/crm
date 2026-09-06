import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { sessionCommandsQueue } from "../../queues";

const createSchema = z.object({ name: z.string().min(2) });

export async function listSessions(req: Request, res: Response) {
  const sessions = await prisma.whatsappSession.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "asc" },
  });
  res.json(sessions);
}

export async function createSession(req: Request, res: Response) {
  const input = createSchema.parse(req.body);
  const session = await prisma.whatsappSession.create({
    data: { organizationId: req.auth!.organizationId, name: input.name },
  });
  await sessionCommandsQueue.add("start", { sessionId: session.id, command: "START" });
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
