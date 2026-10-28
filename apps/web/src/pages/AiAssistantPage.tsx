import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { api } from "../lib/api";

interface AiPlan {
  id: string;
  name: string;
  price: number;
  description: string;
  link: string | null;
  order: number;
}

interface SimTurn {
  role: "customer" | "assistant";
  text: string;
  // Only on assistant turns produced by the simulator.
  handoff?: boolean;
  handoffReason?: string;
  costUsd?: number;
  cacheReadTokens?: number;
}

function errorCode(err: unknown) {
  return axios.isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined;
}

function describeAiError(code: string | undefined) {
  switch (code) {
    case "anthropic_api_key_missing":
      return "Configure a chave da Anthropic antes de testar.";
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
      setTurns([
        ...next,
        {
          role: "assistant",
          text: res.data.reply,
          handoff: res.data.handoff,
          handoffReason: res.data.handoffReason,
          costUsd: res.data.estimatedCostUsd,
          cacheReadTokens: res.data.usage.cacheReadTokens,
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
            }}
            disabled={waiting}
            className="text-xs text-gray-500 hover:underline"
          >
            Nova conversa
          </button>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-4 py-3">
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
                <p className="text-[11px] text-gray-500">
                  ≈ US$ {turn.costUsd.toFixed(4)}
                  {turn.cacheReadTokens ? " · prompt em cache" : ""}
                </p>
              )}
            </div>
          ),
        )}
        {waiting && <p className="text-right text-xs text-gray-500">IA digitando…</p>}
        <div ref={bottomRef} />
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
  const [loaded, setLoaded] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [plans, setPlans] = useState<AiPlan[]>([]);

  useEffect(() => {
    api.get("/ai-assistant").then((res) => {
      setHasKey(res.data.hasApiKey);
      setPrompt(res.data.prompt);
      setPlans(res.data.plans);
      setLoaded(true);
    });
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Inteligência Artificial</h1>
      <p className="mb-6 max-w-3xl text-sm text-gray-500">
        Configure a assistente que vai responder o WhatsApp e teste no simulador. Por enquanto ela{" "}
        <span className="font-medium text-gray-700">não responde nenhum paciente de verdade</span> — isso só acontece
        quando o modo automático for ativado, numa próxima etapa.
      </p>

      {!loaded ? (
        <p className="text-sm text-gray-400">Carregando...</p>
      ) : (
        <div className="grid max-w-6xl gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <ApiKeyCard hasKey={hasKey} onChange={setHasKey} />
            <PromptCard initialPrompt={prompt} />
            <PlansCard plans={plans} onChange={setPlans} />
          </div>
          <Simulator />
        </div>
      )}
    </div>
  );
}
