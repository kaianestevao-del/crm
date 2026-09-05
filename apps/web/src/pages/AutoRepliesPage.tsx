import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface AutoTagRule {
  id: string;
  name: string;
  keywords: string[];
  isActive: boolean;
  order: number;
  tags: Tag[];
}

export function AutoRepliesPage() {
  const [autoTaggingEnabled, setAutoTaggingEnabled] = useState(false);
  const [rules, setRules] = useState<AutoTagRule[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
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

  function resetForm() {
    setNewName("");
    setNewKeywords("");
    setNewTagIds(new Set());
    setShowForm(false);
  }

  async function handleCreateRule(e: FormEvent) {
    e.preventDefault();
    const keywords = newKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (!newName.trim() || keywords.length === 0 || newTagIds.size === 0) return;
    setCreating(true);
    try {
      await api.post("/auto-tag-rules", { name: newName.trim(), keywords, tagIds: Array.from(newTagIds) });
      resetForm();
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
        Cada autoatendimento tem um nome, um acionamento (palavras-chave) e uma ação: marcar o contato com uma ou mais
        Abas. Por exemplo, um autoatendimento "Social Seller" acionado pelas palavras do link da bio, marcando o
        contato com a origem e o mês em que chegou. Nada é enviado ao contato.
      </p>

      <div className="mb-6 flex max-w-2xl items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium">Ativar autoatendimento</p>
          <p className="text-xs text-gray-500">Liga ou desliga todos os autoatendimentos abaixo, de uma vez.</p>
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

      <div className="max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">Autoatendimentos cadastrados</p>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            + Novo autoatendimento
          </button>
        </div>

        <div className="mb-4 space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{rule.name}</p>
                <button onClick={() => handleToggleRuleActive(rule)} className={`text-xs ${rule.isActive ? "text-brand-dark" : "text-gray-400"}`}>
                  {rule.isActive ? "✅ Ativo" : "⏸️ Pausado"}
                </button>
              </div>
              <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
                <span className="text-gray-500">Acionamento:</span>
                {rule.keywords.map((k) => (
                  <span key={k} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                    {k}
                  </span>
                ))}
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
                <span className="text-gray-500">Ação — marcar com:</span>
                {rule.tags.map((tag) => (
                  <span key={tag.id} className="rounded-full bg-brand/10 px-2 py-0.5 text-brand-dark">
                    {tag.name}
                  </span>
                ))}
              </div>
              <button onClick={() => handleDeleteRule(rule.id)} className="text-xs text-red-600 hover:underline">
                Excluir autoatendimento
              </button>
            </div>
          ))}
          {rules.length === 0 && !showForm && (
            <p className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
              Nenhum autoatendimento cadastrado ainda.
            </p>
          )}
        </div>

        {showForm && (
          <form onSubmit={handleCreateRule} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nome do autoatendimento</label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Social Seller"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Acionamento — palavras-chave (separadas por vírgula)</label>
              <input
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                placeholder="Ex: instagram, bio, link da bio"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-gray-600">Ação — marcar contato com a(s) Aba(s):</p>
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

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={resetForm} className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating || !newName.trim() || !newKeywords.trim() || newTagIds.size === 0}
                className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Salvar autoatendimento
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
