import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { downloadFile } from "../lib/download";
import { ContactAvatar, contactLabel } from "../components/ContactAvatar";
import { Icon } from "../components/Icon";
import { ContactPaymentModal } from "../components/ContactPaymentModal";
import { useAuth } from "../context/AuthContext";

interface Tag {
  id: string;
  name: string;
}

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string;
  avatarUrl: string | null;
  tags: Tag[];
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
  const [tagFilter, setTagFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportTagIds, setExportTagIds] = useState<Set<string>>(new Set());
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (tagFilter && !c.tags.some((t) => t.id === tagFilter)) return false;
      if (!query) return true;
      return contactLabel(c).toLowerCase().includes(query) || c.phoneNumber.includes(query);
    });
  }, [contacts, search, tagFilter]);

  function toggleExportTag(tagId: string) {
    setExportTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function exportAll() {
    setExporting(true);
    try {
      await downloadFile("/contacts/export", "contatos.xlsx");
    } finally {
      setExporting(false);
    }
  }

  async function exportSelected() {
    if (exportTagIds.size === 0) return;
    setExporting(true);
    try {
      await downloadFile(`/contacts/export?tagIds=${Array.from(exportTagIds).join(",")}`, "contatos.xlsx");
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
          <p className="mb-2 text-xs text-gray-500">Ou selecione só algumas abas para baixar apenas esses contatos:</p>
          <div className="mb-3 flex flex-wrap gap-1">
            {allTags.length === 0 && <p className="text-xs text-gray-400">Nenhuma aba criada ainda.</p>}
            {allTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleExportTag(tag.id)}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  exportTagIds.has(tag.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
          <button
            onClick={exportSelected}
            disabled={exporting || exportTagIds.size === 0}
            className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Baixar selecionados ({exportTagIds.size})
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
        <button
          type="button"
          onClick={() => setTagFilter("")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            tagFilter === "" ? "bg-brand text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
          }`}
        >
          Todas as abas
        </button>
        {allTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => setTagFilter(tag.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              tagFilter === tag.id
                ? "bg-brand text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tag.name}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-5 py-3 font-medium">Contato</th>
              <th className="px-5 py-3 font-medium">Telefone</th>
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
                <td colSpan={canLaunchPayment ? 5 : 4} className="px-4 py-6 text-center text-sm text-gray-400">
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
