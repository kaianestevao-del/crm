import { useState } from "react";
import { PLAN_TYPES, PLAN_TYPE_LABELS, PlanType, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PaymentMethod } from "@crm/shared";
import { api } from "../lib/api";

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Launches a payment straight from the Contatos list — works for contacts that never wrote in
// (no conversation), since the API resolves/creates the deal from the contact alone.
export function ContactPaymentModal({
  contact,
  onClose,
}: {
  contact: { id: string; label: string; phoneNumber: string };
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [planType, setPlanType] = useState<PlanType | "">("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [date, setDate] = useState(todayInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markActive, setMarkActive] = useState(true);
  const [done, setDone] = useState<null | "none" | "moved" | "no_stage">(null);

  async function submit() {
    // "1.200,50" (pt-BR: dot = thousands) and "1200.50" / "1200,50" all read as intended.
    const raw = value.trim();
    const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        value: parsed,
        planType: planType || null,
        paymentMethod: paymentMethod || null,
        markActive,
      };
      // Today -> let the server stamp "now"; a past day -> midday local so the month never
      // drifts across a timezone boundary.
      if (date && date !== todayInputValue()) {
        const [y, m, d] = date.split("-").map(Number);
        body.paidAt = new Date(y, m - 1, d, 12).toISOString();
      }
      const res = await api.post(`/pipelines/contacts/${contact.id}/deal-payments`, body);
      setDone(res.data.activation ?? "none");
    } catch {
      setError("Não foi possível lançar o pagamento. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "mb-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Lançar financeiro</p>
            <p className="truncate text-xs text-gray-500">
              {contact.label} · +{contact.phoneNumber}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Fechar">
            ✕
          </button>
        </div>

        {done !== null ? (
          <div>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Pagamento lançado! Ele já aparece na Caixa do dashboard.
              {done === "moved" && " A paciente foi movida para Paciente Ativa."}
            </p>
            {done === "no_stage" && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Nenhuma etapa do funil está marcada como “Paciente Ativa” (Configurações), então a etapa não foi alterada.
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white">
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-gray-600">Valor (R$)</label>
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0,00"
              className={inputClass}
            />
            <label className="mb-1 block text-xs font-medium text-gray-600">Tipo de plano</label>
            <select value={planType} onChange={(e) => setPlanType(e.target.value as PlanType | "")} className={inputClass}>
              <option value="">Selecione...</option>
              {PLAN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PLAN_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-xs font-medium text-gray-600">Forma de pagamento</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}
              className={inputClass}
            >
              <option value="">Selecione...</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-xs font-medium text-gray-600">Data do pagamento</label>
            <input
              type="date"
              value={date}
              max={todayInputValue()}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
            <label className="mb-3 flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={markActive} onChange={(e) => setMarkActive(e.target.checked)} />
              Marcar como Paciente Ativa no funil
            </label>
            {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-2 py-1 text-xs text-gray-500 hover:underline">
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving || !value.trim()}
                className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Lançando..." : "Lançar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
