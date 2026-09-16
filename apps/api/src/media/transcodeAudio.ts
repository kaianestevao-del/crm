import crypto from "crypto";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";

// The WhatsApp Cloud API's audio message type rejects webm (what the browser's MediaRecorder
// produces — see apps/web/src/hooks/useAudioRecorder.ts) — it only accepts AAC, AMR, MP3,
// MP4(audio) or OGG/Opus mono. OGG/Opus mono 16kHz is WhatsApp's own native voice-note format
// and is already what the rest of this codebase expects (see MIME_BY_EXTENSION in
// apps/worker/src/baileys/session-manager.ts), so every uploaded audio file is converted to
// that on the way in, once, regardless of how many times it's later sent.
export async function transcodeToOpusOgg(inputPath: string, outputDir: string): Promise<{ path: string; filename: string }> {
  const filename = `${crypto.randomUUID()}.ogg`;
  const outputPath = path.join(outputDir, filename);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec("libopus")
      .audioBitrate("32k")
      .format("ogg")
      .on("error", reject)
      .on("end", () => resolve())
      .save(outputPath);
  });

  fs.unlink(inputPath, () => {});
  return { path: outputPath, filename };
}
