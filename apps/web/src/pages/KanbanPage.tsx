import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DragDropContext, Draggable, Droppable, DropResult } from "@hello-pangea/dnd";
import { PlanType, PLAN_TYPE_LABELS } from "@crm/shared";
import { api } from "../lib/api";
import { downloadFile } from "../lib/download";

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string;
}

interface Payment {
  id: string;
  value: number;
  planType: PlanType | null;
}

interface FollowUp {
  target: number;
  contacts: { index: number }[];
}

interface Deal {
  id: string;
  title: string;
  payments: Payment[];
  order: number;
  stageId: string;
  contact: Contact;
  followUp: FollowUp | null;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Stage {
  id: string;
  name: string;
  order: number;
  deals: Deal[];
}

interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

export function KanbanPage() {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [showStageForm, setShowStageForm] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [savingStage, setSavingStage] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [confirmDeleteStageId, setConfirmDeleteStageId] = useState<string | null>(null);
  const [confirmDeleteDealId, setConfirmDeleteDealId] = useState<string | null>(null);

  async function refresh() {
    const [pipelinesRes, contactsRes] = await Promise.all([api.get("/pipelines"), api.get("/contacts")]);
    setPipeline(pipelinesRes.data[0] ?? null);
    setContacts(contactsRes.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreateDeal(e: FormEvent) {
    e.preventDefault();
    if (!pipeline || !title.trim() || !contactId) return;
    const firstStage = pipeline.stages[0];
    await api.post("/pipelines/deals", {
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      contactId,
      title: title.trim(),
    });
    setTitle("");
    setContactId("");
    setShowForm(false);
    await refresh();
  }

  async function handleDragEnd(result: DropResult) {
    if (!result.destination || !pipeline) return;
    const { draggableId, destination } = result;

    setPipeline((prev) => {
      if (!prev) return prev;
      const stages = prev.stages.map((s) => ({ ...s, deals: [...s.deals] }));
      let moved: Deal | undefined;
      for (const stage of stages) {
        const idx = stage.deals.findIndex((d) => d.id === draggableId);
        if (idx >= 0) {
          [moved] = stage.deals.splice(idx, 1);
          break;
        }
      }
      if (!moved) return prev;
      const destStage = stages.find((s) => s.id === destination.droppableId);
      destStage?.deals.splice(destination.index, 0, { ...moved, stageId: destination.droppableId });
      return { ...prev, stages };
    });

    await api.patch(`/pipelines/deals/${draggableId}/move`, {
      stageId: destination.droppableId,
      order: destination.index,
    });
  }

  async function handleCreateStage(e: FormEvent) {
    e.preventDefault();
    if (!pipeline || !newStageName.trim()) return;
    setSavingStage(true);
    try {
      await api.post(`/pipelines/${pipeline.id}/stages`, { name: newStageName.trim() });
      setNewStageName("");
      setShowStageForm(false);
      await refresh();
    } finally {
      setSavingStage(false);
    }
  }

  async function handleDeleteStage(stageId: string) {
    setStageError(null);
    setConfirmDeleteStageId(null);
    try {
      await api.delete(`/pipelines/stages/${stageId}`);
      await refresh();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error === "stage_has_deals"
          ? "Mova ou apague os negócios desta etapa antes de removê-la."
          : "Não foi possível apagar esta etapa.";
      setStageError(message);
    }
  }

  async function handleDeleteDeal(dealId: string) {
    setConfirmDeleteDealId(null);
    await api.delete(`/pipelines/deals/${dealId}`);
    await refresh();
  }

  if (!pipeline) return <div className="p-6 text-sm text-gray-500">Carregando funil...</div>;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{pipeline.name}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => downloadFile("/pipelines/deals/export", "negocios.xlsx")}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            ⬇️ Exportar negócios
          </button>
          <button
            onClick={() => setShowStageForm((v) => !v)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            + Nova etapa
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            + Novo lead
          </button>
        </div>
      </div>

      {showStageForm && (
        <form onSubmit={handleCreateStage} className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white p-3">
          <input
            autoFocus
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            placeholder="Nome da nova etapa"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={savingStage || !newStageName.trim()}
            className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Adicionar
          </button>
        </form>
      )}

      {stageError && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {stageError}
          <button onClick={() => setStageError(null)} className="text-red-400 hover:underline">
            ✕
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreateDeal} className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white p-3">
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Selecione um contato</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name?.trim() || `+${c.phoneNumber}`}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título do lead"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            Adicionar
          </button>
        </form>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-4 overflow-x-auto">
          {pipeline.stages.map((stage) => (
            <Droppable droppableId={stage.id} key={stage.id}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="flex w-72 flex-shrink-0 flex-col rounded-lg bg-gray-100 p-3"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700">
                      {stage.name} <span className="text-gray-400">({stage.deals.length})</span>
                    </p>
                    {confirmDeleteStageId === stage.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <button onClick={() => handleDeleteStage(stage.id)} className="font-medium text-red-600 hover:underline">
                          Confirmar
                        </button>
                        <button onClick={() => setConfirmDeleteStageId(null)} className="text-gray-400 hover:underline">
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteStageId(stage.id)}
                        title="Remover etapa"
                        className="rounded px-1 text-gray-400 hover:bg-gray-200 hover:text-red-600"
                      >
                        −
                      </button>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    {stage.deals.map((deal, index) => {
                      const totalValue = deal.payments.reduce((sum, p) => sum + p.value, 0);
                      const planTypes = Array.from(new Set(deal.payments.map((p) => p.planType).filter(Boolean))) as PlanType[];
                      return (
                      <Draggable draggableId={deal.id} index={index} key={deal.id}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className="rounded-md border border-gray-200 bg-white p-3 shadow-sm"
                          >
                            <p className="text-sm font-medium">{deal.contact.name?.trim() || `+${deal.contact.phoneNumber}`}</p>
                            <p className="text-xs text-gray-500">+{deal.contact.phoneNumber}</p>
                            <p className="mt-1 text-xs font-medium text-brand-dark">
                              {currencyFormatter.format(totalValue)}
                              {deal.payments.length > 1 && (
                                <span className="text-gray-400"> · {deal.payments.length} lançamentos</span>
                              )}
                            </p>
                            {planTypes.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {planTypes.map((type) => (
                                  <span key={type} className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark">
                                    {PLAN_TYPE_LABELS[type]}
                                  </span>
                                ))}
                              </div>
                            )}
                            {deal.followUp && (
                              <p className="mt-0.5 text-xs text-gray-500">
                                🔁 {deal.followUp.contacts.length} de {deal.followUp.target}
                              </p>
                            )}
                            <div className="mt-2 flex items-center justify-between">
                              <button
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => navigate("/inbox", { state: { contactId: deal.contact.id } })}
                                className="text-xs font-medium text-brand-dark hover:underline"
                              >
                                💬 Ir para Caixa de Entrada
                              </button>
                              {confirmDeleteDealId === deal.id ? (
                                <span className="flex items-center gap-1 text-xs">
                                  <button
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={() => handleDeleteDeal(deal.id)}
                                    className="font-medium text-red-600 hover:underline"
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={() => setConfirmDeleteDealId(null)}
                                    className="text-gray-400 hover:underline"
                                  >
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => setConfirmDeleteDealId(deal.id)}
                                  title="Excluir cliente do funil"
                                  className="text-xs font-medium text-red-600 hover:underline"
                                >
                                  🗑️ Excluir
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}
