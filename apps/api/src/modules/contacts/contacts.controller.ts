import { Request, Response } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { ORIGIN_TAGS_PT, isMonthYearTagName, isObjectiveTagName } from "@crm/shared";

const isOriginTagName = (name: string) => (ORIGIN_TAGS_PT as readonly string[]).includes(name);

export async function listContacts(req: Request, res: Response) {
  const contacts = await prisma.contact.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: {
      tags: { include: { tag: true } },
      // Latest deal only — its stage is the contact's Kanban stage (same rule as the export).
      deals: { orderBy: { createdAt: "desc" }, take: 1, select: { stage: { select: { id: true, name: true, order: true } } } },
      _count: { select: { conversations: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    contacts.map(({ tags, deals, _count, ...contact }) => ({
      ...contact,
      tags: tags.map((t) => t.tag),
      stage: deals[0]?.stage ?? null,
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

const updateNameSchema = z.object({ name: z.string().min(1) });

export async function updateContactName(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = updateNameSchema.parse(req.body);
  const contact = await prisma.contact.findFirst({ where: { id: req.params.id, organizationId } });
  if (!contact) throw new HttpError(404, "contact_not_found");

  const updated = await prisma.contact.update({ where: { id: contact.id }, data: { name: input.name.trim() } });
  res.json(updated);
}

const updateObjectiveSchema = z.object({ objective: z.string() });

// The contact's objective ("emagrecer 10 kg"...) — filled in by the AI assistant, editable here.
export async function updateContactObjective(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = updateObjectiveSchema.parse(req.body);
  const contact = await prisma.contact.findFirst({ where: { id: req.params.id, organizationId } });
  if (!contact) throw new HttpError(404, "contact_not_found");

  const updated = await prisma.contact.update({ where: { id: contact.id }, data: { objective: input.objective.trim() || null } });
  res.json(updated);
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

// Comma-separated ids from one query param ("" / absent → []).
function idList(value: unknown) {
  return typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

// Same filters as the Contacts page, so "Baixar filtrados" downloads exactly what's on screen.
// Each param is one filter holding several picks: ?months=, ?objectives=, ?origins= (tag ids)
// and ?stages= (Kanban stage ids of the latest deal, "none" = no deal yet). Inside a filter any
// pick matches (setembro OR novembro); across filters all must match (mês AND objetivo). No
// param at all means "download all".
export async function exportContacts(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const tagGroups = [idList(req.query.months), idList(req.query.objectives), idList(req.query.origins)].filter((g) => g.length);
  const stages = idList(req.query.stages);

  const found = await prisma.contact.findMany({
    where: {
      organizationId,
      ...(tagGroups.length > 0 ? { AND: tagGroups.map((ids) => ({ tags: { some: { tagId: { in: ids } } } })) } : {}),
    },
    include: {
      tags: { include: { tag: true } },
      deals: {
        include: { payments: true, stage: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  // One row per phone number — the same person saved twice (by phone and by WhatsApp's LID)
  // shows up once; the most recent record wins.
  const seenPhones = new Set<string>();
  const contacts = found
    .filter((c) => !stages.length || stages.includes(c.deals[0]?.stageId ?? "none"))
    .filter((c) => {
      const phone = c.phoneNumber.replace(/\D/g, "");
      if (seenPhones.has(phone)) return false;
      seenPhones.add(phone);
      return true;
    });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contatos");
  sheet.columns = [
    { header: "Nome", key: "name", width: 28 },
    { header: "Telefone", key: "phoneNumber", width: 18 },
    { header: "Mês/Ano de chegada", key: "month", width: 18 },
    { header: "Objetivo", key: "objective", width: 28 },
    { header: "Origem", key: "origin", width: 26 },
    { header: "Outras abas", key: "tags", width: 30 },
    { header: "Comprou", key: "purchased", width: 10 },
    { header: "Valor total pago", key: "totalPaid", width: 16 },
    { header: "Etapa do funil", key: "stage", width: 20 },
    { header: "Criado em", key: "createdAt", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const contact of contacts) {
    const totalPaid = contact.deals.reduce(
      (sum, deal) => sum + deal.payments.reduce((s, p) => s + p.value, 0),
      0,
    );
    const names = contact.tags.map((t) => t.tag.name);
    sheet.addRow({
      name: contact.name ?? "",
      phoneNumber: `+${contact.phoneNumber}`,
      month: names.filter(isMonthYearTagName).join(", "),
      objective: names.filter(isObjectiveTagName).join(", "),
      origin: names.filter(isOriginTagName).join(", "),
      tags: names.filter((n) => !isMonthYearTagName(n) && !isObjectiveTagName(n) && !isOriginTagName(n)).join(", "),
      purchased: totalPaid > 0 ? "Sim" : "Não",
      totalPaid,
      stage: contact.deals[0]?.stage.name ?? "",
      createdAt: contact.createdAt.toLocaleString("pt-BR"),
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="contatos.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}
