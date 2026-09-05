import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

interface ScheduledMessage {
  id: string;
  content: string;
  scheduledFor: string;
  status: string;
}

function toDatetimeLocalMin() {
  const d = new Date(Date.now() + 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ScheduledMessages({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [content, setContent] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await api.get(`/conversations/${conversationId}/scheduled-messages`);
    setItems(res.data);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() || !scheduledFor) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/conversations/${conversationId}/scheduled-messages`, {
        content: content.trim(),
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      setContent("");
      setScheduledFor("");
      await refresh();
    } catch (err: any) {
      setError(
        err?.response?.data?.error === "scheduled_for_must_be_in_the_future"
          ? "Escolha um horário pelo menos 1 minuto no futuro."
          : "Não foi possível agendar a mensagem.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    await api.delete(`/scheduled-messages/${id}`);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="absolute right-0 top-full z-10 mt-1 w-96 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">Mensagens agendadas</p>
        <button onClick={onClose} className="text-xs text-gray-500 hover:underline">
          Fechar
        </button>
      </div>

      <div className="mb-3 max-h-48 space-y-2 overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-gray-400">Nenhuma mensagem agendada para esta conversa.</p>}
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
            <p className="mb-1 whitespace-pre-wrap">{item.content}</p>
            <div className="flex items-center justify-between text-gray-500">
              <span>📅 {new Date(item.scheduledFor).toLocaleString("pt-BR")}</span>
              <button onClick={() => handleCancel(item.id)} className="text-red-600 hover:underline">
                Cancelar
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-gray-100 pt-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Mensagem a enviar..."
          rows={2}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
        />
        <input
          type="datetime-local"
          value={scheduledFor}
          min={toDatetimeLocalMin()}
          onChange={(e) => setScheduledFor(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !content.trim() || !scheduledFor}
          className="w-full rounded-md bg-brand-dark px-2 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Agendar envio
        </button>
      </form>
    </div>
  );
}
