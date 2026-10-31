import { Request, Response } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";
import { OBJECTIVE_TAGS_PT, ORIGIN_TAGS_PT, canonicalObjectiveTag, isMonthYearTagName, isObjectiveTagName } from "@crm/shared";

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

// ---------------------------------------------------------------------------------------------
// "Vincular objetivo por planilha": a spreadsheet (e.g. a WaSpeed export) with a WhatsApp/phone
// column, plus one of the six objectives. Every contact whose number is in it gets that
// objective's tag. Nothing is ever duplicated: numbers are matched on DDD + last 8 digits (so
// 55 75 9948-1471 and 55 75 9 9948-1471 are the same person), and a number not in the CRM is
// only saved as a new contact when asked to (createMissing), via the same waJid upsert as the
// rest of the CRM. dryRun only counts, without changing anything.

const SHEET_PHONE_HEADERS = ["telefone", "whatsapp", "numero", "número", "phone", "celular"];
const SHEET_NAME_HEADERS = ["nome", "name"];

// Brazilian numbers compare without the country code and the optional 9th digit.
function phoneKey(digits: string) {
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits.slice(2, 4) + digits.slice(-8);
  return digits;
}

function cellText(value: unknown): string {
  if (value && typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "");
  if (value && typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "");
  return String(value ?? "");
}

const importObjectiveSchema = z.object({
  objective: z.enum(OBJECTIVE_TAGS_PT),
  dryRun: z.enum(["true", "false"]).default("true"),
  createMissing: z.enum(["true", "false"]).default("false"),
});

export async function importObjectiveSpreadsheet(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) throw new HttpError(400, "file_required");
  const input = importObjectiveSchema.parse(req.body);
  const dryRun = input.dryRun === "true";
  const createMissing = input.createMissing === "true";

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, "empty_spreadsheet");

  let phoneCol = -1;
  let nameCol = -1;
  sheet.getRow(1).eachCell((cell, col) => {
    const header = cellText(cell.value).trim().toLowerCase();
    if (SHEET_PHONE_HEADERS.includes(header)) phoneCol = col;
    if (SHEET_NAME_HEADERS.includes(header)) nameCol = col;
  });
  if (phoneCol === -1) throw new HttpError(400, "phone_column_not_found");

  // One entry per person in the sheet, even if a number is repeated.
  const rows = new Map<string, { digits: string; name: string | null }>();
  let invalidRows = 0;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    let digits = cellText(row.getCell(phoneCol).value).replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) continue;
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (digits.length < 10) {
      invalidRows++;
      continue;
    }
    const name = nameCol !== -1 ? cellText(row.getCell(nameCol).value).trim() || null : null;
    const key = phoneKey(digits);
    if (!rows.has(key)) rows.set(key, { digits, name });
  }

  const contacts = await prisma.contact.findMany({ where: { organizationId }, select: { id: true, phoneNumber: true } });
  const byKey = new Map<string, string[]>();
  for (const c of contacts) {
    const key = phoneKey(c.phoneNumber.replace(/\D/g, ""));
    byKey.set(key, [...(byKey.get(key) ?? []), c.id]);
  }

  const tags = await prisma.tag.findMany({ where: { organizationId } });
  const existingTag = tags.find((t) => canonicalObjectiveTag(t.name) === input.objective);
  const alreadyTagged = new Set(
    existingTag ? (await prisma.contactTag.findMany({ where: { tagId: existingTag.id }, select: { contactId: true } })).map((c) => c.contactId) : [],
  );

  const matchedIds = new Set<string>();
  const missing: { digits: string; name: string | null }[] = [];
  for (const [key, row] of rows) {
    const ids = byKey.get(key);
    if (ids) ids.forEach((id) => matchedIds.add(id));
    else missing.push(row);
  }
  const toTag = [...matchedIds].filter((id) => !alreadyTagged.has(id));

  const summary = {
    objective: input.objective,
    numbersInSheet: rows.size,
    invalidRows,
    foundInCrm: rows.size - missing.length,
    alreadyHadObjective: matchedIds.size - toTag.length,
    willLink: toTag.length,
    notInCrm: missing.length,
    notInCrmSample: missing.slice(0, 20).map((m) => ({ phoneNumber: m.digits, name: m.name })),
  };
  if (dryRun) {
    res.json({ ...summary, dryRun: true });
    return;
  }

  const tag =
    existingTag ??
    (await prisma.tag.upsert({
      where: { organizationId_name: { organizationId, name: input.objective } },
      update: {},
      create: { organizationId, name: input.objective },
    }));

  let created = 0;
  const newIds: string[] = [];
  if (createMissing) {
    for (const m of missing) {
      const waJid = `${m.digits}@s.whatsapp.net`;
      const contact = await prisma.contact.upsert({
        where: { organizationId_waJid: { organizationId, waJid } },
        update: {},
        create: { organizationId, waJid, phoneNumber: m.digits, name: m.name },
      });
      if (!matchedIds.has(contact.id)) {
        newIds.push(contact.id);
        created++;
      }
    }
  }

  const linked = await prisma.contactTag.createMany({
    data: [...toTag, ...newIds].map((contactId) => ({ contactId, tagId: tag.id })),
    skipDuplicates: true,
  });

  res.json({ ...summary, dryRun: false, linked: linked.count, created });
}
