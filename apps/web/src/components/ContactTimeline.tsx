import { useEffect, useState } from "react";
import { isMonthYearTagName, MONTH_NAMES_PT, ORIGIN_TAGS_PT } from "@crm/shared";
import { api } from "../lib/api";
import { Tag } from "./ContactTags";

const YEARS = Array.from({ length: 2035 - 2024 + 1 }, (_, i) => 2024 + i);

// Dedicated pickers for the two things the Dashboard's cohort/origin charts actually read —
// replaces having agents hunt for "Setembro/2026" or "Site" inside the generic tag dropdown.
// Under the hood these are still plain Tags; only one Mês/Ano tag is kept per contact (a new
// pick replaces the old one), while Origem stays multi-select since a lead can reach out
// through more than one channel over time.
export function ContactTimeline({
  contactId,
  tags,
  onChange,
}: {
  contactId: string;
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
}) {
  const monthYearTag = tags.find((t) => isMonthYearTagName(t.name));
  const [currentMonth, currentYear] = monthYearTag ? monthYearTag.name.split("/") : ["", ""];

  const [monthDraft, setMonthDraft] = useState(currentMonth);
  const [yearDraft, setYearDraft] = useState(currentYear);
  const [savingMonthYear, setSavingMonthYear] = useState(false);
  const [showOriginPicker, setShowOriginPicker] = useState(false);

  useEffect(() => {
    setMonthDraft(currentMonth);
    setYearDraft(currentYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, currentYear]);

  async function commitMonthYear(month: string, year: string) {
    if (!month || !year) return;
    const newName = `${month}/${year}`;
    if (monthYearTag?.name === newName) return;
    setSavingMonthYear(true);
    try {
      const { data: tag } = await api.post("/tags", { name: newName });
      await api.post(`/contacts/${contactId}/tags`, { tagId: tag.id });
      let next = tags;
      if (monthYearTag) {
        await api.delete(`/contacts/${contactId}/tags/${monthYearTag.id}`);
        next = next.filter((t) => t.id !== monthYearTag.id);
      }
      onChange([...next, tag]);
    } finally {
      setSavingMonthYear(false);
    }
  }

  const originTags = tags.filter((t) => (ORIGIN_TAGS_PT as readonly string[]).includes(t.name));
  const availableOrigins = ORIGIN_TAGS_PT.filter((name) => !originTags.some((t) => t.name === name));

  async function addOrigin(name: string) {
    const { data: tag } = await api.post("/tags", { name });
    await api.post(`/contacts/${contactId}/tags`, { tagId: tag.id });
    if (!tags.some((t) => t.id === tag.id)) onChange([...tags, tag]);
  }

  async function removeOrigin(tag: Tag) {
    await api.delete(`/contacts/${contactId}/tags/${tag.id}`);
    onChange(tags.filter((t) => t.id !== tag.id));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
      <span className="text-xs font-medium text-gray-500">🕒 Timeline</span>

      <label className="flex items-center gap-1 text-xs text-gray-500">
        Ano
        <select
          value={yearDraft}
          onChange={(e) => {
            setYearDraft(e.target.value);
            commitMonthYear(monthDraft, e.target.value);
          }}
          disabled={savingMonthYear}
          className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs focus:border-brand focus:outline-none disabled:opacity-50"
        >
          <option value="">—</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1 text-xs text-gray-500">
        Mês
        <select
          value={monthDraft}
          onChange={(e) => {
            setMonthDraft(e.target.value);
            commitMonthYear(e.target.value, yearDraft);
          }}
          disabled={savingMonthYear}
          className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs focus:border-brand focus:outline-none disabled:opacity-50"
        >
          <option value="">—</option>
          {MONTH_NAMES_PT.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <span className="h-4 w-px bg-gray-200" />

      <div className="relative flex flex-wrap items-center gap-1">
        <span className="text-xs text-gray-500">Origem</span>
        {originTags.map((tag) => (
          <span key={tag.id} className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            {tag.name}
            <button onClick={() => removeOrigin(tag)} className="text-amber-800/60 hover:text-amber-900">
              ×
            </button>
          </span>
        ))}
        <button
          onClick={() => setShowOriginPicker((v) => !v)}
          className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
        >
          + Origem
        </button>
        {showOriginPicker && (
          <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            {availableOrigins.length === 0 ? (
              <p className="px-2 py-1 text-xs text-gray-400">Todas as origens já vinculadas.</p>
            ) : (
              availableOrigins.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    addOrigin(name);
                    setShowOriginPicker(false);
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-gray-50"
                >
                  {name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
