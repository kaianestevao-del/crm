import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

interface QuickReplyCategory {
  id: string;
  name: string;
  hexColor: string | null;
}

export interface QuickReply {
  id: string;
  title: string;
  type: "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT";
  content: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
  category: QuickReplyCategory | null;
}

const TYPE_ICON: Record<QuickReply["type"], string> = {
  TEXT: "💬",
  IMAGE: "🖼️",
  AUDIO: "🎤",
  DOCUMENT: "📄",
};

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
  const [type, setType] = useState<QuickReply["type"]>(initial?.type ?? "TEXT");
  const [content, setContent] = useState(initial?.content ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category?.id ?? "");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

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
    if (!initial && type !== "TEXT" && !file) return;
    setSaving(true);
    try {
      const resolvedCategoryId = await resolveCategoryId();
      const formData = new FormData();
      formData.append("title", title.trim());
      if (!initial) formData.append("type", type);
      formData.append("content", content);
      formData.append("categoryId", resolvedCategoryId ?? "");
      if (file) formData.append("file", file);

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
    <div className="space-y-2 border-b border-gray-100 bg-gray-50 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título da resposta"
        required
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
      />
      {!initial && (
        <select
          value={type}
          onChange={(e) => setType(e.target.value as QuickReply["type"])}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="TEXT">Texto</option>
          <option value="IMAGE">Imagem</option>
          <option value="AUDIO">Áudio</option>
          <option value="DOCUMENT">Documento</option>
        </select>
      )}
      {(type === "TEXT" || initial) && (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Texto da mensagem (ou legenda, se for mídia)"
          rows={2}
          className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
        />
      )}
      {type !== "TEXT" && (
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-xs"
          accept={type === "IMAGE" ? "image/*" : type === "AUDIO" ? "audio/*" : undefined}
        />
      )}
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
    <div ref={containerRef} className="absolute bottom-full left-0 mb-2 flex h-96 w-96 flex-col rounded-lg border border-gray-200 bg-white shadow-lg">
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
              <span>{TYPE_ICON[qr.type]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{qr.title}</span>
                {qr.content && <span className="block truncate text-xs text-gray-500">{qr.content}</span>}
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
