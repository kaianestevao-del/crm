import "./env";
import { startAllPersistedSessions } from "./baileys/session-manager";
import { createSessionCommandsWorker } from "./queues/session-commands-worker";
import { createOutboundMessagesWorker } from "./queues/outbound-messages-worker";
import { createCampaignJobsWorker } from "./queues/campaign-jobs-worker";
import { createTranscribeAudioWorker } from "./queues/transcribe-audio-worker";
import { createLabelCommandsWorker } from "./queues/label-commands-worker";

async function main() {
  createSessionCommandsWorker();
  createOutboundMessagesWorker();
  createCampaignJobsWorker();
  createTranscribeAudioWorker();
  createLabelCommandsWorker();

  await startAllPersistedSessions();

  console.log("Worker started: session commands, outbound messages, campaigns, transcription and labels are being processed.");
}

main().catch((err) => {
  console.error("worker_fatal_error", err);
  process.exit(1);
});
