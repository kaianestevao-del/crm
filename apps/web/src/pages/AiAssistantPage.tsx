import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { ORIGIN_TAGS_PT } from "@crm/shared";
import { api } from "../lib/api";

interface AiPlan {
  id: string;
  name: string;
  price: number;
  description: string;
  link: string | null;
  order: number;
}

interface AiLink {
  id: string;
  title: string;
  url: string;
  whenToUse: string;
  order: number;
}

interface AiKeyword {
  id: string;
  phrase: string;
  origin: string | null;
}

interface StageOption {
  id: string;
  name: string;
  pipelineName: string;
}

interface AiSettings {
  hasApiKey: boolean;
  prompt: string;
  enabled: boolean;
  schedulingUrl: string | null;
  schedulingEnabled: boolean;
  stageStartId: string | null;
  stageQualifyingId: string | null;
  stageNegotiationId: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  inicio: "Início Atendimento",
  qualificando: "Qualificando",
  negociacao: "Negociação",
};

interface SimTurn {
  role: "customer" | "assistant";
  text: string;
  // Only on assistant turns produced by the simulator.
  handoff?: boolean;
  handoffReason?: string;
  costUsd?: number;
  cacheReadTokens?: number;
  stage?: string;
  objective?: string;
}

function errorCode(err: unknown) {
  return axios.isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined;
}

function describeAiError(code: string | undefined) {
  switch (code) {
    case "anthropic_api_key_missing":
      return "Configure a chave da Anthropic antes.";
    case "scheduling_url_missing":
      return "Cole o link de agendamento antes de ativar.";
    case "anthropic_api_key_invalid":
      return "A Anthropic recusou a chave — confira se ela foi copiada inteira e está ativa.";
    case "anthropic_rate_limited":
      return "Limite de uso da Anthropic atingido — espere um pouco e tente de novo.";
    case "anthropic_reply_invalid":
    case "anthropic_reply_truncated":
      return "A IA devolveu uma resposta incompleta — tente de novo.";
    case "anthropic_request_failed":
      return "A Anthropic não respondeu — tente de novo em instantes.";
    default:
      return "Não foi possível gerar a resposta.";
  }
}

