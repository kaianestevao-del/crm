import { Request, Response } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { labelCommandsQueue } from "../../queues";

export async function listContacts(req: Request, res: Response) {
  const contacts = await prisma.contact.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: {
      tags: { include: { tag: true } },
      whatsappLabels: { include: { label: true } },
      _count: { select: { conversations: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    contacts.map(({ tags, whatsappLabels, _count, ...contact }) => ({
      ...contact,
      tags: tags.map((t) => t.tag),
      whatsappLabels: whatsappLabels.map((l) => l.label),
      hasConversation: _count.conversations > 0,
    })),
  );
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

const createNoteSchema = z.object({ content: z.string().min(1) });

export async function createContactNote(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contact = await prisma.contact.findFirst({ where: { id: req.params.id, organizationId } });
  if (!contact) return res.status(404).json({ error: "contact_not_found" });

  const input = createNoteSchema.parse(req.body);
  const note = await prisma.note.create({
    data: { organizationId, contactId: contact.id, content: input.content },
  });
  res.status(201).json(note);
}

async function getOwnedContact(organizationId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) throw new HttpError(404, "contact_not_found");
  return contact;
}

const addTagSchema = z.object({ tagId: z.string() });

export async function addContactTag(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contact = await getOwnedContact(organizationId, req.params.id);
  const input = addTagSchema.parse(req.body);

  const tag = await prisma.tag.findFirst({ where: { id: input.tagId, organizationId } });
  if (!tag) throw new HttpError(404, "tag_not_found");

  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
    update: {},
    create: { contactId: contact.id, tagId: tag.id },
  });
  res.status(201).json(tag);
}

export async function removeContactTag(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contact = await getOwnedContact(organizationId, req.params.id);
  await prisma.contactTag.deleteMany({ where: { contactId: contact.id, tagId: req.params.tagId } });
  res.json({ ok: true });
}

// A contact isn't tied to a single WhatsApp session in the schema — it's tied to whichever
// session(s) it has conversations with. We resolve the most recently active one for actions
// (like adding a WhatsApp label) that need a live socket, falling back to the org's only
// connected session for a contact that has no conversation yet.
async function resolveSessionIdForContact(organizationId: string, contactId: string): Promise<string> {
  const conversation = await prisma.conversation.findFirst({
    where: { organizationId, contactId },
    orderBy: { lastMessageAt: "desc" },
    select: { whatsappSessionId: true },
  });
  if (conversation) return conversation.whatsappSessionId;

  const session = await prisma.whatsappSession.findFirst({ where: { organizationId, status: "CONNECTED" } });
  if (!session) throw new HttpError(400, "no_connected_whatsapp_session");
  return session.id;
}

const addWaLabelSchema = z.object({ waLabelId: z.string() });

export async function addContactWhatsappLabel(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contact = await getOwnedContact(organizationId, req.params.id);
  const input = addWaLabelSchema.parse(req.body);
  const sessionId = await resolveSessionIdForContact(organizationId, contact.id);

  // Fire-and-forget: WhatsApp's own `labels.association` event is what actually links the
  // label to this contact in our database once the phone confirms it.
  await labelCommandsQueue.add("add", { action: "add", sessionId, waJid: contact.waJid, waLabelId: input.waLabelId });
  res.status(202).json({ ok: true });
}

export async function removeContactWhatsappLabel(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contact = await getOwnedContact(organizationId, req.params.id);
  const sessionId = await resolveSessionIdForContact(organizationId, contact.id);

  await labelCommandsQueue.add("remove", {
    action: "remove",
    sessionId,
    waJid: contact.waJid,
    waLabelId: req.params.labelId,
  });
  res.status(202).json({ ok: true });
}

export async function exportContacts(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const contacts = await prisma.contact.findMany({
    where: { organizationId },
    include: {
      tags: { include: { tag: true } },
      whatsappLabels: { include: { label: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contatos");
  sheet.columns = [
    { header: "Nome", key: "name", width: 28 },
    { header: "Telefone", key: "phoneNumber", width: 18 },
    { header: "Abas (CRM)", key: "tags", width: 30 },
    { header: "Etiquetas do WhatsApp", key: "whatsappLabels", width: 30 },
    { header: "Criado em", key: "createdAt", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const contact of contacts) {
    sheet.addRow({
      name: contact.name ?? "",
      phoneNumber: `+${contact.phoneNumber}`,
      tags: contact.tags.map((t) => t.tag.name).join(", "),
      whatsappLabels: contact.whatsappLabels.map((l) => l.label.name).join(", "),
      createdAt: contact.createdAt.toLocaleString("pt-BR"),
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="contatos.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}
