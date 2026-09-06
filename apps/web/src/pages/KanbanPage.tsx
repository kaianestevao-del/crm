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
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            + Novo lead
          </button>
        </div>
      </div>

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
                  <p className="mb-3 text-sm font-semibold text-gray-700">
                    {stage.name} <span className="text-gray-400">({stage.deals.length})</span>
                  </p>
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
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={() => navigate("/inbox", { state: { contactId: deal.contact.id } })}
                              className="mt-2 text-xs font-medium text-brand-dark hover:underline"
                            >
                              💬 Ir para Caixa de Entrada
                            </button>
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
