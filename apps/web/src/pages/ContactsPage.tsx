import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { downloadFile } from "../lib/download";
import { ContactAvatar, contactLabel } from "../components/ContactAvatar";
import { Icon } from "../components/Icon";
import { ContactPaymentModal } from "../components/ContactPaymentModal";
import { useAuth } from "../context/AuthContext";
import { MONTH_NAMES_PT, OBJECTIVE_TAGS_PT, ORIGIN_TAGS_PT, canonicalObjectiveTag, isMonthYearTagName } from "@crm/shared";

interface Tag {
  id: string;
  name: string;
}

// "Setembro/2026" → sortable number, so the month dropdown lists the newest first.
function monthSortKey(name: string) {
  const [month, year] = name.split("/");
  return Number(year) * 12 + MONTH_NAMES_PT.indexOf(month as (typeof MONTH_NAMES_PT)[number]);
}

const isOriginTagName = (name: string) => (ORIGIN_TAGS_PT as readonly string[]).includes(name);

// Contacts with no deal yet — a value of its own in the Kanban stage filter.
const NO_STAGE = "none";

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string;
  avatarUrl: string | null;
  tags: Tag[];
  // The latest deal's Kanban stage, or null when the contact has no deal yet.
  stage: { id: string; name: string; order: number } | null;
  hasConversation: boolean;
  createdAt: string;
}

