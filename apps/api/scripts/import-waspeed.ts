/**
 * One-off importer for WaSpeed (Chrome extension WhatsApp CRM) backup files.
 *
 * WaSpeed encrypts most of its backup fields with AES using a passphrase that is
 * hardcoded in its own bundled extension code (the same for every install, not a
 * user-chosen secret) — found at:
 *   .../Extensions/balkfdkhbcjjmhndnblgmlmcabnapogp/<version>/background.js
 * as `cript_key: "ffce211a-7b07-4d91-ba5d-c40bb4034a83"`.
 *
 * Usage:
 *   pnpm --filter @crm/api exec tsx scripts/import-waspeed.ts <path-to-backup.json> <organization-name> <owner-email> <owner-password>
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getPrismaClient, Role, MessageDirection, CampaignStatus, CampaignRecipientStatus, QuickReplyType, SessionStatus } from "@crm/db";

const WASPEED_KEY = "ffce211a-7b07-4d91-ba5d-c40bb4034a83";
const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "quick-replies");

const prisma = getPrismaClient();

function evpBytesToKey(password: Buffer, salt: Buffer, keyLen: number, ivLen: number) {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLen + ivLen) {
    block = crypto.createHash("md5").update(Buffer.concat([block, password, salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  return { key: derived.subarray(0, keyLen), iv: derived.subarray(keyLen, keyLen + ivLen) };
}

function decryptCryptoJS(ciphertextB64: string, passphrase: string): string {
  const raw = Buffer.from(ciphertextB64, "base64");
  const salt = raw.subarray(8, 16); // bytes 0-7 are the literal "Salted__" marker
  const ciphertext = raw.subarray(16);
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), salt, 32, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function decryptField<T>(raw: unknown): T {
  if (typeof raw === "string" && raw.startsWith("U2FsdGVk")) {
    return JSON.parse(decryptCryptoJS(raw, WASPEED_KEY));
  }
  return raw as T;
}

function normalizePhone(waJidOrPhone: string) {
  return waJidOrPhone.replace(/@.*/, "").replace(/\D/g, "");
}

function parseBrDate(d: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d ?? "");
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
}

function extensionForMime(mime: string) {
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
  };
  return map[mime.split(";")[0]] ?? "bin";
}

