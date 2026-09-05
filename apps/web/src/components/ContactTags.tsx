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
  const [showCreate, setShowCreate] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  useEffect(() => {
    api.get("/tags").then((res) => setAllTags(res.data));
  }, []);

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
    setAllTags((prev) => (prev.some((t) => t.id === res.data.id) ? prev : [...prev, res.data]));
    await addTag(res.data.id);
    setNewTagName("");
    setShowCreate(false);
  }

  const availableTags = allTags.filter((t) => !tags.some((selected) => selected.id === t.id));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span key={tag.id} className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
          {tag.name}
          <button onClick={() => removeTag(tag.id)} className="text-brand-dark/60 hover:text-brand-dark">
            ×
          </button>
        </span>
      ))}

      <select
        value=""
        onChange={(e) => {
          if (e.target.value) addTag(e.target.value);
        }}
        className="rounded-full border border-dashed border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50 focus:border-brand focus:outline-none"
      >
        <option value="">+ Aba</option>
        {availableTags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>

      {showCreate ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAndAddTag()}
            placeholder="Nome da aba..."
            className="w-32 rounded-md border border-gray-300 px-2 py-0.5 text-xs focus:border-brand focus:outline-none"
          />
          <button onClick={createAndAddTag} className="text-xs font-medium text-brand-dark hover:underline">
            Criar
          </button>
          <button onClick={() => setShowCreate(false)} className="text-xs text-gray-400 hover:underline">
            ✕
          </button>
        </span>
      ) : (
        <button onClick={() => setShowCreate(true)} className="text-xs text-gray-400 hover:text-gray-600" title="Criar nova aba">
          + nova
        </button>
      )}
    </div>
  );
}
