import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MONTH_NAMES_PT, PLAN_TYPE_LABELS, PAYMENT_METHOD_LABELS, PlanType, PaymentMethod } from "@crm/shared";
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
  paidWithoutHistory: number;
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

interface PatientRow {
  dealId: string;
  contactId: string;
  name: string | null;
  phoneNumber: string;
  stageName: string;
}

type PatientRole = "ACTIVE_PATIENT" | "LOST_PATIENT";

function PatientsModal({ role, onClose }: { role: PatientRole; onClose: () => void }) {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<PatientRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get("/dashboard/patients", { params: { role } })
      .then((res) => setPatients(res.data))
      .catch(() => setFailed(true));
  }, [role]);

  const term = search.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const filtered = (patients ?? []).filter(
    (p) => !term || (p.name ?? "").toLowerCase().includes(term) || (digits && p.phoneNumber.includes(digits)),
  );
  const title = role === "ACTIVE_PATIENT" ? "Pacientes Ativos" : "Pacientes Vencidas";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <p className="text-sm font-semibold text-gray-900">
            {title}
            {patients && <span className="ml-1.5 font-normal text-gray-400">({patients.length})</span>}
          </p>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
            <span aria-hidden>🔍</span>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pelo nome ou telefone"
              className="w-full text-sm outline-none"
            />
          </div>
        </div>
        <div className="overflow-y-auto">
          {failed ? (
            <p className="p-5 text-sm text-red-500">Não foi possível carregar a lista.</p>
          ) : !patients ? (
            <p className="p-5 text-sm text-gray-400">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">Nenhuma paciente encontrada.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <li key={p.dealId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">{p.name?.trim() || `+${p.phoneNumber}`}</p>
                    <p className="text-xs text-gray-400">{p.stageName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate("/inbox", { state: { contactId: p.contactId } })}
                    className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark"
                  >
                    Ir para a Caixa de Entrada
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
  if (days < 1) {
    const hours = Math.round(days * 24);
    return hours < 1 ? "menos de 1h" : `${hours}h`;
  }
  return `${Math.round(days)} dias`;
}

// One decimal below 10 so a real average like 0.4 doesn't round away to "0".
function formatAvg(value: number): string {
  return value < 10 ? value.toFixed(1).replace(".", ",") : String(Math.round(value));
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
  onClick,
}: {
  label: string;
  value: string;
  icon: IconName;
  tone: keyof typeof tones;
  onClick?: () => void;
}) {
  const t = tones[tone];
  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? "Ver lista" : undefined}
      className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.badge}`}>
          <Icon name={icon} />
        </span>
      </div>
      <p className={`mt-3 text-2xl font-semibold ${t.value}`}>{value}</p>
      {onClick && <p className="mt-1 text-[11px] text-gray-400">Clique para ver a lista</p>}
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

const OLDER_COHORT_LABEL = "2025 ou antes";

function cohortYear(label: string): string {
  return label === OLDER_COHORT_LABEL ? OLDER_COHORT_LABEL : label.split("/")[1];
}

// Newest first, like "Pagamentos recentes"; the catch-all "2025 ou antes" bucket goes last.
function compareCohortsNewestFirst(a: Cohort, b: Cohort): number {
  if (a.label === OLDER_COHORT_LABEL) return 1;
  if (b.label === OLDER_COHORT_LABEL) return -1;
  const [aMonth, aYear] = a.label.split("/");
  const [bMonth, bYear] = b.label.split("/");
  if (aYear !== bYear) return Number(bYear) - Number(aYear);
  return (MONTH_NAMES_PT as readonly string[]).indexOf(bMonth) - (MONTH_NAMES_PT as readonly string[]).indexOf(aMonth);
}

interface CashPayment {
  id: string;
  value: number;
  paidAt: string;
  planType: string | null;
  paymentMethod: string | null;
  contactId: string;
  contactName: string | null;
  phoneNumber: string;
}

interface MonthBucket {
  key: string; // "2026-09", sortable
  year: string;
  label: string;
  total: number;
  payments: CashPayment[];
}

function bucketByMonth(payments: CashPayment[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();
  for (const p of payments) {
    const d = new Date(p.paidAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let b = map.get(key);
    if (!b) {
      b = { key, year: String(d.getFullYear()), label: `${MONTH_NAMES_PT[d.getMonth()]}/${d.getFullYear()}`, total: 0, payments: [] };
      map.set(key, b);
    }
    b.total += p.value;
    b.payments.push(p);
  }
  return [...map.values()];
}

function CashBox() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState<CashPayment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [year, setYear] = useState<string | null>(null); // null = not chosen yet -> newest year
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  // null = untouched: only the newest month is open.
  const [expandedMonths, setExpandedMonths] = useState<Set<string> | null>(null);

  useEffect(() => {
    api
      .get("/dashboard/cash")
      .then((res) => setPayments(res.data))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <Panel title="Caixa" subtitle="Faturamento por mês">
        <p className="text-sm text-red-500">Não foi possível carregar os pagamentos.</p>
      </Panel>
    );
  }
  if (!payments) {
    return (
      <Panel title="Caixa" subtitle="Faturamento por mês">
        <p className="text-sm text-gray-400">Carregando...</p>
      </Panel>
    );
  }

  const years = Array.from(new Set(payments.map((p) => String(new Date(p.paidAt).getFullYear())))).sort().reverse();
  const activeYear = year ?? years[0] ?? "all"; // default: newest year that has payments
  const term = search.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");

  const inScope = payments.filter((p) => {
    if (activeYear !== "all" && String(new Date(p.paidAt).getFullYear()) !== activeYear) return false;
    if (!term) return true;
    return (p.contactName ?? "").toLowerCase().includes(term) || (digits.length > 0 && p.phoneNumber.includes(digits));
  });

  const buckets = bucketByMonth(inScope);
  const chronological = [...buckets].sort((a, b) => a.key.localeCompare(b.key));
  const newestFirst = [...buckets].sort((a, b) => b.key.localeCompare(a.key));
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
  const grandTotal = buckets.reduce((sum, b) => sum + b.total, 0);
  const bestMonth = buckets.reduce<MonthBucket | null>((best, b) => (!best || b.total > best.total ? b : best), null);

  const listBuckets = selectedMonth ? newestFirst.filter((b) => b.key === selectedMonth) : newestFirst;
  const defaultOpen = new Set(newestFirst[0] ? [newestFirst[0].key] : []);
  const isOpen = (b: MonthBucket) => selectedMonth !== null || (expandedMonths ?? defaultOpen).has(b.key);

  function toggleMonth(b: MonthBucket) {
    const next = new Set(expandedMonths ?? defaultOpen);
    if (next.has(b.key)) next.delete(b.key);
    else next.add(b.key);
    setExpandedMonths(next);
  }

  return (
    <Panel title="Caixa" subtitle="Faturamento por mês — toque numa barra para ver só aquele mês">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[...years, "all"].map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => {
              setYear(y);
              setSelectedMonth(null);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activeYear === y ? "bg-brand text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {y === "all" ? "Todos" : y}
          </button>
        ))}
        <div className="ml-auto flex w-full items-center gap-2 rounded-xl border border-gray-200 px-3 py-1.5 sm:w-64">
          <span aria-hidden>🔍</span>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedMonth(null);
            }}
            placeholder="Buscar quem pagou"
            className="w-full text-sm outline-none"
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-[11px] text-gray-500">Total no período</p>
          <p className="text-lg font-semibold text-brand-dark">{currencyFormatter.format(grandTotal)}</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-[11px] text-gray-500">Pagamentos</p>
          <p className="text-lg font-semibold text-gray-800">{inScope.length}</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-[11px] text-gray-500">Mês que mais vendeu</p>
          <p className="text-lg font-semibold text-gray-800">{bestMonth ? bestMonth.label : "—"}</p>
          {bestMonth && <p className="text-[11px] text-gray-400">{currencyFormatter.format(bestMonth.total)}</p>}
        </div>
      </div>

      {chronological.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">Nenhum pagamento encontrado.</p>
      ) : (
        <>
          <div className="overflow-x-auto pb-2">
            <div className="flex h-44 items-end gap-2" style={{ minWidth: chronological.length * 64 }}>
              {chronological.map((b) => {
                const selected = selectedMonth === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setSelectedMonth(selected ? null : b.key)}
                    title={`${b.label}: ${currencyFormatter.format(b.total)} (${b.payments.length} pagamentos)`}
                    className="flex h-full w-14 shrink-0 flex-col items-center justify-end gap-1"
                  >
                    <span className="text-[10px] font-medium text-gray-600">{currencyFormatter.format(b.total).replace("R$", "").trim()}</span>
                    <span
                      className={`w-full rounded-t-md ${selected ? "bg-brand-dark" : "bg-brand"} ${
                        selectedMonth && !selected ? "opacity-40" : ""
                      }`}
                      style={{ height: `${Math.max(4, Math.round((b.total / maxTotal) * 100))}px` }}
                    />
                    <span className="text-[10px] text-gray-500">
                      {b.label.slice(0, 3)}/{b.year.slice(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {listBuckets.map((b) => {
              const open = isOpen(b);
              return (
                <div key={b.key} className="rounded-xl border border-gray-100">
                  <button
                    type="button"
                    onClick={() => toggleMonth(b)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left"
                  >
                    <span className="text-sm font-medium text-gray-800">
                      {open ? "▾" : "▸"} {b.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {b.payments.length} pagamento{b.payments.length === 1 ? "" : "s"} ·{" "}
                      <span className="font-semibold text-brand-dark">{currencyFormatter.format(b.total)}</span>
                    </span>
                  </button>
                  {open && (
                    <ul className="divide-y divide-gray-50 border-t border-gray-100">
                      {b.payments.map((p) => {
                        const name = p.contactName?.trim() || `+${p.phoneNumber}`;
                        const plan = p.planType ? PLAN_TYPE_LABELS[p.planType as PlanType] ?? p.planType : null;
                        const method = p.paymentMethod ? PAYMENT_METHOD_LABELS[p.paymentMethod as PaymentMethod] ?? p.paymentMethod : null;
                        return (
                          <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => navigate("/inbox", { state: { contactId: p.contactId } })}
                                className="truncate text-left text-sm font-medium text-gray-800 hover:text-brand-dark hover:underline"
                                title="Ir para a Caixa de Entrada"
                              >
                                {name}
                              </button>
                              <p className="text-xs text-gray-400">
                                {dateFormatter.format(new Date(p.paidAt))}
                                {plan ? ` · ${plan}` : ""}
                                {method ? ` · ${method}` : ""}
                              </p>
                            </div>
                            <span className="shrink-0 text-sm font-medium text-brand-dark">{currencyFormatter.format(p.value)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCohort, setExpandedCohort] = useState<string | null>(null);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [patientsModal, setPatientsModal] = useState<PatientRole | null>(null);
  const [yearFilter, setYearFilter] = useState<string>("all");

  useEffect(() => {
    api
      .get("/dashboard/summary")
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm text-gray-500">Carregando dashboard...</div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">Não foi possível carregar o dashboard.</div>;

  const kpis: { label: string; value: string; icon: IconName; tone: keyof typeof tones; onClick?: () => void }[] = [
    { label: "Pacientes Ativos", value: String(data.patients.active), icon: "users", tone: "emerald", onClick: () => setPatientsModal("ACTIVE_PATIENT") },
    { label: "Pacientes Vencidas", value: String(data.patients.vencida), icon: "alert", tone: "red", onClick: () => setPatientsModal("LOST_PATIENT") },
    { label: "Tempo médio de resposta", value: formatSeconds(data.avgResponseSeconds), icon: "clock", tone: "brand" },
    {
      label: "Tempo médio até 1º pagamento",
      value: formatDays(data.avgDaysToFirstPayment),
      icon: "calendar",
      tone: "brand",
    },
  ];

  const sortedCohorts = [...data.cohorts].sort(compareCohortsNewestFirst);
  const cohortYears = Array.from(new Set(sortedCohorts.map((c) => cohortYear(c.label))));
  // A year that no longer exists in the data (e.g. after a refresh) falls back to showing all.
  const visibleCohorts =
    yearFilter === "all" || !cohortYears.includes(yearFilter)
      ? sortedCohorts
      : sortedCohorts.filter((c) => cohortYear(c.label) === yearFilter);

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

        <Panel title="Mensagens até o 1º pagamento" subtitle="Média por paciente com histórico de conversa no CRM">
          {data.avgMessagesToFirstPayment ? (
            <div className="flex gap-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Icon name="chat" />
                </span>
                <div>
                  <p className="text-xs text-gray-500">Recebidas</p>
                  <p className="text-xl font-semibold text-gray-800">{formatAvg(data.avgMessagesToFirstPayment.inbound)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500">Enviadas</p>
                <p className="text-xl font-semibold text-gray-800">{formatAvg(data.avgMessagesToFirstPayment.outbound)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-xl font-semibold text-brand-dark">{formatAvg(data.avgMessagesToFirstPayment.total)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Nenhum pagamento com histórico de mensagens ainda.</p>
          )}
          {data.funnel && (
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
              <div>
                <p className="text-xs text-gray-500">Conversão das conversas</p>
                <p className="text-xl font-semibold text-emerald-600">
                  {data.funnel.conversionRate == null ? "—" : `${(data.funnel.conversionRate * 100).toFixed(1)}%`}
                </p>
                <p className="text-[11px] text-gray-400">
                  {data.funnel.converted} de {data.funnel.contacted} · {data.funnel.outboundTotal} msgs enviadas
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Enviadas até desistir</p>
                <p className="text-xl font-semibold text-red-500">
                  {data.funnel.avgOutboundUntilGiveUp == null ? "—" : formatAvg(data.funnel.avgOutboundUntilGiveUp)}
                </p>
                <p className="text-[11px] text-gray-400">média de {data.funnel.gaveUp} desistências</p>
              </div>
              {data.funnel.paidWithoutHistory > 0 && (
                <p className="col-span-2 text-[11px] text-gray-400">
                  {data.funnel.paidWithoutHistory} pacientes com pagamento importado, sem histórico de mensagens, ficam fora
                  destas médias.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">

        <Panel title="Cohort por mês de chegada" subtitle="Toque na lupa para ver a origem dos leads">
          {data.cohorts.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {["all", ...cohortYears].map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYearFilter(y)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    yearFilter === y ? "bg-brand text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {y === "all" ? "Todos" : y}
                </button>
              ))}
            </div>
          )}
          {data.cohorts.length === 0 ? (
            <p className="text-sm text-gray-400">Sem contatos registrados ainda.</p>
          ) : (
            <div className="space-y-4">
              {visibleCohorts.map((c) => {
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
      {patientsModal && <PatientsModal role={patientsModal} onClose={() => setPatientsModal(null)} />}
    </div>
  );
}
