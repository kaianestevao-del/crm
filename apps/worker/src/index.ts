import "./env";
import { startAllPersistedSessions } from "./baileys/session-manager";

// This process holds every organization's live WhatsApp connection at once — a single
// unhandled error anywhere (a stray event handler, a DB hiccup) must never be allowed to crash
// it, since that silently drops every connected number, not just the one that errored. Every
// Baileys event handler is expected to catch its own errors already; this is the last-resort
// backstop for anything that still slips through.
process.on("unhandledRejection", (err) => console.error("worker_unhandled_rejection", err));
process.on("uncaughtException", (err) => console.error("worker_uncaught_exception", err));
import { createSessionCommandsWorker } from "./queues/session-commands-worker";
import { createOutboundMessagesWorker } from "./queues/outbound-messages-worker";
import { createTranscribeAudioWorker } from "./queues/transcribe-audio-worker";
import { createScheduledMessagesWorker } from "./queues/scheduled-messages-worker";
import { createInboundCloudMessagesWorker } from "./queues/inbound-cloud-messages-worker";
import { createCampaignDispatchWorker } from "./queues/campaign-dispatch-worker";
import { createAiReplyWorker } from "./ai/ai-reply-worker";
import { createFlowStepsWorker } from "./flows/flow-runner";
import { createDailyBackupWorker, scheduleDailyBackup } from "./backup/daily-backup-worker";

async function main() {
  createSessionCommandsWorker();
  createOutboundMessagesWorker();
  createTranscribeAudioWorker();
  createScheduledMessagesWorker();
  createInboundCloudMessagesWorker();
  createCampaignDispatchWorker();
  createAiReplyWorker();
  createFlowStepsWorker();
  createDailyBackupWorker();
  await scheduleDailyBackup();

  await startAllPersistedSessions();

  console.log(
    "Worker started: session commands, outbound messages, transcription, scheduled messages and Cloud API webhooks are being processed.",
  );
}

main().catch((err) => {
  console.error("worker_fatal_error", err);
  process.exit(1);
});
