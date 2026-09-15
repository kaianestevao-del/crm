import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import { Queue, Worker } from "bullmq";
import { getPrismaClient, MessageDirection, MessageStatus, MessageType } from "@crm/db";
import { QUEUE_DAILY_BACKUP, MessageType as SharedMessageType } from "@crm/shared";
import { createRedisClient } from "../redis";
import { env } from "../env";
import { sendOutboundMessage } from "../baileys/session-manager";

const execFileAsync = promisify(execFile);
const prisma = getPrismaClient();

// Dumps the whole Postgres database (every organization, not just one) — this is an
// infra-level backup, not a per-tenant export. Runs as plain SQL (not the custom -Fc format)
// so restoring it back is a plain `psql < file.sql`, no pg_restore needed.
async function dumpDatabase(): Promise<string> {
  const dir = path.join(env.UPLOADS_DIR, "backups");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sqlPath = path.join(dir, `backup-${stamp}.sql`);
  const gzPath = `${sqlPath}.gz`;

  await execFileAsync("pg_dump", [env.DATABASE_URL, "--no-owner", "--no-privileges", "-f", sqlPath]);

  await pipeline(createReadStream(sqlPath), zlib.createGzip(), createWriteStream(gzPath));
  await fs.unlink(sqlPath).catch(() => {});

  return gzPath;
}

// Sent over Resend's HTTPS API rather than raw SMTP — Railway blocks outbound SMTP ports
// (25/465/587) entirely regardless of provider, which is what caused every direct-SMTP attempt
// (Gmail, ports 465 and 587) to hang until ETIMEDOUT. An HTTPS API has no such restriction.
async function sendByEmail(filePath: string) {
  if (!env.RESEND_API_KEY || !env.BACKUP_EMAIL_TO) {
    console.log("daily_backup_email_skipped_not_configured");
    return;
  }
  const fileContent = await fs.readFile(filePath);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: env.BACKUP_EMAIL_TO,
      subject: `Backup diário do CRM WhatsApp — ${new Date().toLocaleDateString("pt-BR")}`,
      text: "Backup automático do banco de dados em anexo.",
      attachments: [{ filename: path.basename(filePath), content: fileContent.toString("base64") }],
    }),
  });
  if (!res.ok) throw new Error(`resend_send_failed:${await res.text()}`);
  console.log("daily_backup_email_sent", { to: env.BACKUP_EMAIL_TO });
}

// Sends the dump as a WhatsApp document to the owner's own number, through whichever
// organization's connected session comes first — this product is effectively single-tenant in
// practice (one clinic per deployment), so there is no per-org backup selection to make here.
async function sendByWhatsapp(filePath: string) {
  if (!env.BACKUP_WHATSAPP_NUMBER) {
    console.log("daily_backup_whatsapp_skipped_not_configured");
    return;
  }
  const session = await prisma.whatsappSession.findFirst({
    where: { status: "CONNECTED", archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!session) {
    console.log("daily_backup_whatsapp_skipped_no_connected_session");
    return;
  }

  const phoneNumber = env.BACKUP_WHATSAPP_NUMBER.replace(/\D/g, "");
  const waJid = `${phoneNumber}@s.whatsapp.net`;

  const contact = await prisma.contact.upsert({
    where: { organizationId_waJid: { organizationId: session.organizationId, waJid } },
    update: {},
    create: { organizationId: session.organizationId, waJid, phoneNumber, name: "Backup automático" },
  });
  const conversation = await prisma.conversation.upsert({
    where: { whatsappSessionId_contactId: { whatsappSessionId: session.id, contactId: contact.id } },
    update: {},
    create: { organizationId: session.organizationId, whatsappSessionId: session.id, contactId: contact.id },
  });

  const fileName = path.basename(filePath);
  const mediaUrl = `/uploads/backups/${fileName}`;
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.DOCUMENT,
      content: null,
      mediaUrl,
      status: MessageStatus.PENDING,
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  await sendOutboundMessage({
    organizationId: session.organizationId,
    sessionId: session.id,
    conversationId: conversation.id,
    messageId: message.id,
    waJid,
    mediaUrl: `${env.PUBLIC_URL}${mediaUrl}`,
    mediaType: SharedMessageType.DOCUMENT,
    mediaName: fileName,
  });
  console.log("daily_backup_whatsapp_sent", { to: phoneNumber });
}

export async function runDailyBackup() {
  console.log("daily_backup_started");
  try {
    const filePath = await dumpDatabase();
    await Promise.all([
      sendByEmail(filePath).catch((err) => console.error("daily_backup_email_failed", err)),
      sendByWhatsapp(filePath).catch((err) => console.error("daily_backup_whatsapp_failed", err)),
    ]);
    console.log("daily_backup_finished", { filePath });
  } catch (err) {
    console.error("daily_backup_failed", err);
  }
}

export function createDailyBackupWorker() {
  return new Worker(QUEUE_DAILY_BACKUP, async () => runDailyBackup(), { connection: createRedisClient(), concurrency: 1 });
}

// Registers the two fixed daily runs (8h and 20h, horário de Brasília) as BullMQ repeatable
// jobs. Fixed jobIds mean calling this again on every worker restart is safe — BullMQ no-ops
// re-adding the same repeatable job instead of creating a duplicate schedule.
export async function scheduleDailyBackup() {
  const queue = new Queue(QUEUE_DAILY_BACKUP, { connection: createRedisClient() });
  await queue.add(
    "daily-backup-morning",
    {},
    { repeat: { pattern: "0 8 * * *", tz: "America/Bahia" }, jobId: "daily-backup-08h" },
  );
  await queue.add(
    "daily-backup-evening",
    {},
    { repeat: { pattern: "0 20 * * *", tz: "America/Bahia" }, jobId: "daily-backup-20h" },
  );
}
