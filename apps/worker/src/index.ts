import "./env";
import { startAllPersistedSessions } from "./baileys/session-manager";
import { createSessionCommandsWorker } from "./queues/session-commands-worker";
import { createOutboundMessagesWorker } from "./queues/outbound-messages-worker";
import { createTranscribeAudioWorker } from "./queues/transcribe-audio-worker";
import { createLabelCommandsWorker } from "./queues/label-commands-worker";
import { createScheduledMessagesWorker } from "./queues/scheduled-messages-worker";

async function main() {
  createSessionCommandsWorker();
  createOutboundMessagesWorker();
  createTranscribeAudioWorker();
  createLabelCommandsWorker();
  createScheduledMessagesWorker();

  await startAllPersistedSessions();

  console.log("Worker started: session commands, outbound messages, transcription, labels and scheduled messages are being processed.");
}

main().catch((err) => {
  console.error("worker_fatal_error", err);
  process.exit(1);
});
