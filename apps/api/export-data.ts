import fs from "fs";
import path from "path";
import { getPrismaClient } from "@crm/db";

// Parent-before-child order so a later import can insert in this exact sequence without
// hitting foreign-key violations.
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
  const prisma = getPrismaClient();
  const outDir = path.join(__dirname, "..", "..", "backups");
  fs.mkdirSync(outDir, { recursive: true });

  const dump: Record<string, unknown[]> = {};
  for (const model of MODELS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (prisma as any)[model].findMany();
    dump[model] = rows;
    console.log(`${model}: ${rows.length} rows`);
  }

  const outFile = path.join(outDir, `dump-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(dump, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
  console.log("Saved to", outFile);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
