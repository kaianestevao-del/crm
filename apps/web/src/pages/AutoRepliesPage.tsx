import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface AutoTagRule {
  id: string;
  keywords: string[];
  isActive: boolean;
  order: number;
  tags: Tag[];
}

export function AutoRepliesPage() {
  const [autoTaggingEnabled, setAutoTaggingEnabled] = useState(false);
  const [rules, setRules] = useState<AutoTagRule[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const [newKeywords, setNewKeywords] = useState("");
  const [newTagIds, setNewTagIds] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const [orgRes, rulesRes, tagsRes] = await Promise.all([
      api.get("/organizations/me"),
      api.get("/auto-tag-rules"),
      api.get("/tags"),
    ]);
    setAutoTaggingEnabled(orgRes.data.autoTaggingEnabled);
    setRules(rulesRes.data);
    setAllTags(tagsRes.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleToggleEnabled() {
    const next = !autoTaggingEnabled;
    setAutoTaggingEnabled(next);
    await api.patch("/organizations/me", { autoTaggingEnabled: next });
  }

  function toggleNewTag(tagId: string) {
    setNewTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    const res = await api.post("/tags", { name: newTagName.trim() });
    setAllTags((prev) => [...prev, res.data]);
    setNewTagIds((prev) => new Set(prev).add(res.data.id));
    setNewTagName("");
  }

  async function handleCreateRule(e: FormEvent) {
    e.preventDefault();
    const keywords = newKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywords.length === 0 || newTagIds.size === 0) return;
    setCreating(true);
    try {
      await api.post("/auto-tag-rules", { keywords, tagIds: Array.from(newTagIds) });
      setNewKeywords("");
      setNewTagIds(new Set());
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleRuleActive(rule: AutoTagRule) {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)));
    await api.patch(`/auto-tag-rules/${rule.id}`, { isActive: !rule.isActive });
  }

  async function handleDeleteRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    await api.delete(`/auto-tag-rules/${id}`);
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Autoatendimento</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Quando uma mensagem recebida contiver uma palavra-chave cadastrada, o contato é automaticamente marcado com as
        Abas escolhidas — por exemplo, para identificar de onde veio o lead (Instagram, Stories, tráfego pago) e em
        que mês chegou. Nada é enviado ao contato.
      </p>

      <div className="mb-6 flex max-w-2xl items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium">Ativar autoatendimento</p>
          <p className="text-xs text-gray-500">Liga ou desliga todas as regras de palavra-chave abaixo, de uma vez.</p>
        </div>
        <button
          onClick={handleToggleEnabled}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${autoTaggingEnabled ? "bg-brand-dark" : "bg-gray-300"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              autoTaggingEnabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="max-w-2xl rounded-lg border border-gray-200 bg-white p-4">
        <p className="mb-1 text-sm font-medium">Regras por palavra-chave</p>
        <p className="mb-3 text-xs text-gray-500">
          Quando a mensagem recebida contiver alguma das palavras-chave, as Abas escolhidas são vinculadas ao contato
          automaticamente. A primeira regra ativa que combinar é usada.
        </p>

        <div className="mb-4 space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex flex-wrap gap-1">
                {rule.keywords.map((k) => (
                  <span key={k} className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                    {k}
                  </span>
                ))}
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                <span>→ marca com:</span>
                {rule.tags.map((tag) => (
                  <span key={tag.id} className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
                    {tag.name}
                  </span>
                ))}
              </div>
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

        <form onSubmit={handleCreateRule} className="space-y-3 border-t border-gray-100 pt-3">
          <input
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
            placeholder="Palavras-chave, separadas por vírgula (ex: instagram, bio, link da bio)"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />

          <div>
            <p className="mb-1 text-xs font-medium text-gray-600">Marcar contato com a(s) Aba(s):</p>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleNewTag(tag.id)}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    newTagIds.has(tag.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {tag.name}
                </button>
              ))}
              {allTags.length === 0 && <p className="text-xs text-gray-400">Nenhuma aba cadastrada ainda.</p>}
            </div>
            <div className="mt-2 flex gap-1">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Criar nova aba (ex: Origem - Instagram - Set/26)"
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCreateTag}
                className="rounded-md bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
              >
                + Criar aba
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={creating || !newKeywords.trim() || newTagIds.size === 0}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            + Nova regra
          </button>
        </form>
      </div>
    </div>
  );
}
