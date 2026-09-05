import { useAudioRecorder } from "../hooks/useAudioRecorder";

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioRecorderBar({
  recorder,
  onSend,
}: {
  recorder: ReturnType<typeof useAudioRecorder>;
  onSend: (file: File) => Promise<void> | void;
}) {
  if (recorder.state === "idle") return null;

  if (recorder.state === "recording" || recorder.state === "paused") {
    return (
      <div className="mb-2 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full bg-red-500 ${recorder.state === "recording" ? "animate-pulse" : ""}`} />
          {recorder.state === "recording" ? "Gravando" : "Pausado"} · {formatTime(recorder.seconds)}
        </span>
        <span className="flex gap-3">
          {recorder.state === "recording" ? (
            <button type="button" onClick={recorder.pause} className="font-medium text-gray-700 hover:underline">
              ⏸️ Pausar
            </button>
          ) : (
            <button type="button" onClick={recorder.resume} className="font-medium text-gray-700 hover:underline">
              ▶️ Retomar
            </button>
          )}
          <button type="button" onClick={recorder.finish} className="font-medium text-brand-dark hover:underline">
            ✅ Concluir
          </button>
          <button type="button" onClick={recorder.cancel} className="font-medium text-red-600 hover:underline">
            🗑️ Excluir
          </button>
        </span>
      </div>
    );
  }

  // preview
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-brand bg-brand/5 px-3 py-2 text-xs">
      <audio src={recorder.previewUrl ?? undefined} controls className="h-8 flex-1" />
      <span className="flex flex-shrink-0 gap-3">
        <button
          type="button"
          onClick={() => {
            const file = recorder.getFile();
            if (file) onSend(file);
            recorder.discard();
          }}
          className="font-medium text-brand-dark hover:underline"
        >
          Enviar
        </button>
        <button type="button" onClick={recorder.discard} className="font-medium text-red-600 hover:underline">
          Excluir
        </button>
      </span>
    </div>
  );
}
