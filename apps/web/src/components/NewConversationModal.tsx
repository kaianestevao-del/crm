import { FormEvent, useState } from "react";
import { api } from "../lib/api";

export function NewConversationModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!phoneNumber.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post("/conversations/start", {
        phoneNumber: phoneNumber.trim(),
        name: name.trim() || undefined,
      });
      onCreated(res.data.id);
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === "no_connected_whatsapp_session") {
        setError("Nenhum número de WhatsApp conectado. Conecte um número em \"Conexão WhatsApp\" antes de iniciar uma conversa.");
      } else if (code === "invalid_phone_number") {
        setError("Número de telefone inválido.");
      } else {
        setError("Não foi possível iniciar a conversa.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-96 rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-sm font-semibold">Nova conversa</h2>
        <p className="mb-4 text-xs text-gray-500">
          Inicie uma conversa com um número que ainda não está na sua lista de contatos.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Número de WhatsApp (com DDD)</label>
            <input
              autoFocus
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Ex: 5511999998888"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Nome (opcional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do contato"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !phoneNumber.trim()}
              className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Iniciando..." : "Iniciar conversa"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
