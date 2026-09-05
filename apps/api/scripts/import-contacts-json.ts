/**
 * Bulk-imports contacts from a JSON file into an existing organization.
 * Expected format: an array of { "phone": "5511999999999", "name": "Fulano" }.
 * Existing contacts are matched by phone number; only fills in the name if
 * the existing contact doesn't already have one (never overwrites a name).
 *
 * Usage:
 *   pnpm --filter @crm/api exec tsx scripts/import-contacts-json.ts <contacts.json> <organization-name>
 */
import fs from "fs";
import { getPrismaClient } from "@crm/db";

const prisma = getPrismaClient();

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

async function main() {
  const [, , jsonPath, orgName] = process.argv;
  if (!jsonPath || !orgName) {
    console.error("Uso: tsx scripts/import-contacts-json.ts <contacts.json> <nome-organizacao>");
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({ where: { name: orgName } });
  if (!org) {
    console.error(`Organização "${orgName}" não encontrada.`);
    process.exit(1);
  }

  const entries: { phone: string; name: string | null }[] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  console.log(`Lidos ${entries.length} contatos do arquivo. Importando para "${orgName}"...`);

  let created = 0;
  let nameFilled = 0;
  let untouched = 0;

  for (const entry of entries) {
    const phone = normalizePhone(entry.phone);
    if (phone.length < 8) continue;
    const waJid = `${phone}@s.whatsapp.net`;

    const existing = await prisma.contact.findUnique({
      where: { organizationId_waJid: { organizationId: org.id, waJid } },
    });

    if (!existing) {
      await prisma.contact.create({ data: { organizationId: org.id, waJid, phoneNumber: phone, name: entry.name } });
      created++;
    } else if (!existing.name && entry.name) {
      await prisma.contact.update({ where: { id: existing.id }, data: { name: entry.name } });
      nameFilled++;
    } else {
      untouched++;
    }
  }

  console.log(`\n✅ Concluído. Novos contatos: ${created} | Nomes preenchidos em contatos já existentes: ${nameFilled} | Já estavam completos: ${untouched}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
