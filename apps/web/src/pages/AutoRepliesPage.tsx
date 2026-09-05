import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
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

function KeywordEditor({ keywords, onChange }: { keywords: string[]; onChange: (keywords: string[]) => void }) {
  const [input, setInput] = useState("");

  function addKeyword() {
    const value = input.trim();
    if (!value || keywords.includes(value)) return;
    onChange([...keywords, value]);
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword();
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {keywords.map((k) => (
          <span key={k} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {k}
            <button type="button" onClick={() => onChange(keywords.filter((w) => w !== k))} className="text-gray-400 hover:text-gray-700">
              ×
            </button>
          </span>
        ))}
        {keywords.length === 0 && <p className="text-xs text-gray-400">Nenhuma palavra-chave adicionada ainda.</p>}
      </div>
      <div className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite uma palavra-chave e pressione Enter"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={addKeyword}
          disabled={!input.trim()}
          className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          + Adicionar
        </button>
      </div>
    </div>
  );
}

function AutoTagRuleForm({
  initial,
  allTags,
  onCreateTag,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  initial: { name: string; keywords: string[]; tagIds: string[] };
  allTags: Tag[];
  onCreateTag: (name: string) => Promise<Tag>;
  onCancel: () => void;
  onSubmit: (values: { name: string; keywords: string[]; tagIds: string[] }) => Promise<void>;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial.name);
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [tagIds, setTagIds] = useState<Set<string>>(new Set(initial.tagIds));
  const [newTagName, setNewTagName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleTag(tagId: string) {
    setTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    const tag = await onCreateTag(newTagName.trim());
    setTagIds((prev) => new Set(prev).add(tag.id));
    setNewTagName("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || keywords.length === 0 || tagIds.size === 0) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), keywords, tagIds: Array.from(tagIds) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Nome do autoatendimento</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Social Seller"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Acionamento — palavras-chave</label>
        <KeywordEditor keywords={keywords} onChange={setKeywords} />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-600">Ação — marcar contato com a(s) Aba(s):</p>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                tagIds.has(tag.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim() || keywords.length === 0 || tagIds.size === 0}
          className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function AutoRepliesPage() {
  const [autoTaggingEnabled, setAutoTaggingEnabled] = useState(false);
  const [rules, setRules] = useState<AutoTagRule[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  async function handleCreateTag(name: string): Promise<Tag> {
    const res = await api.post("/tags", { name });
    setAllTags((prev) => [...prev, res.data]);
    return res.data;
  }

  async function handleCreateRule(values: { name: string; keywords: string[]; tagIds: string[] }) {
    await api.post("/auto-tag-rules", values);
    setShowCreateForm(false);
    await refresh();
  }

  async function handleUpdateRule(id: string, values: { name: string; keywords: string[]; tagIds: string[] }) {
    await api.patch(`/auto-tag-rules/${id}`, values);
    setEditingId(null);
    await refresh();
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
            onClick={() => {
              setEditingId(null);
              setShowCreateForm((v) => !v);
            }}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            + Novo autoatendimento
          </button>
        </div>

        <div className="mb-4 space-y-2">
          {rules.map((rule) =>
            editingId === rule.id ? (
              <AutoTagRuleForm
                key={rule.id}
                initial={{ name: rule.name, keywords: rule.keywords, tagIds: rule.tags.map((t) => t.id) }}
                allTags={allTags}
                onCreateTag={handleCreateTag}
                onCancel={() => setEditingId(null)}
                onSubmit={(values) => handleUpdateRule(rule.id, values)}
                submitLabel="Salvar alterações"
              />
            ) : (
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
                <div className="flex gap-3 text-xs">
                  <button
                    onClick={() => {
                      setShowCreateForm(false);
                      setEditingId(rule.id);
                    }}
                    className="font-medium text-brand-dark hover:underline"
                  >
                    Editar
                  </button>
                  <button onClick={() => handleDeleteRule(rule.id)} className="text-red-600 hover:underline">
                    Excluir
                  </button>
                </div>
              </div>
            ),
          )}
          {rules.length === 0 && !showCreateForm && (
            <p className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
              Nenhum autoatendimento cadastrado ainda.
            </p>
          )}
        </div>

        {showCreateForm && (
          <AutoTagRuleForm
            initial={{ name: "", keywords: [], tagIds: [] }}
            allTags={allTags}
            onCreateTag={handleCreateTag}
            onCancel={() => setShowCreateForm(false)}
            onSubmit={handleCreateRule}
            submitLabel="Salvar autoatendimento"
          />
        )}
      </div>
    </div>
  );
}
