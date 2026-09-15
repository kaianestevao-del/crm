import { useState } from "react";

export interface PreviewStep {
  type: "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT";
  content: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
}

const TYPE_ICON: Record<PreviewStep["type"], string> = {
  TEXT: "💬",
  IMAGE: "🖼️",
  AUDIO: "🎤",
  DOCUMENT: "📄",
};

// Full-size review of every part a quick reply will send, in order, with the tags already
// filled in for this contact — each part stays editable right up until "Enviar" is pressed.
export function QuickReplyPreviewModal({
  title,
  steps,
  sending,
  onSend,
  onCancel,
}: {
  title: string;
  steps: PreviewStep[];
  sending: boolean;
  onSend: (editedSteps: PreviewStep[]) => void;
  onCancel: () => void;
}) {
  const [edited, setEdited] = useState(steps);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">👁️ {title}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <p className="text-xs text-gray-500">
            Essa resposta rápida envia {steps.length} mensagem{steps.length > 1 ? "ns" : ""} em sequência. Revise ou edite
            antes de enviar.
          </p>
          {edited.map((step, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3">
              <p className="mb-1.5 text-xs font-medium text-gray-500">
                {TYPE_ICON[step.type]} Mensagem {i + 1} de {edited.length}
              </p>
              {step.type === "TEXT" ? (
                <textarea
                  value={step.content ?? ""}
                  onChange={(e) =>
                    setEdited((prev) => prev.map((s, idx) => (idx === i ? { ...s, content: e.target.value } : s)))
                  }
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              ) : (
                <div className="space-y-1.5">
                  <p className="truncate text-sm text-gray-700">📎 {step.mediaName ?? "arquivo anexado"}</p>
                  <textarea
                    value={step.content ?? ""}
                    onChange={(e) =>
                      setEdited((prev) => prev.map((s, idx) => (idx === i ? { ...s, content: e.target.value } : s)))
                    }
                    placeholder="Legenda (opcional)"
                    rows={2}
                    className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button onClick={onCancel} className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={() => onSend(edited)}
            disabled={sending}
            className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
