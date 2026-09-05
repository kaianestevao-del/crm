import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

interface Note {
  id: string;
  content: string;
  createdAt: string;
}

function NoteItem({ note, onUpdated, onDeleted }: { note: Note; onUpdated: (n: Note) => void; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const res = await api.patch(`/notes/${note.id}`, { content: draft.trim() });
      onUpdated(res.data);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await api.delete(`/notes/${note.id}`);
    onDeleted();
  }

  if (editing) {
    return (
      <div className="rounded-md border border-brand bg-white p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          autoFocus
          className="w-full resize-none rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none"
        />
        <div className="mt-1 flex justify-end gap-2">
          <button onClick={() => setEditing(false)} className="text-[11px] text-gray-500 hover:underline">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving} className="text-[11px] font-medium text-brand-dark hover:underline">
            Salvar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-md border border-gray-200 bg-gray-50 p-2">
      <p className="whitespace-pre-wrap text-xs text-gray-700">{note.content}</p>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-[10px] text-gray-400">{new Date(note.createdAt).toLocaleString("pt-BR")}</p>
        <div className="hidden gap-2 group-hover:flex">
          <button onClick={() => setEditing(true)} className="text-[11px] text-gray-500 hover:underline">
            Editar
          </button>
          <button onClick={handleDelete} className="text-[11px] text-red-600 hover:underline">
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContactNotes({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await api.get(`/contacts/${contactId}/notes`);
    setNotes(res.data);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const res = await api.post(`/contacts/${contactId}/notes`, { content: draft.trim() });
      setNotes((prev) => [res.data, ...prev]);
      setDraft("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-80 flex-shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <p className="font-medium">Anotações</p>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
          Fechar
        </button>
      </div>
      <form onSubmit={handleCreate} className="border-b border-gray-100 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escreva uma anotação sobre esse contato..."
          rows={3}
          className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={saving || !draft.trim()}
          className="mt-2 w-full rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Criar anotação
        </button>
      </form>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {notes.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            onUpdated={(updated) => setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))}
            onDeleted={() => setNotes((prev) => prev.filter((n) => n.id !== note.id))}
          />
        ))}
        {notes.length === 0 && <p className="text-sm text-gray-500">Nenhuma anotação ainda.</p>}
      </div>
    </div>
  );
}