export function ContactsPage() {
  const navigate = useNavigate();
  const { organization } = useAuth();
  // The payment endpoint lives under the Funil (kanban) module, so gate the button the same way.
  const canLaunchPayment = organization?.allowedModules.includes("kanban") ?? false;
  const [paymentFor, setPaymentFor] = useState<Contact | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Several picks per filter (tag ids, stage ids or NO_STAGE); empty means "todos". Inside a
  // filter any pick matches (setembro OR novembro); across filters all must match.
  const [monthFilter, setMonthFilter] = useState<string[]>([]);
  const [objectiveFilter, setObjectiveFilter] = useState<string[]>([]);
  const [originFilter, setOriginFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api
      .get("/contacts")
      .then((res) => setContacts(res.data))
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const contact of contacts) {
      for (const tag of contact.tags) map.set(tag.id, tag);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [contacts]);

  const monthTags = useMemo(
    () => allTags.filter((t) => isMonthYearTagName(t.name)).sort((a, b) => monthSortKey(b.name) - monthSortKey(a.name)),
    [allTags],
  );
  // In the fixed order of the six objectives, only the ones some contact actually has.
  const objectiveTags = useMemo(
    () =>
      OBJECTIVE_TAGS_PT.flatMap((o) => {
        const tag = allTags.find((t) => canonicalObjectiveTag(t.name) === o);
        return tag ? [tag] : [];
      }),
    [allTags],
  );
  const originTags = useMemo(() => allTags.filter((t) => isOriginTagName(t.name)), [allTags]);
  const stages = useMemo(() => {
    const map = new Map<string, { id: string; name: string; order: number }>();
    for (const c of contacts) if (c.stage) map.set(c.stage.id, c.stage);
    return Array.from(map.values()).sort((a, b) => a.order - b.order);
  }, [contacts]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((c) => {
      for (const ids of [monthFilter, objectiveFilter, originFilter]) {
        if (ids.length && !c.tags.some((t) => ids.includes(t.id))) return false;
      }
      if (stageFilter.length && !stageFilter.includes(c.stage?.id ?? NO_STAGE)) return false;
      if (!query) return true;
      return contactLabel(c).toLowerCase().includes(query) || c.phoneNumber.includes(query);
    });
  }, [contacts, search, monthFilter, objectiveFilter, originFilter, stageFilter]);

  const hasFilters = [monthFilter, objectiveFilter, originFilter, stageFilter].some((f) => f.length > 0);

  function clearFilters() {
    setMonthFilter([]);
    setObjectiveFilter([]);
    setOriginFilter([]);
    setStageFilter([]);
  }

  async function exportAll() {
    setExporting(true);
    try {
      await downloadFile("/contacts/export", "contatos.xlsx");
    } finally {
      setExporting(false);
    }
  }

  // Downloads the contacts matching the current filters (the name/phone search isn't applied —
  // it's for finding one person, not for building a list).
  async function exportFiltered() {
    if (!hasFilters) return;
    const params = new URLSearchParams();
    if (monthFilter.length) params.set("months", monthFilter.join(","));
    if (objectiveFilter.length) params.set("objectives", objectiveFilter.join(","));
    if (originFilter.length) params.set("origins", originFilter.join(","));
    if (stageFilter.length) params.set("stages", stageFilter.join(","));
    setExporting(true);
    try {
      await downloadFile(`/contacts/export?${params.toString()}`, "contatos.xlsx");
    } finally {
      setExporting(false);
    }
  }

  function startEditing(contact: Contact) {
    setEditingId(contact.id);
    setEditingName(contact.name ?? "");
  }

  async function saveName(contactId: string) {
    const name = editingName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const res = await api.patch(`/contacts/${contactId}`, { name });
      setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, name: res.data.name } : c)));
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Carregando contatos...</div>;

  const withConversation = contacts.filter((c) => c.hasConversation).length;

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Contatos</h1>
          <p className="text-sm text-gray-500">Base de contatos e conversas do WhatsApp.</p>
        </div>
        <button
          onClick={() => setShowExport((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50"
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          Baixar contatos
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-gray-500">Total de contatos</p>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand-dark">
              <Icon name="users" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-gray-900">{contacts.length}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-gray-500">Com conversa iniciada</p>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Icon name="chat" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-gray-900">{withConversation}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-gray-500">Abas cadastradas</p>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <Icon name="tag" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-gray-900">{allTags.length}</p>
        </div>
      </div>

      {showExport && (
        <div className="mb-4 max-w-xl rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-900">Baixar contatos (Excel)</p>
            <button
              onClick={exportAll}
              disabled={exporting}
              className="rounded-xl bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Baixar tudo
            </button>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {hasFilters
              ? "Ou baixe só os contatos dos filtros escolhidos abaixo (mês/ano, objetivo, origem e etapa do Kanban)."
              : "Para baixar só uma parte, escolha os filtros abaixo (mês/ano, objetivo, origem, etapa do Kanban)."}
          </p>
          <button
            onClick={exportFiltered}
            disabled={exporting || !hasFilters}
            className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Baixar filtrados{hasFilters ? ` (${filtered.length})` : ""}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-64 rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-brand focus:outline-none"
          />
        </div>
        <FilterSelect label="Mês/Ano" value={monthFilter} onChange={setMonthFilter} options={monthTags} />
        <FilterSelect label="Objetivo" value={objectiveFilter} onChange={setObjectiveFilter} options={objectiveTags} />
        <FilterSelect label="Origem" value={originFilter} onChange={setOriginFilter} options={originTags} />
        <FilterSelect
          label="Etapa do Kanban"
          value={stageFilter}
          onChange={setStageFilter}
          options={[...stages, { id: NO_STAGE, name: "Sem etapa no Kanban" }]}
        />
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs font-medium text-gray-500 hover:underline">
            Limpar filtros
          </button>
        )}
        <span className="text-xs text-gray-400">
          {filtered.length} de {contacts.length} contatos
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-5 py-3 font-medium">Contato</th>
              <th className="px-5 py-3 font-medium">Telefone</th>
              <th className="px-5 py-3 font-medium">Etapa do Kanban</th>
              <th className="px-5 py-3 font-medium">Abas</th>
              {canLaunchPayment && <th className="px-5 py-3 font-medium">Lançamento</th>}
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((contact) => (
              <tr key={contact.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <ContactAvatar contact={contact} size={32} />
                    {editingId === contact.id ? (
                      <>
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveName(contact.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand focus:outline-none"
                        />
                        <button
                          onClick={() => saveName(contact.id)}
                          disabled={saving || !editingName.trim()}
                          className="text-xs font-medium text-brand-dark hover:underline disabled:opacity-50"
                        >
                          Salvar
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-gray-800">{contactLabel(contact)}</span>
                        <button
                          onClick={() => startEditing(contact)}
                          title="Editar nome"
                          className="text-gray-300 hover:text-brand-dark"
                        >
                          <Icon name="edit" className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-gray-600">+{contact.phoneNumber}</td>
                <td className="px-5 py-3 text-xs text-gray-600">{contact.stage?.name ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.map((tag) => (
                      <span key={tag.id} className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </td>
                {canLaunchPayment && (
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setPaymentFor(contact)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 px-2.5 py-1 text-xs font-medium text-brand-dark hover:bg-brand/10"
                    >
                      <Icon name="cash" className="h-3.5 w-3.5" />
                      Financeiro
                    </button>
                  </td>
                )}
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => navigate("/inbox", { state: { contactId: contact.id } })}
                    title={contact.hasConversation ? "Ir para a conversa" : "Ainda sem conversa — abre uma conversa vazia"}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-dark hover:underline"
                  >
                    <Icon name="chat" className="h-3.5 w-3.5" />
                    Ir para Caixa de Entrada
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canLaunchPayment ? 6 : 5} className="px-4 py-6 text-center text-sm text-gray-400">
                  Nenhum contato encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {paymentFor && (
        <ContactPaymentModal
          contact={{ id: paymentFor.id, label: contactLabel(paymentFor), phoneNumber: paymentFor.phoneNumber }}
          onClose={() => setPaymentFor(null)}
        />
      )}
    </div>
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
