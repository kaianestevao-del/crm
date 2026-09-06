import { useEffect, useState } from "react";
import { PLAN_TYPES, PLAN_TYPE_LABELS, PlanType } from "@crm/shared";
import { api } from "../lib/api";

interface Stage {
  id: string;
  name: string;
  order: number;
}

interface Payment {
  id: string;
  value: number;
  planType: PlanType | null;
  paidAt: string;
}

interface Deal {
  id: string;
  stageId: string;
  payments: Payment[];
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export function ContactDeal({ contactId }: { contactId: string }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [valueInput, setValueInput] = useState("");
  const [planTypeInput, setPlanTypeInput] = useState<PlanType | "">("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const [pipelinesRes, dealRes] = await Promise.all([api.get("/pipelines"), api.get(`/pipelines/contacts/${contactId}/deal`)]);
    const pipeline = pipelinesRes.data[0];
    const sortedStages: Stage[] = pipeline ? [...pipeline.stages].sort((a: Stage, b: Stage) => a.order - b.order) : [];
    setStages(sortedStages);
    setDeal(dealRes.data);
  }

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setShowPanel(false);
    refresh()
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function handleStageChange(stageId: string) {
    setDeal((prev) => (prev ? { ...prev, stageId } : { id: "", stageId, payments: [] }));
    const res = await api.put(`/pipelines/contacts/${contactId}/deal-stage`, { stageId });
    setDeal((prev) => ({ ...(prev ?? { id: res.data.id, stageId: res.data.stageId, payments: [] }), stageId: res.data.stageId }));
  }

  function openPanel() {
    setValueInput("");
    setPlanTypeInput("");
    setShowPanel(true);
  }

  async function handleAddPayment() {
    const value = Number(valueInput.replace(",", "."));
    if (Number.isNaN(value) || value <= 0) return;
    setSaving(true);
    try {
      const res = await api.post(`/pipelines/contacts/${contactId}/deal-payments`, {
        value,
        planType: planTypeInput || null,
      });
      setDeal({ id: res.data.id, stageId: res.data.stageId, payments: res.data.payments });
      setValueInput("");
      setPlanTypeInput("");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePayment(paymentId: string) {
    const res = await api.delete(`/pipelines/deals/payments/${paymentId}`);
    setDeal((prev) => (prev ? { ...prev, payments: res.data.payments } : prev));
  }

  if (!loaded || stages.length === 0) return null;

  const totalValue = deal?.payments.reduce((sum, p) => sum + p.value, 0) ?? 0;

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={deal?.stageId ?? ""}
        onChange={(e) => handleStageChange(e.target.value)}
        title="Etapa no funil"
        className={`rounded-full border px-2 py-0.5 text-xs focus:outline-none ${
          deal?.stageId ? "border-brand bg-brand/10 text-brand-dark" : "border-dashed border-gray-300 bg-white text-gray-500"
        }`}
      >
        <option value="" disabled>
          📊 Funil: selecionar etapa
        </option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            📊 {stage.name}
          </option>
        ))}
      </select>

      <div className="relative">
        <button
          type="button"
          onClick={() => (showPanel ? setShowPanel(false) : openPanel())}
          title="Lançar valor"
          className={`rounded-full border px-2 py-0.5 text-xs focus:outline-none ${
            totalValue > 0 ? "border-brand bg-brand/10 text-brand-dark" : "border-dashed border-gray-300 bg-white text-gray-500"
          }`}
        >
          💰 {currencyFormatter.format(totalValue)}
        </button>
        {showPanel && (
          <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">Lançamentos</span>
              <span className="text-xs font-semibold text-brand-dark">Total: {currencyFormatter.format(totalValue)}</span>
            </div>

            {deal && deal.payments.length > 0 && (
              <ul className="mb-3 max-h-32 space-y-1 overflow-y-auto border-b border-gray-100 pb-2">
                {deal.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-xs text-gray-600">
                    <span>
                      {currencyFormatter.format(p.value)}
                      {p.planType && ` · ${PLAN_TYPE_LABELS[p.planType]}`}
                      <span className="text-gray-400"> · {dateFormatter.format(new Date(p.paidAt))}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeletePayment(p.id)}
                      title="Remover lançamento"
                      className="ml-2 text-gray-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label className="mb-1 block text-xs font-medium text-gray-600">Novo lançamento (R$)</label>
            <input
              autoFocus
              inputMode="decimal"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              placeholder="0,00"
              className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
            <label className="mb-1 block text-xs font-medium text-gray-600">Tipo de plano</label>
            <select
              value={planTypeInput}
              onChange={(e) => setPlanTypeInput(e.target.value as PlanType | "")}
              className="mb-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">Selecione...</option>
              {PLAN_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PLAN_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowPanel(false)} className="px-2 py-1 text-xs text-gray-500 hover:underline">
                Fechar
              </button>
              <button
                type="button"
                onClick={handleAddPayment}
                disabled={saving || !valueInput.trim()}
                className="rounded-md bg-brand-dark px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                + Adicionar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