async function main() {
  const [, , backupPathArg, orgName, ownerEmail, ownerPassword] = process.argv;
  if (!backupPathArg || !orgName || !ownerEmail || !ownerPassword) {
    console.error("Uso: tsx scripts/import-waspeed.ts <backup.json> <nome-organizacao> <email-dono> <senha-dono>");
    process.exit(1);
  }

  const existing = await prisma.organization.findFirst({ where: { name: orgName } });
  if (existing) {
    console.error(`Já existe uma organização chamada "${orgName}". Apague-a ou escolha outro nome antes de importar de novo.`);
    process.exit(1);
  }

  console.log("Lendo backup...");
  const raw = JSON.parse(fs.readFileSync(backupPathArg, "utf8"));

  const contatos = decryptField<{ id: string; name: string }[]>(raw.contatos);
  const perfis = decryptField<any[]>(raw.perfil);
  const notesRaw = decryptField<{ id: number; userID: string; text: string; base64: string }[]>(raw.notes);
  const categorias = decryptField<{ id: string; name: string; hexColor?: string }[]>(raw.categoria);
  const respostasRapidas = decryptField<{ id: string; titulo: string; categoria: string; type: string }[]>(raw.respostasRapidas);
  const respostasRapidasAcao: { id: string; acao: { type: string; propriedades: Record<string, any> }[] }[] = raw.respostasRapidasAcao;
  const relatorio = decryptField<{ id: string; send: { hora: number; nome: string; phone: string; status: string }[] }[]>(raw.relatorio);

  console.log(
    `Encontrados: ${contatos.length} contatos, ${perfis.length} perfis, ${notesRaw.length} notas, ${categorias.length} categorias, ${respostasRapidas.length} respostas rápidas, ${relatorio.length} campanhas históricas.`,
  );

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  console.log("Criando organização, dono e funil padrão...");
  const passwordHash = await bcrypt.hash(ownerPassword, 10);
  const owner = await prisma.user.create({ data: { name: "Kaian Estevão", email: ownerEmail, passwordHash } });
  const org = await prisma.organization.create({ data: { name: orgName } });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });

  const pipeline = await prisma.pipeline.create({
    data: {
      organizationId: org.id,
      name: "Funil Padrão",
      isDefault: true,
      stages: {
        create: [
          { name: "Novo Lead", order: 0 },
          { name: "Em Contato", order: 1 },
          { name: "Negociação", order: 2 },
          { name: "Fechado", order: 3 },
        ],
      },
    },
    include: { stages: true },
  });
  const fechado = pipeline.stages.find((s) => s.name === "Fechado")!;

  const session = await prisma.whatsappSession.create({
    data: { organizationId: org.id, name: "Importado do WaSpeed (reconecte via QR)", status: SessionStatus.LOGGED_OUT },
  });

  console.log("Importando contatos...");
  const contactByPhone = new Map<string, string>(); // phone -> contact id
  for (const c of contatos) {
    const phone = normalizePhone(c.id);
    if (!phone) continue;
    const contact = await prisma.contact.upsert({
      where: { organizationId_waJid: { organizationId: org.id, waJid: `${phone}@s.whatsapp.net` } },
      update: { name: c.name },
      create: { organizationId: org.id, waJid: `${phone}@s.whatsapp.net`, phoneNumber: phone, name: c.name },
    });
    contactByPhone.set(phone, contact.id);
  }

  async function getOrCreateContact(phoneRaw: string, fallbackName?: string) {
    const phone = normalizePhone(phoneRaw);
    if (!phone) return null;
    let id = contactByPhone.get(phone);
    if (id) return id;
    const contact = await prisma.contact.upsert({
      where: { organizationId_waJid: { organizationId: org.id, waJid: `${phone}@s.whatsapp.net` } },
      update: {},
      create: { organizationId: org.id, waJid: `${phone}@s.whatsapp.net`, phoneNumber: phone, name: fallbackName },
    });
    contactByPhone.set(phone, contact.id);
    return contact.id;
  }

  console.log("Importando negócios fechados e dados de perfil (como notas)...");
  let dealsCreated = 0;
  for (const p of perfis) {
    const contactId = await getOrCreateContact(p.userID);
    if (!contactId) continue;

    const profileBits = [
      p.origemLead && `Origem do lead: ${p.origemLead}`,
      p.cidade && `Cidade: ${p.cidade}`,
      p.estado && `Estado: ${p.estado}`,
      p.dataNascimento && `Data de nascimento: ${p.dataNascimento}`,
      p.sexo && `Sexo: ${p.sexo}`,
      p.observacoes && `Observações: ${p.observacoes}`,
    ].filter(Boolean);
    if (profileBits.length) {
      await prisma.note.create({
        data: { organizationId: org.id, contactId, content: `[Importado do WaSpeed]\n${profileBits.join("\n")}` },
      });
    }

    for (const deal of p.valNegocio ?? []) {
      await prisma.deal.create({
        data: {
          organizationId: org.id,
          pipelineId: pipeline.id,
          stageId: fechado.id,
          contactId,
          title: deal.descricao,
          value: Number(deal.valor) || undefined,
          createdAt: parseBrDate(deal.data) ?? undefined,
        },
      });
      dealsCreated++;
    }
  }

  console.log("Importando notas de atendimento...");
  let notesCreated = 0;
  for (const n of notesRaw) {
    if (!n.text) continue;
    const contactId = await getOrCreateContact(n.userID);
    if (!contactId) continue;
    await prisma.note.create({ data: { organizationId: org.id, contactId, content: n.text } });
    notesCreated++;
  }

  console.log("Importando categorias e respostas rápidas (isso inclui salvar mídias em disco)...");
  const categoryIdMap = new Map<string, string>();
  for (const cat of categorias) {
    const created = await prisma.quickReplyCategory.create({
      data: { organizationId: org.id, name: cat.name, hexColor: cat.hexColor },
    });
    categoryIdMap.set(cat.id, created.id);
  }

  const actionById = new Map(respostasRapidasAcao.map((a) => [a.id, a]));
  let quickRepliesCreated = 0;
  let mediaFilesSaved = 0;
  for (const qr of respostasRapidas) {
    const action = actionById.get(qr.id)?.acao?.[0];
    if (!action) continue;

    const props = action.propriedades ?? {};
    const categoryId = qr.categoria ? categoryIdMap.get(qr.categoria) : undefined;

    let type: QuickReplyType = QuickReplyType.TEXT;
    let content: string | undefined = props.mensagem;
    let mediaUrl: string | undefined;
    let mediaName: string | undefined = props.base64Name;

    if (action.type === "audio" || action.type === "image" || action.type === "doc") {
      type = action.type === "audio" ? QuickReplyType.AUDIO : action.type === "image" ? QuickReplyType.IMAGE : QuickReplyType.DOCUMENT;
      const dataUri: string | undefined = props.base64;
      if (dataUri?.startsWith("data:")) {
        const [, mime, b64] = /^data:([^;]+);(?:codecs=[^;]+;)?base64,(.*)$/s.exec(dataUri) ?? [];
        if (b64) {
          const fileId = crypto.randomUUID();
          const ext = extensionForMime(mime ?? "");
          const fileName = `${fileId}.${ext}`;
          fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(b64, "base64"));
          mediaUrl = `/uploads/quick-replies/${fileName}`;
          mediaFilesSaved++;
        }
      }
    }

    await prisma.quickReply.create({
      data: { organizationId: org.id, categoryId, title: qr.titulo, type, content, mediaUrl, mediaName },
    });
    quickRepliesCreated++;
  }

  console.log("Importando histórico de campanhas de envio em massa...");
  let campaignsCreated = 0;
  for (const batch of relatorio) {
    const recipients = [];
    for (const send of batch.send ?? []) {
      const contactId = await getOrCreateContact(send.phone, send.nome);
      if (!contactId) continue;
      recipients.push({
        contactId,
        status: send.status === "Enviado" ? CampaignRecipientStatus.SENT : CampaignRecipientStatus.FAILED,
        sentAt: send.hora ? new Date(send.hora) : undefined,
      });
    }
    if (recipients.length === 0) continue;
    await prisma.campaign.create({
      data: {
        organizationId: org.id,
        whatsappSessionId: session.id,
        name: `Campanha importada (${new Date(Number(batch.id)).toLocaleDateString("pt-BR")})`,
        messageTemplate: "(mensagem original não preservada no relatório do WaSpeed)",
        status: CampaignStatus.DONE,
        recipients: { create: recipients },
      },
    });
    campaignsCreated++;
  }

  console.log("\n✅ Importação concluída.");
  console.log(`Organização: ${orgName} (login: ${ownerEmail})`);
  console.log(`Contatos: ${contactByPhone.size}`);
  console.log(`Negócios fechados importados: ${dealsCreated}`);
  console.log(`Notas importadas: ${notesCreated}`);
  console.log(`Categorias de resposta rápida: ${categoryIdMap.size}`);
  console.log(`Respostas rápidas: ${quickRepliesCreated} (${mediaFilesSaved} com mídia salva em apps/api/uploads/quick-replies)`);
  console.log(`Campanhas históricas: ${campaignsCreated}`);
  console.log("\nNão migrado nesta rodada (não têm um lugar correspondente no CRM ainda): agendamentosNaoDisparados, userTabs, fluxo (chatbot).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
