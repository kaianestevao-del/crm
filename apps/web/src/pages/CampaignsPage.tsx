import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";

type CampaignStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "DONE" | "FAILED";
type AudienceType = "ALL" | "TAG" | "LABEL" | "CONTACTS";

interface Template {
  id: string;
  name: string;
  category: "MARKETING" | "UTILITY";
  status: string;
}

interface Tag {
  id: string;
  name: string;
}

interface WhatsappLabel {
  id: string;
  name: string;
}

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string;
}

interface CampaignListItem {
  id: string;
  name: string;
  status: CampaignStatus;
  estimatedCost: string | number | null;
  scheduledFor: string | null;
  createdAt: string;
  template: { name: string; category: string };
  _count: { recipients: number };
}

interface CampaignDetail extends CampaignListItem {
  recipientCount: number;
  recipientStatusCounts: Record<string, number>;
  messageStatusCounts: Record<string, number>;
  previewCost: number | null;
}

interface CampaignEditData {
  id: string;
  name: string;
  templateId: string;
  audienceType: AudienceType;
  audienceTagId: string | null;
  audienceLabelId: string | null;
  audienceContactIds: string[];
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  SENDING: "Enviando",
  DONE: "Concluída",
  FAILED: "Falhou",
};

const STATUS_STYLE: Record<CampaignStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  SCHEDULED: "bg-blue-100 text-blue-700",
  SENDING: "bg-yellow-100 text-yellow-700",
  DONE: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
};

