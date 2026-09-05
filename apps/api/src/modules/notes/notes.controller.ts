import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

async function getOwnedNote(organizationId: string, noteId: string) {
  const note = await prisma.note.findFirst({ where: { id: noteId, organizationId } });
  if (!note) throw new HttpError(404, "note_not_found");
  return note;
}

const updateNoteSchema = z.object({ content: z.string().min(1) });

export async function updateNote(req: Request, res: Response) {
  const note = await getOwnedNote(req.auth!.organizationId, req.params.id);
  const input = updateNoteSchema.parse(req.body);
  const updated = await prisma.note.update({ where: { id: note.id }, data: { content: input.content } });
  res.json(updated);
}

export async function deleteNote(req: Request, res: Response) {
  const note = await getOwnedNote(req.auth!.organizationId, req.params.id);
  await prisma.note.delete({ where: { id: note.id } });
  res.json({ ok: true });
}
