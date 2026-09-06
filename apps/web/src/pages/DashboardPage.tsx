import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface RecentPayment {
  id: string;
  paidAt: string;
  value: number;
  contactName: string | null;
  phoneNumber: string;
  stageName: string;
  daysInStage: number | null;
}

interface CohortChannel {
  name: string;
  totalLeads: number;
  convertedCount: number;
}

interface Cohort {
  label: string;
  totalLeads: number;
  convertedCount: number;
  channels: CohortChannel[];
}

interface DashboardSummary {
  patients: { active: number; vencida: number };
  avgResponseSeconds: number | null;
  avgDaysToFirstPayment: number | null;
  avgMessagesToFirstPayment: { inbound: number; outbound: number; total: number } | null;
  recentPayments: RecentPayment[];
  followUpOutcomes: { avgConverted: number | null; avgLost: number | null };
  cohorts: Cohort[];
  revenue: { total: number; avgTicket: number | null; avgLtv: number | null };
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function formatSeconds(seconds: number | null): string {
  if (seconds == null) return "Sem dados";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`;
}

function formatDays(days: number | null): string {
  if (days == null) return "Sem dados";
  return `${Math.round(days)} dias`;
}

function formatContacts(count: number | null): string {
  if (count == null) return "—";
  return `${Math.round(count)} contatos`;
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCohort, setExpandedCohort] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/dashboard/summary")
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm text-gray-500">Carregando dashboard...</div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">Não foi possível carregar o dashboard.</div>;

  const kpis = [
    { label: "Pacientes Ativos", value: String(data.patients.active), tone: "text-emerald-600" },
    { label: "Pacientes Vencidas", value: String(data.patients.vencida), tone: "text-red-500" },
    { label: "Tempo médio de resposta", value: formatSeconds(data.avgResponseSeconds), tone: "text-brand-dark" },
    { label: "Tempo médio até 1º pagamento", value: formatDays(data.avgDaysToFirstPayment), tone: "text-brand-dark" },
  ];

  const revenueKpis = [
    { label: "Faturamento Total", value: currencyFormatter.format(data.revenue.total), tone: "text-brand-dark" },
    {
      label: "Ticket Médio",
      value: data.revenue.avgTicket == null ? "Sem dados" : currencyFormatter.format(data.revenue.avgTicket),
      tone: "text-brand-dark",
    },
    {
      label: "LTV Médio",
      value: data.revenue.avgLtv == null ? "Sem dados" : currencyFormatter.format(data.revenue.avgLtv),
      tone: "text-brand-dark",
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Dashboard</h1>
      <p className="mb-6 text-sm text-gray-500">Visão geral de pacientes, atendimento e conversão.</p>

      <div className="grid grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium text-gray-500">{kpi.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${kpi.tone}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        {revenueKpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium text-gray-500">{kpi.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${kpi.tone}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-gray-700">Conversão em Follow-up</p>
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-gray-500">Média até converter</p>
              <p className="text-xl font-semibold text-emerald-600">{formatContacts(data.followUpOutcomes.avgConverted)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Média até desistir (Unfollow)</p>
              <p className="text-xl font-semibold text-red-500">{formatContacts(data.followUpOutcomes.avgLost)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-gray-700">Mensagens até o 1º pagamento</p>
          {data.avgMessagesToFirstPayment ? (
            <div className="flex gap-6">
              <div>
                <p className="text-xs text-gray-500">Recebidas</p>
                <p className="text-xl font-semibold text-gray-800">{Math.round(data.avgMessagesToFirstPayment.inbound)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Enviadas</p>
                <p className="text-xl font-semibold text-gray-800">{Math.round(data.avgMessagesToFirstPayment.outbound)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-xl font-semibold text-brand-dark">{Math.round(data.avgMessagesToFirstPayment.total)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sem pagamentos registrados ainda.</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white">
          <p className="border-b border-gray-100 p-4 text-sm font-semibold text-gray-700">Pagamentos recentes</p>
          {data.recentPayments.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">Nenhum pagamento registrado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-2 font-medium">Contato</th>
                    <th className="px-4 py-2 font-medium">Etapa</th>
                    <th className="px-4 py-2 font-medium">Dias na etapa</th>
                    <th className="px-4 py-2 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">
                        {p.contactName?.trim() || `+${p.phoneNumber}`}
                        <span className="block text-xs text-gray-400">{dateFormatter.format(new Date(p.paidAt))}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{p.stageName}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {p.daysInStage == null ? "—" : `${Math.max(0, Math.round(p.daysInStage))}d`}
                      </td>
                      <td className="px-4 py-2 font-medium text-brand-dark">{currencyFormatter.format(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white">
          <p className="border-b border-gray-100 p-4 text-sm font-semibold text-gray-700">Cohort por mês de chegada (abas)</p>
          {data.cohorts.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">Sem contatos registrados ainda.</p>
          ) : (
            <div className="space-y-3 p-4">
              {data.cohorts.map((c) => {
                const pct = c.totalLeads > 0 ? Math.round((c.convertedCount / c.totalLeads) * 100) : 0;
                const isExpanded = expandedCohort === c.label;
                const maxChannelLeads = Math.max(1, ...c.channels.map((ch) => ch.totalLeads));
                return (
                  <div key={c.label}>
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                      <span className="flex items-center gap-1.5 font-medium text-gray-700">
                        {c.label}
                        {c.channels.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedCohort(isExpanded ? null : c.label)}
                            className={`rounded p-0.5 hover:bg-gray-100 ${isExpanded ? "text-brand-dark" : "text-gray-400"}`}
                            title="Ver origem dos leads"
                            aria-label="Ver origem dos leads"
                          >
                            🔍
                          </button>
                        )}
                      </span>
                      <span>
                        {c.convertedCount} de {c.totalLeads} leads · {pct}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-brand-dark" style={{ width: `${pct}%` }} />
                    </div>
                    {isExpanded && c.channels.length > 0 && (
                      <div className="mt-2 space-y-1.5 rounded-md bg-gray-50 p-3">
                        {c.channels.map((ch) => {
                          const chPct = ch.totalLeads > 0 ? Math.round((ch.convertedCount / ch.totalLeads) * 100) : 0;
                          const barWidth = Math.round((ch.totalLeads / maxChannelLeads) * 100);
                          return (
                            <div key={ch.name}>
                              <div className="mb-0.5 flex items-center justify-between text-[11px] text-gray-500">
                                <span>{ch.name}</span>
                                <span>
                                  {ch.convertedCount} de {ch.totalLeads} · {chPct}%
                                </span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                                <div className="h-full rounded-full bg-brand-dark/60" style={{ width: `${barWidth}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
