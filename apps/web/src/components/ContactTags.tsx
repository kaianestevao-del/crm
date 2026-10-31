import { useEffect, useState } from "react";
import { OBJECTIVE_TAGS_PT, canonicalObjectiveTag } from "@crm/shared";
import { api } from "../lib/api";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

// The contact's objective tags — only the six fixed objectives (OBJECTIVE_TAGS_PT). Origin and
// arrival month have their own pickers in the Timeline, and patient status comes from the Kanban.
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

  // Reuses the org's existing Tag for that objective (even one typed as "Saúde em geral"), and
  // creates the canonical one the first time it's picked.
  async function addObjective(objective: string) {
    let tag = allTags.find((t) => canonicalObjectiveTag(t.name) === objective);
    if (!tag) {
      const res = await api.post("/tags", { name: objective });
      tag = res.data as Tag;
      setAllTags((prev) => (prev.some((t) => t.id === tag!.id) ? prev : [...prev, tag!]));
    }
    await addTag(tag.id);
  }

  const objectiveTags = tags.filter((t) => canonicalObjectiveTag(t.name));
  const availableObjectives = OBJECTIVE_TAGS_PT.filter((o) => !objectiveTags.some((t) => canonicalObjectiveTag(t.name) === o));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {objectiveTags.map((tag) => (
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
          if (e.target.value) addObjective(e.target.value);
        }}
        className="rounded-full border border-dashed border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50 focus:border-brand focus:outline-none"
      >
        <option value="">+ Objetivo</option>
        {availableObjectives.map((objective) => (
          <option key={objective} value={objective}>
            {objective}
          </option>
        ))}
      </select>
    </div>
  );
}
