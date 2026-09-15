import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

interface QuickReplyCategory {
  id: string;
  name: string;
  hexColor: string | null;
}

type StepType = "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT";

export interface QuickReplyStep {
  type: StepType;
  content: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
}

export interface QuickReply {
  id: string;
  title: string;
  category: QuickReplyCategory | null;
  steps: QuickReplyStep[];
}

const TYPE_ICON: Record<StepType, string> = {
  TEXT: "💬",
  IMAGE: "🖼️",
  AUDIO: "🎤",
  DOCUMENT: "📄",
};

const AVAILABLE_TAGS: { tag: string; label: string }[] = [
  { tag: "{{nome}}", label: "Primeiro nome" },
  { tag: "{{telefone}}", label: "Telefone" },
  { tag: "{{saudacao}}", label: "Saudação" },
  { tag: "{{diaSemana}}", label: "Dia da semana" },
];

// A step being edited — a new file staged for upload lives in `file` (not sent to the
// server until save); a step carried over from the saved quick reply keeps its
// existingMediaUrl/Name so re-saving without touching that step doesn't require re-uploading.
interface DraftStep {
  type: StepType;
  content: string;
  file: File | null;
  existingMediaUrl: string | null;
  existingMediaName: string | null;
}

function emptyStep(type: StepType = "TEXT"): DraftStep {
  return { type, content: "", file: null, existingMediaUrl: null, existingMediaName: null };
}

