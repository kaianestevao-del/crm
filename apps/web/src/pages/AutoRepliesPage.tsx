import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

interface AutoReplyRule {
  id: string;
  keywords: string[];
  reply: string;
  isActive: boolean;
  order: number;
}

export function AutoRepliesPage() {
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [greetingMessage, setGreetingMessage] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [newKeywords, setNewKeywords] = useState("");
  const [newReply, setNewReply] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const [orgRes, rulesRes] = await Promise.all([api.get("/organizations/me"), api.get("/auto-reply-rules")]);
    setAutoReplyEnabled(orgRes.data.autoReplyEnabled);
    setGreetingMessage(orgRes.data.greetingMessage ?? "");
    setRules(rulesRes.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleToggleEnabled() {
    const next = !autoReplyEnabled;
    setAutoReplyEnabled(next);
    await api.patch("/organizations/me", { autoReplyEnabled: next });
  }

  async function handleSaveGreeting() {
    setSavingSettings(true);
    try {
      await api.patch("/organizations/me", { greetingMessage: greetingMessage.trim() || null });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleCreateRule(e: FormEvent) {
    e.preventDefault();
    const keywords = newKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywords.length === 0 || !newReply.trim()) return;
    setCreating(true);
    try {
      await api.post("/auto-reply-rules", { keywords, reply: newReply.trim() });
      setNewKeywords("");
      setNewReply("");
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleRuleActive(rule: AutoReplyRule) {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)));
    await api.patch(`/auto-reply-rules/${rule.id}`, { isActive: !rule.isActive });
  }

  async function handleDeleteRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    await api.delete(`/auto-reply-rules/${id}`);
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Autoatendimento</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Respostas automáticas enviadas para o próprio contato que escreveu — nunca um disparo em massa. Sai de cena assim
        que a conversa é atribuída a um atendente.
      </p>

      <div className="mb-6 flex max-w-2xl items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium">Ativar autoatendimento</p>
          <p className="text-xs text-gray-500">Liga ou desliga a saudação e as regras de palavra-chave abaixo, de uma vez.</p>
        </div>
        <button
          onClick={handleToggleEnabled}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${autoReplyEnabled ? "bg-brand-dark" : "bg-gray-300"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              autoReplyEnabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="mb-6 max-w-2xl rounded-lg border border-gray-200 bg-white p-4">
        <p className="mb-1 text-sm font-medium">Mensagem de saudação</p>
        <p className="mb-3 text-xs text-gray-500">Enviada automaticamente na primeira mensagem que um novo contato manda.</p>
        <textarea
          value={greetingMessage}
          onChange={(e) => setGreetingMessage(e.target.value)}
          rows={3}
          placeholder="Ex: Olá! Obrigado por entrar em contato, já já um atendente responde 😊"
          className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <button
          onClick={handleSaveGreeting}
          disabled={savingSettings}
          className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Salvar saudação
        </button>
      </div>

      <div className="max-w-2xl rounded-lg border border-gray-200 bg-white p-4">
        <p className="mb-1 text-sm font-medium">Regras por palavra-chave</p>
        <p className="mb-3 text-xs text-gray-500">
          Quando a mensagem recebida contiver alguma das palavras-chave, a resposta é enviada automaticamente. A primeira
          regra ativa que combinar é usada.
        </p>

        <div className="mb-4 space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="mb-1 flex flex-wrap gap-1">
                {rule.keywords.map((k) => (
                  <span key={k} className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
                    {k}
                  </span>
                ))}
              </div>
              <p className="mb-2 whitespace-pre-wrap text-sm">{rule.reply}</p>
              <div className="flex items-center justify-between text-xs">
                <button onClick={() => handleToggleRuleActive(rule)} className={rule.isActive ? "text-brand-dark" : "text-gray-400"}>
                  {rule.isActive ? "✅ Ativa" : "⏸️ Pausada"}
                </button>
                <button onClick={() => handleDeleteRule(rule.id)} className="text-red-600 hover:underline">
                  Excluir
                </button>
              </div>
            </div>
          ))}
          {rules.length === 0 && <p className="text-xs text-gray-400">Nenhuma regra cadastrada ainda.</p>}
        </div>

        <form onSubmit={handleCreateRule} className="space-y-2 border-t border-gray-100 pt-3">
          <input
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
            placeholder="Palavras-chave, separadas por vírgula (ex: preço, valor, quanto custa)"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <textarea
            value={newReply}
            onChange={(e) => setNewReply(e.target.value)}
            rows={2}
            placeholder="Resposta automática..."
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <button
            type="submit"
            disabled={creating || !newKeywords.trim() || !newReply.trim()}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            + Nova regra
          </button>
        </form>
      </div>
    </div>
  );
}
