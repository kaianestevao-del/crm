import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Icon, IconName } from "../components/Icon";

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

interface MessageFunnel {
  contacted: number;
  converted: number;
  conversionRate: number | null;
  outboundTotal: number;
  outboundUntilPayment: number;
  inboundUntilPayment: number;
  outboundPerConversion: number | null;
  gaveUp: number;
  avgOutboundUntilGiveUp: number | null;
}

interface ChannelLead {
  contactId: string;
  name: string | null;
  phoneNumber: string;
  converted: boolean;
  firstPaidAt: string | null;
  totalPaid: number | null;
  inbound: number;
  outbound: number;
}

function ChannelLeads({ month, channel }: { month: string; channel: string }) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<ChannelLead[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showConverted, setShowConverted] = useState(false);
  const [showNotConverted, setShowNotConverted] = useState(false);

  useEffect(() => {
    api
      .get("/dashboard/channel-leads", { params: { month, channel } })
      .then((res) => setLeads(res.data))
      .catch(() => setFailed(true));
  }, [month, channel]);

  if (failed) return <p className="mt-1 text-[11px] text-red-500">Não foi possível carregar os leads.</p>;
  if (!leads) return <p className="mt-1 text-[11px] text-gray-400">Carregando...</p>;

  const converted = leads.filter((l) => l.converted);
  const notConverted = leads.filter((l) => !l.converted);

  function renderList(list: ChannelLead[]) {
    return (
      <ul className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
        {list.map((l) => (
          <li key={l.contactId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-gray-800">{l.name?.trim() || `+${l.phoneNumber}`}</p>
              <p className="text-[10px] text-gray-400">
                {l.inbound} recebidas · {l.outbound} enviadas{l.converted ? " até o 1º pagamento" : ""}
                {l.totalPaid != null ? ` · ${currencyFormatter.format(l.totalPaid)}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/inbox", { state: { contactId: l.contactId } })}
              className="shrink-0 rounded-lg bg-brand px-2 py-1 text-[10px] font-medium text-white hover:bg-brand-dark"
            >
              Ir para a Caixa de Entrada
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div>
        <button
          type="button"
          onClick={() => setShowConverted((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700"
        >
          <span>Converteram ({converted.length})</span>
          <span>{showConverted ? "−" : "+"}</span>
        </button>
        {showConverted && (converted.length ? renderList(converted) : <p className="mt-1 text-[11px] text-gray-400">Ninguém ainda.</p>)}
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowNotConverted((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-600"
        >
          <span>Não converteram ({notConverted.length})</span>
          <span>{showNotConverted ? "−" : "+"}</span>
        </button>
        {showNotConverted &&
          (notConverted.length ? renderList(notConverted) : <p className="mt-1 text-[11px] text-gray-400">Todos converteram.</p>)}
      </div>
    </div>
  );
}

interface DashboardSummary {
  // Optional: a web build can be live before the API that produces it — never crash on absence.
  funnel?: MessageFunnel;
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

const tones = {
  emerald: { badge: "bg-emerald-50 text-emerald-600", value: "text-emerald-600" },
  red: { badge: "bg-red-50 text-red-500", value: "text-red-500" },
  brand: { badge: "bg-brand/10 text-brand-dark", value: "text-brand-dark" },
  blue: { badge: "bg-blue-50 text-blue-600", value: "text-gray-900" },
  amber: { badge: "bg-amber-50 text-amber-600", value: "text-gray-900" },
  violet: { badge: "bg-violet-50 text-violet-600", value: "text-gray-900" },
} as const;

function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: IconName;
  tone: keyof typeof tones;
}) {
  const t = tones[tone];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.badge}`}>
          <Icon name={icon} />
        </span>
      </div>
      <p className={`mt-3 text-2xl font-semibold ${t.value}`}>{value}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  noPadding,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </div>
  );
}

function FunnelPanel({ funnel, avgDaysToFirstPayment }: { funnel: MessageFunnel; avgDaysToFirstPayment: number | null }) {
  return (
    <Panel title="Funil de mensagens" subtitle="Todos os contatos do CRM, até o 1º pagamento ou até desistir">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Recebidas até pagar</p>
              <p className="text-xl font-semibold text-gray-800">{funnel.inboundUntilPayment}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Enviadas até pagar</p>
              <p className="text-xl font-semibold text-gray-800">{funnel.outboundUntilPayment}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Conversão (contatados)</p>
              <p className="text-xl font-semibold text-emerald-600">
                {funnel.conversionRate == null ? "—" : `${(funnel.conversionRate * 100).toFixed(1)}%`}
              </p>
              <p className="text-[11px] text-gray-400">
                {funnel.converted} de {funnel.contacted} · {funnel.outboundTotal} msgs enviadas
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Msgs enviadas por venda</p>
              <p className="text-xl font-semibold text-gray-800">
                {funnel.outboundPerConversion == null ? "—" : Math.round(funnel.outboundPerConversion)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Msgs enviadas até desistir</p>
              <p className="text-xl font-semibold text-red-500">
                {funnel.avgOutboundUntilGiveUp == null ? "—" : Math.round(funnel.avgOutboundUntilGiveUp)}
              </p>
              <p className="text-[11px] text-gray-400">média de {funnel.gaveUp} desistências</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Tempo médio até 1º pagamento</p>
              <p className="text-xl font-semibold text-brand-dark">{formatDays(avgDaysToFirstPayment)}</p>
            </div>
          </div>
    </Panel>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCohort, setExpandedCohort] = useState<string | null>(null);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/dashboard/summary")
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm text-gray-500">Carregando dashboard...</div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">Não foi possível carregar o dashboard.</div>;

  const kpis: { label: string; value: string; icon: IconName; tone: keyof typeof tones }[] = [
    { label: "Pacientes Ativos", value: String(data.patients.active), icon: "users", tone: "emerald" },
    { label: "Pacientes Vencidas", value: String(data.patients.vencida), icon: "alert", tone: "red" },
    { label: "Tempo médio de resposta", value: formatSeconds(data.avgResponseSeconds), icon: "clock", tone: "brand" },
    {
      label: "Tempo médio até 1º pagamento",
      value: formatDays(data.avgDaysToFirstPayment),
      icon: "calendar",
      tone: "brand",
    },
  ];

  const revenueKpis: { label: string; value: string; icon: IconName; tone: keyof typeof tones }[] = [
    { label: "Faturamento Total", value: currencyFormatter.format(data.revenue.total), icon: "cash", tone: "brand" },
    {
      label: "Ticket Médio",
      value: data.revenue.avgTicket == null ? "Sem dados" : currencyFormatter.format(data.revenue.avgTicket),
      icon: "tag",
      tone: "amber",
    },
    {
      label: "LTV Médio",
      value: data.revenue.avgLtv == null ? "Sem dados" : currencyFormatter.format(data.revenue.avgLtv),
      icon: "trend",
      tone: "violet",
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Visão geral de pacientes, atendimento e conversão.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {revenueKpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Conversão em Follow-up" subtitle="Contatos até a decisão">
          <div className="flex gap-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Icon name="check" />
              </span>
              <div>
                <p className="text-xs text-gray-500">Média até converter</p>
                <p className="text-xl font-semibold text-emerald-600">{formatContacts(data.followUpOutcomes.avgConverted)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                <Icon name="alert" />
              </span>
              <div>
                <p className="text-xs text-gray-500">Média até desistir (Unfollow)</p>
                <p className="text-xl font-semibold text-red-500">{formatContacts(data.followUpOutcomes.avgLost)}</p>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Mensagens até o 1º pagamento" subtitle="Volume médio de conversa">
          {data.avgMessagesToFirstPayment ? (
            <div className="flex gap-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Icon name="chat" />
                </span>
                <div>
                  <p className="text-xs text-gray-500">Recebidas</p>
                  <p className="text-xl font-semibold text-gray-800">{Math.round(data.avgMessagesToFirstPayment.inbound)}</p>
                </div>
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
        </Panel>
      </div>

      {data.funnel && (
        <div className="mt-4">
          <FunnelPanel funnel={data.funnel} avgDaysToFirstPayment={data.avgDaysToFirstPayment} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Pagamentos recentes" noPadding>
          {data.recentPayments.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">Nenhum pagamento registrado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-5 py-2 font-medium">Contato</th>
                    <th className="px-5 py-2 font-medium">Etapa</th>
                    <th className="px-5 py-2 font-medium">Dias na etapa</th>
                    <th className="px-5 py-2 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.map((p) => {
                    const name = p.contactName?.trim() || `+${p.phoneNumber}`;
                    return (
                      <tr key={p.id} className="border-t border-gray-100">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                              {name.charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <p className="font-medium text-gray-800">{name}</p>
                              <p className="text-xs text-gray-400">{dateFormatter.format(new Date(p.paidAt))}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-600">{p.stageName}</td>
                        <td className="px-5 py-3 text-gray-600">
                          {p.daysInStage == null ? "—" : `${Math.max(0, Math.round(p.daysInStage))}d`}
                        </td>
                        <td className="px-5 py-3 font-medium text-brand-dark">{currencyFormatter.format(p.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Cohort por mês de chegada" subtitle="Toque na lupa para ver a origem dos leads">
          {data.cohorts.length === 0 ? (
            <p className="text-sm text-gray-400">Sem contatos registrados ainda.</p>
          ) : (
            <div className="space-y-4">
              {data.cohorts.map((c) => {
                const pct = c.totalLeads > 0 ? Math.round((c.convertedCount / c.totalLeads) * 100) : 0;
                const isExpanded = expandedCohort === c.label;
                const maxChannelLeads = Math.max(1, ...c.channels.map((ch) => ch.totalLeads));
                return (
                  <div key={c.label}>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-gray-600">
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
                      <span className="font-medium text-gray-500">
                        {c.convertedCount} de {c.totalLeads} leads · {pct}%
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                    {isExpanded && c.channels.length > 0 && (
                      <div className="mt-2 space-y-1.5 rounded-xl bg-gray-50 p-3">
                        {c.channels.map((ch) => {
                          const chPct = ch.totalLeads > 0 ? Math.round((ch.convertedCount / ch.totalLeads) * 100) : 0;
                          const barWidth = Math.round((ch.totalLeads / maxChannelLeads) * 100);
                          const chKey = `${c.label}||${ch.name}`;
                          const chOpen = expandedChannel === chKey;
                          return (
                            <div key={ch.name}>
                              <div className="mb-0.5 flex items-center justify-between text-[11px] text-gray-500">
                                <span className="flex items-center gap-1">
                                  {ch.name}
                                  <button
                                    type="button"
                                    onClick={() => setExpandedChannel(chOpen ? null : chKey)}
                                    className={`rounded px-1 text-[10px] font-medium hover:bg-gray-200 ${chOpen ? "text-brand-dark" : "text-gray-400"}`}
                                    title="Ver quem chegou por este canal"
                                  >
                                    {chOpen ? "▾ leads" : "▸ leads"}
                                  </button>
                                </span>
                                <span>
                                  {ch.convertedCount} de {ch.totalLeads} · {chPct}%
                                </span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                                <div className="h-full rounded-full bg-brand-dark/60" style={{ width: `${barWidth}%` }} />
                              </div>
                              {chOpen && <ChannelLeads month={c.label} channel={ch.name} />}
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
        </Panel>
      </div>
    </div>
  );
}
