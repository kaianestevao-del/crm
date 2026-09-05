import { useEffect, useState } from "react";
import { api } from "../lib/api";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

export function ContactTags({
  contactId,
  tags,
  onChange,
}: {
  contactId: string;
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
}) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  useEffect(() => {
    if (open) api.get("/tags").then((res) => setAllTags(res.data));
  }, [open]);

  async function addTag(tagId: string) {
    const res = await api.post(`/contacts/${contactId}/tags`, { tagId });
    if (!tags.some((t) => t.id === res.data.id)) onChange([...tags, res.data]);
  }

  async function removeTag(tagId: string) {
    await api.delete(`/contacts/${contactId}/tags/${tagId}`);
    onChange(tags.filter((t) => t.id !== tagId));
  }

  async function createAndAddTag() {
    if (!newTagName.trim()) return;
    const res = await api.post("/tags", { name: newTagName.trim() });
    await addTag(res.data.id);
    setNewTagName("");
    setAllTags((prev) => (prev.some((t) => t.id === res.data.id) ? prev : [...prev, res.data]));
  }

  const availableTags = allTags.filter((t) => !tags.some((selected) => selected.id === t.id));

  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span key={tag.id} className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
          {tag.name}
          <button onClick={() => removeTag(tag.id)} className="text-brand-dark/60 hover:text-brand-dark">
            ×
          </button>
        </span>
      ))}
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
      >
        + Aba
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <div className="max-h-32 overflow-y-auto">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => {
                  addTag(tag.id);
                  setOpen(false);
                }}
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-gray-50"
              >
                {tag.name}
              </button>
            ))}
            {availableTags.length === 0 && <p className="px-2 py-1 text-xs text-gray-400">Nenhuma aba disponível</p>}
          </div>
          <div className="mt-1 flex gap-1 border-t border-gray-100 pt-1">
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Nova aba..."
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none"
            />
            <button
              onClick={() => {
                createAndAddTag();
                setOpen(false);
              }}
              className="rounded-md bg-brand-dark px-2 py-1 text-xs text-white hover:opacity-90"
            >
              Criar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
