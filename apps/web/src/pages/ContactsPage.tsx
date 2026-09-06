import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { downloadFile } from "../lib/download";
import { ContactAvatar, contactLabel } from "../components/ContactAvatar";

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

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Contatos</h1>
        <button
          onClick={() => setShowExport((v) => !v)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          ⬇️ Baixar contatos
        </button>
      </div>
      <p className="mb-4 text-sm text-gray-500">{contacts.length} contatos no total.</p>

      {showExport && (
        <div className="mb-4 max-w-xl rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Baixar contatos (Excel)</p>
            <button
              onClick={exportAll}
              disabled={exporting}
              className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
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
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Baixar selecionados ({exportTagIds.size})
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou telefone..."
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        >
          <option value="">Todas as abas</option>
          {allTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 font-medium">Contato</th>
              <th className="px-4 py-2 font-medium">Telefone</th>
              <th className="px-4 py-2 font-medium">Abas</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((contact) => (
              <tr key={contact.id} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <ContactAvatar contact={contact} size={28} />
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
                          className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand focus:outline-none"
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
                        <span className="font-medium">{contactLabel(contact)}</span>
                        <button
                          onClick={() => startEditing(contact)}
                          title="Editar nome"
                          className="text-gray-300 hover:text-brand-dark"
                        >
                          ✏️
                        </button>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-gray-600">+{contact.phoneNumber}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.map((tag) => (
                      <span key={tag.id} className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    disabled={!contact.hasConversation}
                    onClick={() => navigate("/inbox", { state: { contactId: contact.id } })}
                    title={contact.hasConversation ? "Ir para a conversa" : "Este contato ainda não trocou mensagens"}
                    className="text-xs font-medium text-brand-dark hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
                  >
                    💬 Ir para Caixa de Entrada
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                  Nenhum contato encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
