import { useEffect, useState } from "react";
import { PLAN_TYPES, PLAN_TYPE_LABELS, PlanType, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PaymentMethod } from "@crm/shared";
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
  paymentMethod: PaymentMethod | null;
  paidAt: string;
}

interface FollowUpContact {
  index: number;
  completedAt: string;
}

interface FollowUp {
  stageHistoryId: string;
  target: number;
  contacts: FollowUpContact[];
}

interface Deal {
  id: string;
  stageId: string;
  payments: Payment[];
  followUp: FollowUp | null;
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
  const [paymentMethodInput, setPaymentMethodInput] = useState<PaymentMethod | "">("");
  const [saving, setSaving] = useState(false);
  const [showFollowUpPanel, setShowFollowUpPanel] = useState(false);
  const [togglingIndex, setTogglingIndex] = useState<number | null>(null);

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
    setShowFollowUpPanel(false);
    refresh()
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function handleStageChange(stageId: string) {
    setDeal((prev) => (prev ? { ...prev, stageId } : prev));
    await api.put(`/pipelines/contacts/${contactId}/deal-stage`, { stageId });
    await refresh();
  }

  function openPanel() {
    setValueInput("");
    setPlanTypeInput("");
    setPaymentMethodInput("");
    setShowPanel(true);
  }

  async function handleAddPayment() {
    const value = Number(valueInput.replace(",", "."));
    if (Number.isNaN(value) || value <= 0) return;
    setSaving(true);
    try {
      await api.post(`/pipelines/contacts/${contactId}/deal-payments`, {
        value,
        planType: planTypeInput || null,
        paymentMethod: paymentMethodInput || null,
      });
      await refresh();
      setValueInput("");
      setPlanTypeInput("");
      setPaymentMethodInput("");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePayment(paymentId: string) {
    await api.delete(`/pipelines/deals/payments/${paymentId}`);
    await refresh();
  }

  async function handleToggleFollowUpContact(stageHistoryId: string, index: number, isMarked: boolean) {
    setTogglingIndex(index);
    try {
      if (isMarked) {
        await api.delete(`/pipelines/stage-history/${stageHistoryId}/follow-up-contacts/${index}`);
      } else {
        await api.put(`/pipelines/stage-history/${stageHistoryId}/follow-up-contacts/${index}`);
      }
      await refresh();
    } finally {
      setTogglingIndex(null);
    }
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

      {deal?.followUp && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowPanel(false);
              setShowFollowUpPanel((v) => !v);
            }}
            title="Contatos de follow-up realizados"
            className={`rounded-full border px-2 py-0.5 text-xs focus:outline-none ${
              deal.followUp.contacts.length > 0
                ? "border-brand bg-brand/10 text-brand-dark"
                : "border-dashed border-gray-300 bg-white text-gray-500"
            }`}
          >
            🔁 {deal.followUp.contacts.length} de {deal.followUp.target}
          </button>
          {showFollowUpPanel && (
            <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-xs font-semibold text-gray-600">
                Contatos realizados nesta etapa — clique para marcar/desmarcar
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: deal.followUp.target }, (_, i) => i + 1).map((index) => {
                  const contact = deal.followUp!.contacts.find((c) => c.index === index);
                  const isMarked = !!contact;
                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={togglingIndex === index}
                      onClick={() => handleToggleFollowUpContact(deal.followUp!.stageHistoryId, index, isMarked)}
                      title={isMarked ? `Contato ${index} — feito em ${dateFormatter.format(new Date(contact!.completedAt))}` : `Marcar contato ${index}`}
                      className={`flex h-6 w-6 items-center justify-center rounded text-xs font-medium disabled:opacity-50 ${
                        isMarked ? "bg-brand-dark text-white" : "border border-gray-300 bg-white text-gray-400 hover:border-brand"
                      }`}
                    >
                      {index}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowFollowUpPanel(false);
            if (showPanel) setShowPanel(false);
            else openPanel();
          }}
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
                      {p.paymentMethod && ` · ${PAYMENT_METHOD_LABELS[p.paymentMethod]}`}
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
            <label className="mb-1 block text-xs font-medium text-gray-600">Forma de pagamento</label>
            <select
              value={paymentMethodInput}
              onChange={(e) => setPaymentMethodInput(e.target.value as PaymentMethod | "")}
              className="mb-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">Selecione...</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
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