function money(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const inputClass =
  "w-full rounded-xl border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none";
const primaryButtonClass =
  "rounded-xl bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-brand-dark" : "bg-gray-300"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function StatusCard({ settings, onChange }: { settings: AiSettings; onChange: (s: AiSettings) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch("/ai-assistant", { enabled: !settings.enabled });
      onChange({ ...settings, ...res.data });
    } catch (err) {
      setError(describeAiError(errorCode(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`max-w-6xl rounded-2xl border p-4 shadow-sm ${settings.enabled ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{settings.enabled ? "🟢 IA ligada — respondendo o WhatsApp" : "⚪ IA desligada"}</p>
          <p className="mt-0.5 text-xs text-gray-600">
            Ligada, a IA responde só as conversas que começarem com uma palavra-chave (ou ligadas pelo botão na conversa) e
            as pacientes vencidas que escreverem. Ela espera 1 minuto depois da última mensagem, para quando alguém da equipe
            responder, nunca fala com Paciente Ativa e transfere para a equipe quando não souber.
          </p>
        </div>
        <Toggle on={settings.enabled} onClick={toggle} disabled={saving} />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function SchedulingCard({ settings, onChange }: { settings: AiSettings; onChange: (s: AiSettings) => void }) {
  const [url, setUrl] = useState(settings.schedulingUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = url.trim() !== (settings.schedulingUrl ?? "");

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch("/ai-assistant", body);
      onChange({ ...settings, ...res.data });
      setUrl(res.data.schedulingUrl ?? "");
    } catch (err) {
      const code = errorCode(err);
      setError(code === "validation_error" ? "Confira o link — ele precisa começar com https://" : describeAiError(code));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Link de agendamento da pré-consulta</p>
        <Toggle
          on={settings.schedulingEnabled}
          onClick={() => patch({ schedulingEnabled: !settings.schedulingEnabled })}
          disabled={saving || !settings.schedulingUrl}
        />
      </div>
      <p className="mb-3 text-xs text-gray-500">
        A IA envia este link só depois que a paciente confirmar que respondeu o questionário. Desativado (ou sem link), ela
        pergunta se prefere manhã ou tarde e passa para a equipe agendar.
      </p>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className={inputClass} />
        <button onClick={() => patch({ schedulingUrl: url.trim() })} disabled={saving || !dirty} className={primaryButtonClass}>
          Salvar
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function StagesCard({
  settings,
  stages,
  onChange,
}: {
  settings: AiSettings;
  stages: StageOption[];
  onChange: (s: AiSettings) => void;
}) {
  const fields = [
    { key: "stageStartId", label: "Início Atendimento" },
    { key: "stageQualifyingId", label: "Qualificando" },
    { key: "stageNegotiationId", label: "Negociação" },
  ] as const;
  const multiplePipelines = new Set(stages.map((s) => s.pipelineName)).size > 1;

  async function change(key: (typeof fields)[number]["key"], value: string) {
    const res = await api.patch("/ai-assistant", { [key]: value || null });
    onChange({ ...settings, ...res.data });
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-sm font-medium">Etapas do Kanban</p>
      <p className="mb-3 text-xs text-gray-500">
        A IA move o card da paciente por estas etapas conforme a conversa avança (só para frente), e cria o card se ela
        ainda não tiver. Cards em qualquer outra etapa não são mexidos.
      </p>
      <div className="space-y-2">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-700">{f.label}</span>
            <select
              value={settings[f.key] ?? ""}
              onChange={(e) => change(f.key, e.target.value)}
              className="w-56 rounded-xl border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">Não mover</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {multiplePipelines ? `${s.pipelineName} · ${s.name}` : s.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function ApiKeyCard({ hasKey, onChange }: { hasKey: boolean; onChange: (hasKey: boolean) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(value: string | null) {
    setSaving(true);
    try {
      const res = await api.patch("/ai-assistant", { anthropicApiKey: value });
      onChange(res.data.hasApiKey);
      setApiKey("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-sm font-medium">Chave da Anthropic (Claude)</p>
      <p className="mb-3 text-xs text-gray-500">
        {hasKey ? "✅ Chave configurada." : "Sem chave configurada — a IA não responde."} Crie em{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-brand-dark underline">
          console.anthropic.com
        </a>
        . O uso é cobrado pela Anthropic direto no seu cartão.
      </p>
      <div className="flex gap-2">
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? "Insira uma nova chave para substituir" : "sk-ant-..."}
          className={inputClass}
        />
        <button onClick={() => save(apiKey.trim())} disabled={saving || !apiKey.trim()} className={primaryButtonClass}>
          Salvar
        </button>
      </div>
      {hasKey && (
        <button onClick={() => save(null)} disabled={saving} className="mt-2 text-xs text-red-600 hover:underline">
          Remover chave
        </button>
      )}
    </div>
  );
}

function PromptCard({ initialPrompt }: { initialPrompt: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [saving, setSaving] = useState(false);
  const dirty = prompt !== savedPrompt;

  async function save() {
    setSaving(true);
    try {
      const res = await api.patch("/ai-assistant", { prompt });
      setSavedPrompt(res.data.prompt);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-sm font-medium">Instruções da IA</p>
      <p className="mb-3 text-xs text-gray-500">
        Como a IA deve se apresentar, o tom, como funciona o atendimento, perguntas frequentes e quando chamar você. As
        regras de segurança (não inventar preço, não dar orientação de saúde, transferir quando não souber) já vêm
        fixas — não precisa repetir.
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={12}
        placeholder={
          "Ex.: Você é a Ana, assistente da nutricionista Kaian. As consultas são online, pelo Google Meet, com retorno em 30 dias. Quando a pessoa quiser agendar, envie o link do plano escolhido..."
        }
        className={`${inputClass} font-mono text-[13px] leading-relaxed`}
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={save} disabled={saving || !dirty} className={primaryButtonClass}>
          Salvar instruções
        </button>
        {dirty ? (
          <span className="text-xs text-amber-600">Não salvo — o simulador usa a versão salva.</span>
        ) : (
          savedPrompt && <span className="text-xs text-emerald-600">Salvo ✓</span>
        )}
      </div>
    </div>
  );
}

function KeywordsCard({ keywords, onChange }: { keywords: AiKeyword[]; onChange: (k: AiKeyword[]) => void }) {
  const [phrase, setPhrase] = useState("");
  const [origin, setOrigin] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    setSaving(true);
    try {
      const res = await api.post("/ai-assistant/keywords", { phrase: phrase.trim(), origin: origin || null });
      onChange([...keywords, res.data]);
      setPhrase("");
      setOrigin("");
    } finally {
      setSaving(false);
    }
  }

  async function changeOrigin(keyword: AiKeyword, value: string) {
    const res = await api.patch(`/ai-assistant/keywords/${keyword.id}`, { origin: value || null });
    onChange(keywords.map((k) => (k.id === keyword.id ? res.data : k)));
  }

  async function remove(keyword: AiKeyword) {
    await api.delete(`/ai-assistant/keywords/${keyword.id}`);
    onChange(keywords.filter((k) => k.id !== keyword.id));
  }

  const originSelect = (value: string, onSelect: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => onSelect(e.target.value)}
      className="w-44 shrink-0 rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
    >
      <option value="">Sem origem</option>
      {ORIGIN_TAGS_PT.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-sm font-medium">Palavras-chave de ativação</p>
      <p className="mb-3 text-xs text-gray-500">
        A IA só assume uma conversa se a mensagem da pessoa tiver uma destas frases (sem diferenciar maiúsculas ou acentos).
        Use as mensagens prontas dos seus links de bio, stories e anúncios. A origem vira etiqueta no contato.
      </p>
      <div className="space-y-2">
        {keywords.map((k) => (
          <div key={k.id} className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2">
            <p className="min-w-0 flex-1 text-sm text-gray-800">{k.phrase}</p>
            {originSelect(k.origin ?? "", (v) => changeOrigin(k, v))}
            <button onClick={() => remove(k)} className="shrink-0 text-xs text-red-600 hover:underline">
              Excluir
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Ex.: Quero começar a consultoria"
          className={inputClass}
        />
        {originSelect(origin, setOrigin)}
        <button onClick={add} disabled={saving || !phrase.trim()} className={primaryButtonClass}>
          Adicionar
        </button>
      </div>
    </div>
  );
}

const emptyLinkForm = { title: "", url: "", whenToUse: "" };

function LinksCard({ links, onChange }: { links: AiLink[]; onChange: (links: AiLink[]) => void }) {
  const [form, setForm] = useState(emptyLinkForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(link: AiLink | null) {
    setForm(link ? { title: link.title, url: link.url, whenToUse: link.whenToUse } : emptyLinkForm);
    setEditingId(link?.id ?? null);
    setError(null);
    setShowForm(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const res = await api.patch(`/ai-assistant/links/${editingId}`, form);
        onChange(links.map((l) => (l.id === editingId ? res.data : l)));
      } else {
        const res = await api.post("/ai-assistant/links", form);
        onChange([...links, res.data]);
      }
      setShowForm(false);
    } catch (err) {
      setError(errorCode(err) === "validation_error" ? "Confira o link — ele precisa começar com https://" : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(link: AiLink) {
    await api.delete(`/ai-assistant/links/${link.id}`);
    onChange(links.filter((l) => l.id !== link.id));
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium">Links</p>
        {!showForm && (
          <button onClick={() => open(null)} className="text-xs font-medium text-brand-dark hover:underline">
            + Adicionar link
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Questionário da pré-consulta, pagamento... A IA só envia links desta lista (e o de agendamento, abaixo), no momento que você descrever.
      </p>

      {links.length === 0 && !showForm && <p className="text-sm text-gray-400">Nenhum link cadastrado.</p>}
      <div className="space-y-2">
        {links.map((link) => (
          <div key={link.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-gray-800">{link.title}</p>
              <p className="truncate text-xs text-brand-dark">{link.url}</p>
              {link.whenToUse && <p className="whitespace-pre-line text-xs text-gray-500">Quando enviar: {link.whenToUse}</p>}
            </div>
            <div className="flex shrink-0 gap-3 text-xs">
              <button onClick={() => open(link)} className="text-gray-500 hover:underline">
                Editar
              </button>
              <button onClick={() => remove(link)} className="text-red-600 hover:underline">
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="mt-3 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Nome (ex.: Questionário da pré-consulta)"
            className={inputClass}
          />
          <input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://..."
            className={inputClass}
          />
          <textarea
            value={form.whenToUse}
            onChange={(e) => setForm({ ...form, whenToUse: e.target.value })}
            rows={2}
            placeholder="Quando enviar (ex.: quando a paciente escolher a consultoria premium)"
            className={inputClass}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-xl px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || !form.title.trim() || !form.url.trim()}
              className={primaryButtonClass}
            >
              {editingId ? "Salvar" : "Adicionar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const emptyPlanForm = { name: "", price: "", description: "", link: "" };

function PlansCard({ plans, onChange }: { plans: AiPlan[]; onChange: (plans: AiPlan[]) => void }) {
  const [form, setForm] = useState(emptyPlanForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  function openNew() {
    setForm(emptyPlanForm);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(plan: AiPlan) {
    setForm({ name: plan.name, price: String(plan.price), description: plan.description, link: plan.link ?? "" });
    setEditingId(plan.id);
    setShowForm(true);
  }

  const price = Number(form.price.replace(",", "."));
  const valid = form.name.trim() && form.price.trim() && Number.isFinite(price) && price >= 0;

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      const body = { name: form.name, price, description: form.description, link: form.link.trim() || null };
      if (editingId) {
        const res = await api.patch(`/ai-assistant/plans/${editingId}`, body);
        onChange(plans.map((p) => (p.id === editingId ? res.data : p)));
      } else {
        const res = await api.post("/ai-assistant/plans", body);
        onChange([...plans, res.data]);
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function remove(plan: AiPlan) {
    await api.delete(`/ai-assistant/plans/${plan.id}`);
    onChange(plans.filter((p) => p.id !== plan.id));
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium">Planos e valores</p>
        {!showForm && (
          <button onClick={openNew} className="text-xs font-medium text-brand-dark hover:underline">
            + Adicionar plano
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">A IA só informa valores que estão nesta lista.</p>

      {plans.length === 0 && !showForm && <p className="text-sm text-gray-400">Nenhum plano cadastrado.</p>}
      <div className="space-y-2">
        {plans.map((plan) => (
          <div key={plan.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-gray-800">
                {plan.name} · <span className="font-medium">{money(plan.price)}</span>
              </p>
              {plan.description && <p className="whitespace-pre-line text-xs text-gray-500">{plan.description}</p>}
              {plan.link && <p className="truncate text-xs text-brand-dark">{plan.link}</p>}
            </div>
            <div className="flex shrink-0 gap-3 text-xs">
              <button onClick={() => openEdit(plan)} className="text-gray-500 hover:underline">
                Editar
              </button>
              <button onClick={() => remove(plan)} className="text-red-600 hover:underline">
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="mt-3 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nome do plano"
              className={inputClass}
            />
            <input
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="Valor (R$)"
              inputMode="decimal"
              className={`${inputClass} w-32`}
            />
          </div>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="O que inclui (consultas, retornos, duração, forma de pagamento...)"
            className={inputClass}
          />
          <input
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
            placeholder="Link de pagamento ou agendamento (opcional)"
            className={inputClass}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-xl px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
              Cancelar
            </button>
            <button onClick={save} disabled={saving || !valid} className={primaryButtonClass}>
              {editingId ? "Salvar" : "Adicionar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Plays the patient: whatever is typed here goes to the AI with the *saved* prompt and plans,
// exactly as a WhatsApp message would — but nothing touches WhatsApp.
function Simulator() {
  const [turns, setTurns] = useState<SimTurn[]>([]);
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the conversation's first message has an activation phrase — known after the first reply.
  const [activated, setActivated] = useState<boolean | null>(null);
  // Scrolls only the chat box — scrollIntoView would also scroll the whole page down.
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chat = chatRef.current;
    if (chat) chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
  }, [turns, waiting]);

  async function send() {
    const message = text.trim();
    if (!message || waiting) return;
    const next = [...turns, { role: "customer" as const, text: message }];
    setTurns(next);
    setText("");
    setError(null);
    setWaiting(true);
    try {
      const res = await api.post("/ai-assistant/simulate", {
        // A refused reply comes back empty — there's nothing the customer saw, so leave it out.
        turns: next.filter((t) => t.text).map((t) => ({ role: t.role, text: t.text })),
      });
      setActivated(res.data.activated);
      setTurns([
        ...next,
        {
          role: "assistant",
          text: res.data.reply,
          handoff: res.data.handoff,
          handoffReason: res.data.handoffReason,
          costUsd: res.data.estimatedCostUsd,
          cacheReadTokens: res.data.usage.cacheReadTokens,
          stage: res.data.stage,
          objective: res.data.objective,
        },
      ]);
    } catch (err) {
      setError(describeAiError(errorCode(err)));
    } finally {
      setWaiting(false);
    }
  }

  const totalCost = turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

  return (
    <div className="flex h-[640px] flex-col rounded-2xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-0">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Simulador</p>
          <p className="text-xs text-gray-500">Escreva como se fosse o paciente. Nada é enviado ao WhatsApp.</p>
        </div>
        {turns.length > 0 && (
          <button
            onClick={() => {
              setTurns([]);
              setError(null);
              setActivated(null);
            }}
            disabled={waiting}
            className="text-xs text-gray-500 hover:underline"
          >
            Nova conversa
          </button>
        )}
      </div>

      {activated === false && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          A primeira mensagem não tem nenhuma palavra-chave de ativação. No WhatsApp de verdade, a IA não assumiria
          esta conversa.
        </p>
      )}
      <div ref={chatRef} className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-4 py-3">
        {turns.length === 0 && (
          <p className="mt-8 text-center text-xs text-gray-500">Mande uma mensagem para ver como a IA responde.</p>
        )}
        {turns.map((turn, i) =>
          turn.role === "customer" ? (
            <div key={i} className="flex justify-start">
              <p className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-white px-3 py-2 text-sm text-gray-800 shadow-sm">
                {turn.text}
              </p>
            </div>
          ) : (
            <div key={i} className="flex flex-col items-end gap-1">
              {turn.text && (
                <p className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-[#d9fdd3] px-3 py-2 text-sm text-gray-800 shadow-sm">
                  {turn.text}
                </p>
              )}
              {turn.handoff && (
                <p className="max-w-[80%] rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-800">
                  ⚠️ Transferiu para humano{turn.handoffReason ? `: ${turn.handoffReason}` : ""}
                </p>
              )}
              {turn.costUsd !== undefined && (
                <p className="text-right text-[11px] text-gray-500">
                  {turn.stage && `Kanban: ${STAGE_LABELS[turn.stage] ?? turn.stage}`}
                  {turn.objective && ` · Objetivo: ${turn.objective}`}
                  <br />≈ US$ {turn.costUsd.toFixed(4)}
                  {turn.cacheReadTokens ? " · prompt em cache" : ""}
                </p>
              )}
            </div>
          ),
        )}
        {waiting && <p className="text-right text-xs text-gray-500">IA digitando…</p>}
      </div>

      {error && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
      <div className="flex gap-2 border-t border-gray-100 p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Mensagem do paciente…"
          className={`${inputClass} resize-none`}
        />
        <button onClick={send} disabled={waiting || !text.trim()} className={primaryButtonClass}>
          Enviar
        </button>
      </div>
      {totalCost > 0 && (
        <p className="px-4 pb-2 text-right text-[11px] text-gray-400">Total desta conversa ≈ US$ {totalCost.toFixed(4)}</p>
      )}
    </div>
  );
}

export function AiAssistantPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [plans, setPlans] = useState<AiPlan[]>([]);
  const [keywords, setKeywords] = useState<AiKeyword[]>([]);
  const [links, setLinks] = useState<AiLink[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);

  useEffect(() => {
    api.get("/ai-assistant").then((res) => {
      const { plans, links, keywords, stages, ...rest } = res.data;
      setSettings(rest);
      setPlans(plans);
      setKeywords(keywords);
      setLinks(links);
      setStages(stages);
    });
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Inteligência Artificial</h1>
      <p className="mb-4 max-w-3xl text-sm text-gray-500">
        Configure a assistente que responde o WhatsApp e teste no simulador antes de ligar.
      </p>

      {!settings ? (
        <p className="text-sm text-gray-400">Carregando...</p>
      ) : (
        <>
          <div className="mb-6">
            <StatusCard settings={settings} onChange={setSettings} />
          </div>
          <div className="grid max-w-6xl gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <ApiKeyCard hasKey={settings.hasApiKey} onChange={(hasApiKey) => setSettings({ ...settings, hasApiKey })} />
              <PromptCard initialPrompt={settings.prompt} />
              <KeywordsCard keywords={keywords} onChange={setKeywords} />
              <PlansCard plans={plans} onChange={setPlans} />
              <LinksCard links={links} onChange={setLinks} />
              <SchedulingCard settings={settings} onChange={setSettings} />
              <StagesCard settings={settings} stages={stages} onChange={setSettings} />
            </div>
            <Simulator />
          </div>
        </>
      )}
    </div>
  );
}
