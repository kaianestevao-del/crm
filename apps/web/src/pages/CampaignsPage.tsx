import { FormEvent, useEffect, useState } from "react";
import { CampaignStatus, SessionStatus } from "@crm/shared";
import { api } from "../lib/api";

interface Session {
  id: string;
  name: string;
  status: SessionStatus;
}

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string;
}

interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  _count: { recipients: number };
}

const statusLabel: Record<CampaignStatus, string> = {
  [CampaignStatus.DRAFT]: "Rascunho",
  [CampaignStatus.RUNNING]: "Enviando...",
  [CampaignStatus.DONE]: "Concluída",
  [CampaignStatus.FAILED]: "Falhou",
};

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");

  async function refresh() {
    const [campaignsRes, sessionsRes, contactsRes] = await Promise.all([
      api.get("/campaigns"),
      api.get("/whatsapp-sessions"),
      api.get("/contacts"),
    ]);
    setCampaigns(campaignsRes.data);
    setSessions(sessionsRes.data);
    setContacts(contactsRes.data);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  function toggleContact(id: string) {
    setSelectedContacts((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sessionId || !messageTemplate.trim() || selectedContacts.length === 0) return;
    await api.post("/campaigns", {
      name: name.trim(),
      whatsappSessionId: sessionId,
      messageTemplate: messageTemplate.trim(),
      contactIds: selectedContacts,
    });
    setName("");
    setMessageTemplate("");
    setSelectedContacts([]);
    setShowForm(false);
    await refresh();
  }

  async function handleStart(id: string) {
    await api.post(`/campaigns/${id}/start`);
    await refresh();
  }

  async function handleAddContact(e: FormEvent) {
    e.preventDefault();
    if (!newContactPhone.trim()) return;
    await api.post("/contacts", { name: newContactName.trim() || undefined, phoneNumber: newContactPhone.trim() });
    setNewContactName("");
    setNewContactPhone("");
    await refresh();
  }

  const connectedSessions = sessions.filter((s) => s.status === SessionStatus.CONNECTED);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Campanhas de envio em massa</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          + Nova campanha
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 max-w-xl space-y-3 rounded-md border border-gray-200 bg-white p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Nome da campanha</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Número de envio</label>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Selecione um número conectado</option>
              {connectedSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Mensagem (use <code>{"{{name}}"}</code> para o nome do contato)
            </label>
            <textarea
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              required
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Adicionar contato rápido</label>
            <div className="flex gap-2">
              <input
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="Nome (opcional)"
                className="w-1/2 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                placeholder="Telefone com DDI, ex: 5511999999999"
                className="w-1/2 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <button type="button" onClick={handleAddContact} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
                Adicionar
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Contatos ({selectedContacts.length} selecionados)</label>
            <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 p-2">
              {contacts.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
                  <input type="checkbox" checked={selectedContacts.includes(c.id)} onChange={() => toggleContact(c.id)} />
                  {c.name?.trim() || `+${c.phoneNumber}`}
                </label>
              ))}
              {contacts.length === 0 && <p className="text-sm text-gray-500">Nenhum contato cadastrado ainda.</p>}
            </div>
          </div>
          <button type="submit" className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Criar campanha
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Destinatários</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{c.name}</td>
                <td className="px-4 py-2">{c._count.recipients}</td>
                <td className="px-4 py-2">{statusLabel[c.status]}</td>
                <td className="px-4 py-2 text-right">
                  {c.status === CampaignStatus.DRAFT && (
                    <button onClick={() => handleStart(c.id)} className="text-xs font-medium text-brand-dark hover:underline">
                      Iniciar envio
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-sm text-gray-500" colSpan={4}>
                  Nenhuma campanha criada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
