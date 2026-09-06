import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
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

  if (loading) return <div className="p-6 text-sm text-gray-500">Carregando contatos...</div>;

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Contatos</h1>
      <p className="mb-4 text-sm text-gray-500">{contacts.length} contatos no total.</p>

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
                    <span className="font-medium">{contactLabel(contact)}</span>
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
