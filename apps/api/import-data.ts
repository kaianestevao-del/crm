import fs from "fs";
import path from "path";
import { getPrismaClient } from "@crm/db";

const MODELS = [
  "organization",
  "user",
  "membership",
  "whatsappSession",
  "contact",
  "tag",
  "contactTag",
  "whatsappLabel",
  "contactWhatsappLabel",
  "note",
  "quickReplyCategory",
  "quickReply",
  "conversation",
  "scheduledMessage",
  "autoTagRule",
  "autoTagRuleTag",
  "message",
  "pipeline",
  "pipelineStage",
  "deal",
  "dealPayment",
  "dealStageHistory",
  "dealFollowUpContact",
] as const;

async function main() {
  const dumpPath = process.argv[2];
  if (!dumpPath) throw new Error("Usage: tsx import-data.ts <path-to-dump.json>");

  const prisma = getPrismaClient();
  const dump = JSON.parse(fs.readFileSync(path.resolve(dumpPath), "utf-8")) as Record<string, unknown[]>;

  for (const model of MODELS) {
    const rows = dump[model] ?? [];
    if (rows.length === 0) {
      console.log(`${model}: 0 rows, skipping`);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (prisma as any)[model].createMany({ data: rows, skipDuplicates: true });
    console.log(`${model}: inserted ${result.count} / ${rows.length}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
