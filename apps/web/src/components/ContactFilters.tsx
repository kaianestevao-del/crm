import { useEffect, useMemo, useRef, useState } from "react";
import { MONTH_NAMES_PT, OBJECTIVE_TAGS_PT, ORIGIN_TAGS_PT, canonicalObjectiveTag, isMonthYearTagName } from "@crm/shared";

// The contact filters shared by the Contacts page (list + "Baixar filtrados") and the Campaign
// audience ("Por filtros"), so both pick exactly the same people: Mês/Ano, Objetivo, Origem and
// Etapa do Kanban. Inside a filter any pick matches (setembro OR novembro); across filters all
// must match (mês AND objetivo). A contact matching several picks still counts once.

export interface FilterableContact {
  id: string;
  phoneNumber: string;
  tags: { id: string; name: string }[];
  // The latest deal's Kanban stage, or null when the contact has no deal yet.
  stage?: { id: string; name: string; order: number } | null;
}

// Contacts with no deal yet — a value of its own in the Kanban stage filter.
export const NO_STAGE = "none";

export type FilterKey = "months" | "objectives" | "origins" | "stages";
export type ContactFilterValues = Record<FilterKey, string[]>;

export const EMPTY_FILTERS: ContactFilterValues = { months: [], objectives: [], origins: [], stages: [] };

const isOriginTagName = (name: string) => (ORIGIN_TAGS_PT as readonly string[]).includes(name);

// "Setembro/2026" → sortable number, so the month list shows the newest first.
function monthSortKey(name: string) {
  const [month, year] = name.split("/");
  return Number(year) * 12 + MONTH_NAMES_PT.indexOf(month as (typeof MONTH_NAMES_PT)[number]);
}

// Which filter a tag belongs to, if any — used to pre-fill the filters from an old "Por Aba"
// campaign.
export function filterKeyForTag(name: string): FilterKey | null {
  if (isMonthYearTagName(name)) return "months";
  if (canonicalObjectiveTag(name)) return "objectives";
  if (isOriginTagName(name)) return "origins";
  return null;
}

// One entry per phone number (the first one wins) — the same person can exist twice (e.g. saved
// once by phone and once by WhatsApp's LID), and must never get the same campaign twice.
export function uniqueByPhone<C extends { phoneNumber: string }>(contacts: C[]) {
  const seen = new Set<string>();
  return contacts.filter((c) => {
    const phone = c.phoneNumber.replace(/\D/g, "");
    if (seen.has(phone)) return false;
    seen.add(phone);
    return true;
  });
}

export function useContactFilters<C extends FilterableContact>(contacts: C[], initial: ContactFilterValues = EMPTY_FILTERS) {
  const [values, setValues] = useState<ContactFilterValues>(initial);

  const options = useMemo(() => {
    const tagMap = new Map<string, { id: string; name: string }>();
    const stageMap = new Map<string, { id: string; name: string; order: number }>();
    for (const c of contacts) {
      for (const t of c.tags) tagMap.set(t.id, t);
      if (c.stage) stageMap.set(c.stage.id, c.stage);
    }
    const tags = Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return {
      months: tags.filter((t) => isMonthYearTagName(t.name)).sort((a, b) => monthSortKey(b.name) - monthSortKey(a.name)),
      // In the fixed order of the six objectives, only the ones some contact actually has.
      objectives: OBJECTIVE_TAGS_PT.flatMap((o) => tags.filter((t) => canonicalObjectiveTag(t.name) === o)),
      origins: tags.filter((t) => isOriginTagName(t.name)),
      stages: [
        ...Array.from(stageMap.values()).sort((a, b) => a.order - b.order),
        { id: NO_STAGE, name: "Sem etapa no Kanban" },
      ],
    };
  }, [contacts]);

  const hasFilters = Object.values(values).some((v) => v.length > 0);

  const matching = useMemo(
    () =>
      contacts.filter((c) => {
        for (const ids of [values.months, values.objectives, values.origins]) {
          if (ids.length && !c.tags.some((t) => ids.includes(t.id))) return false;
        }
        if (values.stages.length && !values.stages.includes(c.stage?.id ?? NO_STAGE)) return false;
        return true;
      }),
    [contacts, values],
  );

  function set(key: FilterKey, ids: string[]) {
    setValues((prev) => ({ ...prev, [key]: ids }));
  }

  // Query string for GET /contacts/export — same param names the API reads.
  function toQuery() {
    const params = new URLSearchParams();
    for (const key of Object.keys(values) as FilterKey[]) if (values[key].length) params.set(key, values[key].join(","));
    return params.toString();
  }

  return { values, set, clear: () => setValues(EMPTY_FILTERS), options, hasFilters, matching, toQuery };
}

export type ContactFiltersState = ReturnType<typeof useContactFilters>;

const LABELS: Record<FilterKey, string> = {
  months: "Mês/Ano",
  objectives: "Objetivo",
  origins: "Origem",
  stages: "Etapa do Kanban",
};

// The four dropdowns plus "Limpar filtros" — the caller adds its own count/search around it.
export function ContactFilterBar({ filters }: { filters: ContactFiltersState }) {
  return (
    <>
      {(Object.keys(LABELS) as FilterKey[]).map((key) => (
        <FilterSelect
          key={key}
          label={LABELS[key]}
          value={filters.values[key]}
          onChange={(ids) => filters.set(key, ids)}
          options={filters.options[key]}
        />
      ))}
      {filters.hasFilters && (
        <button type="button" onClick={filters.clear} className="text-xs font-medium text-gray-500 hover:underline">
          Limpar filtros
        </button>
      )}
    </>
  );
}

// A dropdown filter with checkboxes — several picks at once, scrollable when the list is long.
// Shows how many are picked and is highlighted while anything is.
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  const summary =
    value.length === 0
      ? `${label}: todos`
      : value.length === 1
        ? `${label}: ${options.find((o) => o.id === value[0])?.name ?? "1"}`
        : `${label}: ${value.length} selecionados`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-[240px] items-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium shadow-sm focus:outline-none ${
          value.length ? "border-brand bg-brand/10 text-brand-dark" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="text-[10px] opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-64 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          <div className="max-h-64 overflow-y-auto">
            {options.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhuma opção.</p>}
            {options.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} className="accent-brand-dark" />
                <span className="truncate">{o.name}</span>
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full border-t border-gray-100 px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50"
            >
              Limpar {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
