import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function TranscriptionSettings({ onClose }: { onClose: () => void }) {
  const [hasKey, setHasKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/organizations/me").then((res) => setHasKey(res.data.hasGroqApiKey));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await api.patch("/organizations/me", { groqApiKey: apiKey.trim() || null });
      setHasKey(res.data.hasGroqApiKey);
      setApiKey("");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
      <p className="mb-1 text-sm font-medium">Transcrição de áudio (Groq)</p>
      <p className="mb-3 text-xs text-gray-500">
        {hasKey ? "✅ Chave configurada — áudios são transcritos automaticamente." : "Sem chave configurada — áudios não são transcritos."}{" "}
        Crie uma gratuita em{" "}
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-brand-dark underline">
          console.groq.com
        </a>
        .
      </p>
      <input
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={hasKey ? "Insira uma nova chave para substituir" : "gsk_..."}
        className="mb-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
      />
      <div className="flex justify-between">
        {hasKey ? (
          <button
            onClick={() => {
              setApiKey("");
              api.patch("/organizations/me", { groqApiKey: null }).then((res) => setHasKey(res.data.hasGroqApiKey));
            }}
            className="text-xs text-red-600 hover:underline"
          >
            Remover chave
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