function QuickReplyForm({
  categories,
  initial,
  onSaved,
  onCancel,
  onCategoriesChanged,
}: {
  categories: QuickReplyCategory[];
  initial?: QuickReply;
  onSaved: () => void;
  onCancel: () => void;
  onCategoriesChanged: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category?.id ?? "");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>(
    initial
      ? initial.steps.map((s) => ({
          type: s.type,
          content: s.content ?? "",
          file: null,
          existingMediaUrl: s.mediaUrl,
          existingMediaName: s.mediaName,
        }))
      : [emptyStep()],
  );
  const [saving, setSaving] = useState(false);
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focusedStep, setFocusedStep] = useState(0);

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function insertTag(tag: string) {
    const index = focusedStep;
    const textarea = textareaRefs.current[index];
    const current = steps[index]?.content ?? "";
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${tag}${current.slice(end)}`;
    updateStep(index, { content: next });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  async function resolveCategoryId(): Promise<string | undefined> {
    if (newCategoryName.trim()) {
      const res = await api.post("/quick-replies/categories", { name: newCategoryName.trim() });
      onCategoriesChanged();
      return res.data.id;
    }
    return categoryId || undefined;
  }

  async function handleSubmit() {
    if (!title.trim()) return;
    if (steps.length === 0) return;
    for (const step of steps) {
      if (step.type !== "TEXT" && !step.file && !step.existingMediaUrl) return;
    }
    setSaving(true);
    try {
      const resolvedCategoryId = await resolveCategoryId();
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("categoryId", resolvedCategoryId ?? "");
      formData.append(
        "steps",
        JSON.stringify(
          steps.map((s) => ({
            type: s.type,
            content: s.content,
            hasNewFile: !!s.file,
            existingMediaUrl: s.file ? undefined : s.existingMediaUrl ?? undefined,
            existingMediaName: s.file ? undefined : s.existingMediaName ?? undefined,
          })),
        ),
      );
      for (const step of steps) {
        if (step.file) formData.append("files", step.file);
      }

      if (initial) {
        await api.patch(`/quick-replies/${initial.id}`, formData, { headers: { "Content-Type": "multipart/form-data" } });
      } else {
        await api.post("/quick-replies", formData, { headers: { "Content-Type": "multipart/form-data" } });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-h-[28rem] space-y-3 overflow-y-auto border-b border-gray-100 bg-gray-50 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título da resposta"
        required
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
      />

      <div className="flex flex-wrap gap-1">
        {AVAILABLE_TAGS.map((t) => (
          <button
            key={t.tag}
            type="button"
            onClick={() => insertTag(t.tag)}
            title={`Inserir na etapa ${focusedStep + 1}`}
            className="rounded-full bg-white px-2 py-0.5 text-xs text-brand-dark ring-1 ring-inset ring-brand-dark/30 hover:bg-brand-dark hover:text-white"
          >
            + {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {steps.map((step, index) => (
          <div key={index} className="space-y-1.5 rounded-md border border-gray-200 bg-white p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Etapa {index + 1}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(index, 1)}
                  disabled={index === steps.length - 1}
                  className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  disabled={steps.length === 1}
                  className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-30"
                >
                  🗑️
                </button>
              </div>
            </div>
            <select
              value={step.type}
              onChange={(e) => updateStep(index, { type: e.target.value as StepType })}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="TEXT">Texto</option>
              <option value="IMAGE">Imagem</option>
              <option value="AUDIO">Áudio</option>
              <option value="DOCUMENT">Documento</option>
            </select>
            <textarea
              ref={(el) => (textareaRefs.current[index] = el)}
              value={step.content}
              onFocus={() => setFocusedStep(index)}
              onChange={(e) => updateStep(index, { content: e.target.value })}
              placeholder={step.type === "TEXT" ? "Texto da mensagem" : "Legenda (opcional)"}
              rows={2}
              className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
            {step.type !== "TEXT" && (
              <>
                <input
                  type="file"
                  onChange={(e) => updateStep(index, { file: e.target.files?.[0] ?? null })}
                  className="w-full text-xs"
                  accept={step.type === "IMAGE" ? "image/*" : step.type === "AUDIO" ? "audio/*" : undefined}
                />
                {!step.file && step.existingMediaName && (
                  <p className="truncate text-xs text-gray-400">Arquivo atual: {step.existingMediaName}</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={addStep} className="text-xs font-medium text-brand-dark hover:underline">
        + Adicionar etapa
      </button>

      <div className="flex gap-2">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={!!newCategoryName.trim()}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">Sem categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <input
        value={newCategoryName}
        onChange={(e) => setNewCategoryName(e.target.value)}
        placeholder="ou crie uma nova categoria..."
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:underline">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="rounded-md bg-brand-dark px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

export function QuickReplyPicker({ onPick, onClose }: { onPick: (quickReply: QuickReply) => void; onClose: () => void }) {
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [formState, setFormState] = useState<"none" | "new" | string>("none");
  const containerRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const res = await api.get("/quick-replies");
    setQuickReplies(res.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, QuickReplyCategory>();
    for (const qr of quickReplies) {
      if (qr.category) map.set(qr.category.id, qr.category);
    }
    return Array.from(map.values());
  }, [quickReplies]);

  const filtered = quickReplies.filter((qr) => {
    if (categoryId && qr.category?.id !== categoryId) return false;
    if (search.trim() && !qr.title.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  async function handleDelete(id: string) {
    await api.delete(`/quick-replies/${id}`);
    setQuickReplies((prev) => prev.filter((qr) => qr.id !== id));
  }

  return (
    <div ref={containerRef} className="absolute bottom-full left-0 mb-2 flex h-[30rem] w-[26rem] flex-col rounded-lg border border-gray-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <p className="text-sm font-medium">Respostas rápidas</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setFormState("new")} className="text-xs font-medium text-brand-dark hover:underline">
            + Nova
          </button>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
            Fechar
          </button>
        </div>
      </div>

      {formState === "new" && (
        <QuickReplyForm
          categories={categories}
          onCancel={() => setFormState("none")}
          onSaved={() => {
            setFormState("none");
            refresh();
          }}
          onCategoriesChanged={refresh}
        />
      )}

      {formState !== "none" && formState !== "new" && (
        <QuickReplyForm
          categories={categories}
          initial={quickReplies.find((qr) => qr.id === formState)}
          onCancel={() => setFormState("none")}
          onSaved={() => {
            setFormState("none");
            refresh();
          }}
          onCategoriesChanged={refresh}
        />
      )}

      {formState === "none" && (
        <div className="border-b border-gray-100 p-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              onClick={() => setCategoryId(null)}
              className={`rounded-full px-2 py-0.5 text-xs ${!categoryId ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"}`}
            >
              Todas
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  categoryId === c.id ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.map((qr) => (
          <div key={qr.id} className="group flex items-start gap-2 border-b border-gray-50 px-3 py-2 hover:bg-gray-50">
            <button onClick={() => onPick(qr)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
              <span>{TYPE_ICON[qr.steps[0]?.type ?? "TEXT"]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {qr.title}
                  {qr.steps.length > 1 && <span className="ml-1 text-xs font-normal text-gray-400">({qr.steps.length} partes)</span>}
                </span>
                {qr.steps[0]?.content && <span className="block truncate text-xs text-gray-500">{qr.steps[0].content}</span>}
              </span>
            </button>
            <div className="hidden flex-shrink-0 gap-1 group-hover:flex">
              <button onClick={() => setFormState(qr.id)} title="Editar" className="text-xs text-gray-400 hover:text-gray-700">
                ✏️
              </button>
              <button onClick={() => handleDelete(qr.id)} title="Excluir" className="text-xs text-gray-400 hover:text-red-600">
                🗑️
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && formState === "none" && <p className="p-3 text-sm text-gray-500">Nenhuma resposta encontrada.</p>}
      </div>
    </div>
  );
}