function money(v: string | number | null) {
  if (v === null) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function ContactPicker({
  contacts,
  selectedIds,
  onChange,
  onImportFile,
  importing,
}: {
  contacts: Contact[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onImportFile: (file: File) => void;
  importing: boolean;
}) {
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const term = search.trim().toLowerCase();
  const filtered = term
    ? contacts.filter((c) => (c.name ?? "").toLowerCase().includes(term) || c.phoneNumber.includes(term))
    : contacts;

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  const selectedContacts = contacts.filter((c) => selectedIds.includes(c.id));

  return (
    <div className="mt-2 space-y-2">
      {selectedContacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedContacts.map((c) => (
            <span key={c.id} className="flex items-center gap-1 rounded-full bg-brand-dark/10 px-2.5 py-1 text-xs font-medium text-brand-dark">
              {c.name || c.phoneNumber}
              <button type="button" onClick={() => toggle(c.id)} className="text-brand-dark/60 hover:text-brand-dark">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Pesquisar por nome ou telefone..."
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
      <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200">
        {filtered.slice(0, 50).map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50">
            <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggle(c.id)} />
            <span className="text-gray-700">{c.name || "(sem nome)"}</span>
            <span className="text-xs text-gray-400">{c.phoneNumber}</span>
          </label>
        ))}
        {filtered.length === 0 && <p className="p-3 text-xs text-gray-400">Nenhum contato encontrado.</p>}
      </div>
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="text-xs font-medium text-brand-dark hover:underline disabled:opacity-50"
        >
          {importing ? "Importando..." : "ou importar planilha (.xlsx) com colunas Nome e Telefone"}
        </button>
      </div>
    </div>
  );
}

function SendConfirmation({
  campaignId,
  recipientCount,
  previewCost,
  onDone,
  onCancel,
}: {
  campaignId: string;
  recipientCount: number;
  previewCost: number;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");

  async function confirmSend() {
    if (scheduleEnabled && !scheduledFor) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/campaigns/${campaignId}/send`, {
        scheduledFor: scheduleEnabled ? new Date(scheduledFor).toISOString() : undefined,
      });
      onDone();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message === "scheduled_for_must_be_in_the_future" ? "Escolha uma data/hora no futuro." : "Não foi possível disparar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-brand bg-brand/5 p-5">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">Confirmar disparo</h2>
      <p className="text-sm text-gray-700">
        <strong>{recipientCount}</strong> destinatário{recipientCount === 1 ? "" : "s"} × custo estimado por
        mensagem = <strong>{money(previewCost)}</strong> (estimativa, pode variar do valor real cobrado pela Meta).
      </p>

      <div className="mt-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
          Agendar para uma data/hora específica (em vez de disparar agora)
        </label>
        {scheduleEnabled && (
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="mt-2 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        {onCancel && (
          <button onClick={onCancel} className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
        )}
        <button
          onClick={confirmSend}
          disabled={sending || (scheduleEnabled && !scheduledFor)}
          className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {sending ? "Enviando..." : scheduleEnabled ? "Agendar disparo" : "Confirmar e disparar"}
        </button>
      </div>
    </div>
  );
}

function CampaignWizard({
  templates,
  tags,
  labels,
  contacts,
  editing,
  onDone,
  onCancel,
}: {
  templates: Template[];
  tags: Tag[];
  labels: WhatsappLabel[];
  contacts: Contact[];
  editing?: CampaignEditData | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [templateId, setTemplateId] = useState(editing?.templateId ?? "");
  const [audienceType, setAudienceType] = useState<AudienceType>(editing?.audienceType ?? "ALL");
  const [audienceTagId, setAudienceTagId] = useState(editing?.audienceTagId ?? "");
  const [audienceLabelId, setAudienceLabelId] = useState(editing?.audienceLabelId ?? "");
  const [audienceContactIds, setAudienceContactIds] = useState<string[]>(editing?.audienceContactIds ?? []);
  const [extraContacts, setExtraContacts] = useState<Contact[]>([]);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; recipientCount: number; previewCost: number } | null>(null);

  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");
  const allContacts = extraContacts.length
    ? [...contacts, ...extraContacts.filter((c) => !contacts.some((x) => x.id === c.id))]
    : contacts;

  async function handleImportFile(file: File) {
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post("/campaigns/import-leads", form, { headers: { "Content-Type": "multipart/form-data" } });
      const imported: Contact[] = res.data.contacts;
      setExtraContacts((prev) => [...prev, ...imported.filter((c) => !prev.some((x) => x.id === c.id))]);
      setAudienceContactIds((prev) => Array.from(new Set([...prev, ...imported.map((c) => c.id)])));
      setAudienceType("CONTACTS");
    } catch {
      setError("Não foi possível importar a planilha. Confira se ela tem uma coluna de telefone.");
    } finally {
      setImporting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !templateId) return;
    if (audienceType === "TAG" && !audienceTagId) return;
    if (audienceType === "LABEL" && !audienceLabelId) return;
    if (audienceType === "CONTACTS" && audienceContactIds.length === 0) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      templateId,
      audienceType,
      audienceTagId: audienceType === "TAG" ? audienceTagId : undefined,
      audienceLabelId: audienceType === "LABEL" ? audienceLabelId : undefined,
      audienceContactIds: audienceType === "CONTACTS" ? audienceContactIds : undefined,
    };
    try {
      const res = editing ? await api.patch(`/campaigns/${editing.id}`, payload) : await api.post("/campaigns", payload);
      setPreview({ id: res.data.id, recipientCount: res.data.recipientCount, previewCost: res.data.previewCost });
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(
        message === "no_recipients_found"
          ? "Nenhum contato encontrado para esse público."
          : `Não foi possível ${editing ? "salvar" : "criar"} a campanha.`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (preview) {
    return (
      <div className="mb-6">
        <SendConfirmation
          campaignId={preview.id}
          recipientCount={preview.recipientCount}
          previewCost={preview.previewCost}
          onDone={onDone}
          onCancel={onCancel}
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">{editing ? "Editar campanha" : "Nova campanha"}</h2>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Nome da campanha</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Promoção Setembro"
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Template (só aprovados)</label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        >
          <option value="">Selecione...</option>
          {approvedTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.category})
            </option>
          ))}
        </select>
        {approvedTemplates.length === 0 && (
          <p className="mt-1 text-xs text-amber-600">Nenhum template aprovado ainda — crie um em "Templates" e aguarde a aprovação da Meta.</p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Público</label>
        <div className="flex flex-wrap gap-2">
          {(["ALL", "TAG", "LABEL", "CONTACTS"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAudienceType(v)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                audienceType === v ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              {v === "ALL" ? "Todos os contatos" : v === "TAG" ? "Por Aba" : v === "LABEL" ? "Por Etiqueta" : "Contatos específicos"}
            </button>
          ))}
        </div>
        {audienceType === "TAG" && (
          <select
            value={audienceTagId}
            onChange={(e) => setAudienceTagId(e.target.value)}
            className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="">Selecione a aba...</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {audienceType === "LABEL" && (
          <select
            value={audienceLabelId}
            onChange={(e) => setAudienceLabelId(e.target.value)}
            className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="">Selecione a etiqueta...</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {audienceType === "CONTACTS" && (
          <ContactPicker
            contacts={allContacts}
            selectedIds={audienceContactIds}
            onChange={setAudienceContactIds}
            onImportFile={handleImportFile}
            importing={importing}
          />
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={
            saving ||
            !name.trim() ||
            !templateId ||
            (audienceType === "CONTACTS" && audienceContactIds.length === 0)
          }
          className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Calculando..." : editing ? "Salvar" : "Avançar"}
        </button>
      </div>
    </form>
  );
}

function CampaignDetails({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showSend, setShowSend] = useState(false);

  async function refresh() {
    const res = await api.get(`/campaigns/${id}`);
    setDetail(res.data);
  }

  useEffect(() => {
    refresh();
    const socket = getSocket();
    if (!socket) return;
    const onUpdate = (evt: { campaignId: string }) => {
      if (evt.campaignId === id) refresh();
    };
    socket.on("campaign.updated", onUpdate);
    return () => {
      socket.off("campaign.updated", onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!detail) return <p className="p-3 text-xs text-gray-400">Carregando...</p>;

  async function cancelSchedule() {
    setCancelling(true);
    try {
      await api.post(`/campaigns/${id}/cancel-schedule`);
      onChanged();
    } finally {
      setCancelling(false);
    }
  }

  if (detail.status === "DRAFT") {
    if (showSend) {
      return (
        <div className="border-t border-gray-100 p-4">
          <SendConfirmation
            campaignId={id}
            recipientCount={detail.recipientCount}
            previewCost={detail.previewCost ?? 0}
            onDone={() => {
              setShowSend(false);
              onChanged();
            }}
            onCancel={() => setShowSend(false)}
          />
        </div>
      );
    }
    return (
      <div className="border-t border-gray-100 bg-gray-50 p-4 text-sm">
        <p className="text-gray-700">
          {detail.recipientCount} destinatário{detail.recipientCount === 1 ? "" : "s"} · custo estimado {money(detail.previewCost)}
        </p>
        <button
          onClick={() => setShowSend(true)}
          className="mt-2 rounded-xl bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          Enviar campanha
        </button>
      </div>
    );
  }

  if (detail.status === "SCHEDULED") {
    return (
      <div className="border-t border-gray-100 bg-gray-50 p-4 text-sm">
        <p className="text-gray-700">
          Agendada para <strong>{detail.scheduledFor ? formatDateTime(detail.scheduledFor) : "—"}</strong> ·{" "}
          {detail.recipientCount} destinatários · custo estimado {money(detail.estimatedCost)}
        </p>
        <button
          onClick={cancelSchedule}
          disabled={cancelling}
          className="mt-2 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
        >
          {cancelling ? "Cancelando..." : "Cancelar agendamento"}
        </button>
      </div>
    );
  }

  const sent = detail.recipientStatusCounts.SENT ?? 0;
  const failed = detail.recipientStatusCounts.FAILED ?? 0;
  const pending = detail.recipientStatusCounts.PENDING ?? 0;
  const delivered = detail.messageStatusCounts.DELIVERED ?? 0;
  const read = detail.messageStatusCounts.READ ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 border-t border-gray-100 bg-gray-50 p-4 text-sm sm:grid-cols-5">
      <div>
        <p className="text-xs text-gray-400">Destinatários</p>
        <p className="font-semibold">{detail.recipientCount}</p>
      </div>
      <div>
        <p className="text-xs text-gray-400">Enviadas</p>
        <p className="font-semibold">{sent}</p>
      </div>
      <div>
        <p className="text-xs text-gray-400">Entregues</p>
        <p className="font-semibold">{delivered}</p>
      </div>
      <div>
        <p className="text-xs text-gray-400">Lidas</p>
        <p className="font-semibold">{read}</p>
      </div>
      <div>
        <p className="text-xs text-gray-400">Falharam</p>
        <p className="font-semibold text-red-600">{failed}</p>
      </div>
      {pending > 0 && (
        <div>
          <p className="text-xs text-gray-400">Aguardando</p>
          <p className="font-semibold">{pending}</p>
        </div>
      )}
      <div>
        <p className="text-xs text-gray-400">Custo estimado</p>
        <p className="font-semibold">{money(detail.estimatedCost)}</p>
      </div>
    </div>
  );
}

type WizardState = { mode: "create" } | { mode: "edit"; campaign: CampaignEditData };

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [labels, setLabels] = useState<WhatsappLabel[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function refreshCampaigns() {
    const res = await api.get("/campaigns");
    setCampaigns(res.data);
  }

  useEffect(() => {
    refreshCampaigns();
    api.get("/templates").then((res) => setTemplates(res.data));
    api.get("/tags").then((res) => setTags(res.data));
    api.get("/whatsapp-labels").then((res) => setLabels(res.data));
    api.get("/contacts").then((res) => setContacts(res.data));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUpdate = () => refreshCampaigns();
    socket.on("campaign.updated", onUpdate);
    return () => {
      socket.off("campaign.updated", onUpdate);
    };
  }, []);

  async function openEdit(id: string) {
    const res = await api.get(`/campaigns/${id}`);
    const c = res.data;
    setWizardState({
      mode: "edit",
      campaign: {
        id: c.id,
        name: c.name,
        templateId: c.templateId,
        audienceType: c.audienceType,
        audienceTagId: c.audienceTagId,
        audienceLabelId: c.audienceLabelId,
        audienceContactIds: c.audienceContactIds ?? [],
      },
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Campanhas</h1>
          <p className="text-sm text-gray-500">Disparo via Templates aprovados pela Meta — em massa ou pra contatos específicos.</p>
        </div>
        {!wizardState && (
          <button
            onClick={() => setWizardState({ mode: "create" })}
            className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            + Nova campanha
          </button>
        )}
      </div>

      {wizardState && (
        <CampaignWizard
          templates={templates}
          tags={tags}
          labels={labels}
          contacts={contacts}
          editing={wizardState.mode === "edit" ? wizardState.campaign : null}
          onDone={() => {
            setWizardState(null);
            refreshCampaigns();
          }}
          onCancel={() => setWizardState(null)}
        />
      )}

      <div className="space-y-2">
        {campaigns.map((c) => (
          <div key={c.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex items-center gap-2 p-4">
              <button
                onClick={() => setExpandedId((prev) => (prev === c.id ? null : c.id))}
                className="flex flex-1 items-center justify-between gap-2 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{c.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{c.template.name}</span>
                  {c.status === "SCHEDULED" && c.scheduledFor && (
                    <span className="text-xs text-blue-600">{formatDateTime(c.scheduledFor)}</span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{c._count.recipients} destinatários</span>
              </button>
              {c.status === "DRAFT" && (
                <button onClick={() => openEdit(c.id)} className="shrink-0 text-xs font-medium text-gray-500 hover:underline">
                  Editar
                </button>
              )}
              {c.status === "DRAFT" &&
                (confirmDeleteId === c.id ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs">
                    <span className="text-gray-500">Apagar?</span>
                    <button
                      onClick={async () => {
                        await api.delete(`/campaigns/${c.id}`);
                        setConfirmDeleteId(null);
                        refreshCampaigns();
                      }}
                      className="font-medium text-red-600 hover:underline"
                    >
                      Sim
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-gray-500 hover:underline">
                      Não
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDeleteId(c.id)} className="shrink-0 text-xs text-red-600 hover:underline">
                    Apagar
                  </button>
                ))}
            </div>
            {expandedId === c.id && <CampaignDetails id={c.id} onChanged={refreshCampaigns} />}
          </div>
        ))}
        {campaigns.length === 0 && !wizardState && <p className="text-sm text-gray-400">Nenhuma campanha criada ainda.</p>}
      </div>
    </div>
  );
}
