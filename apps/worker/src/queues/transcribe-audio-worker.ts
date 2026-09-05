import { Queue, Worker } from "bullmq";
import { QUEUE_TRANSCRIBE_AUDIO, TranscribeAudioJob } from "@crm/shared";
import { getPrismaClient } from "@crm/db";
import { createRedisClient } from "../redis";
import { publishRealtimeEvent } from "../pubsub";

const prisma = getPrismaClient();

// Enqueued from session-manager.ts (both for inbound/historical audio it just downloaded,
// and for outbound audio the API already sent) — consumed by the worker created below.
export const transcribeAudioQueue = new Queue<TranscribeAudioJob>(QUEUE_TRANSCRIBE_AUDIO, {
  connection: createRedisClient(),
});

async function transcribeWithGroq(apiKey: string, audioUrl: string): Promise<string> {
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`failed_to_fetch_audio:${audioRes.status}`);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), "audio.ogg");
  form.append("model", "whisper-large-v3");
  form.append("response_format", "text");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`groq_transcription_failed:${res.status}:${errText}`);
  }
  return (await res.text()).trim();
}

export function createTranscribeAudioWorker() {
  return new Worker<TranscribeAudioJob>(
    QUEUE_TRANSCRIBE_AUDIO,
    async (job) => {
      const { organizationId, messageId, mediaUrl } = job.data;
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      // No key configured for this org — transcription is simply off, not an error.
      if (!org?.groqApiKey) return;

      const transcript = await transcribeWithGroq(org.groqApiKey, mediaUrl);
      const message = await prisma.message.update({ where: { id: messageId }, data: { transcript } });

      publishRealtimeEvent({
        type: "message.updated",
        organizationId,
        conversationId: message.conversationId,
        message,
      });
    },
    { connection: createRedisClient(), concurrency: 2 },
  );
}
