import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";

export async function listContacts(req: Request, res: Response) {
  const contacts = await prisma.contact.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
  });
  res.json(contacts);
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

const createSchema = z.object({
  name: z.string().min(1).optional(),
  phoneNumber: z.string().min(8),
});

export async function createContact(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);
  const phoneNumber = normalizePhone(input.phoneNumber);
  const waJid = `${phoneNumber}@s.whatsapp.net`;

  const contact = await prisma.contact.upsert({
    where: { organizationId_waJid: { organizationId, waJid } },
    update: { name: input.name },
    create: { organizationId, waJid, phoneNumber, name: input.name },
  });
  res.status(201).json(contact);
}

export async function listContactNotes(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contact = await prisma.contact.findFirst({ where: { id: req.params.id, organizationId } });
  if (!contact) return res.status(404).json({ error: "contact_not_found" });

  const notes = await prisma.note.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(notes);
}
