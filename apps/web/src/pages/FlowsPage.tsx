import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { api } from "../lib/api";

interface FlowSummary {
  id: string;
  name: string;
  active: boolean;
  triggerKeywords: string[];
  updatedAt: string;
  activeRuns: number;
  totalRuns: number;
}

export const FLOW_ERRORS: Record<string, string> = {
  flow_needs_a_keyword: "Para ligar o fluxo, coloque pelo menos uma palavra-chave no gatilho.",
  flow_trigger_not_connected: "Para ligar o fluxo, ligue o gatilho a um bloco.",
  flow_needs_exactly_one_trigger: "O fluxo precisa ter exatamente um gatilho.",
  buttons_must_be_the_last_item_of_a_block: "Os botões precisam ser o último item do bloco.",
};

export function flowErrorMessage(err: unknown) {
  if (!axios.isAxiosError(err)) return "Não foi possível salvar. Tente de novo.";
  const data = err.response?.data as { error?: string; details?: { formErrors?: string[] } } | undefined;
  // Graph-wide rules come back inside a validation error's formErrors.
  const code = data?.details?.formErrors?.find((c) => FLOW_ERRORS[c]) ?? data?.error;
  if (code && FLOW_ERRORS[code]) return FLOW_ERRORS[code];
  if (data?.error === "validation_error") {
    return "Algum bloco tem um campo inválido: texto vazio, botão com mais de 20 letras ou link sem https://.";
  }
  return "Não foi possível salvar. Tente de novo.";
}

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

export function FlowsPage() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function load() {
    api
      .get("/flows")
      .then((res) => setFlows(res.data.items))
      .catch(() => setError("Não foi possível carregar os fluxos."));
  }
  useEffect(load, []);

  async function create() {
    if (!name.trim()) return;
    const res = await api.post("/flows", { name: name.trim() });
    navigate(`/funil/${res.data.id}`);
  }

  async function toggle(flow: FlowSummary) {
    setError(null);
    try {
      await api.patch(`/flows/${flow.id}`, { active: !flow.active });
      load();
    } catch (err) {
      setError(flowErrorMessage(err));
    }
  }

  async function remove(flow: FlowSummary) {
    await api.delete(`/flows/${flow.id}`);
    setConfirmDelete(null);
    load();
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Funil</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Fluxos automáticos de conversa: quando a mensagem tem uma palavra-chave, o fluxo envia as mensagens, espera as
        respostas e segue pelo caminho que ela escolher. Enquanto ela estiver num fluxo, a IA não responde; se alguém da
        equipe responder pela Caixa de Entrada, o fluxo para.
      </p>

      <div className="max-w-3xl space-y-4">
        <div className="flex gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Nome do novo fluxo (ex.: Desafio 7.0)"
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <button
            onClick={create}
            disabled={!name.trim()}
            className="whitespace-nowrap rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Criar fluxo
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!flows && !error && <p className="text-sm text-gray-500">Carregando...</p>}
        {flows?.length === 0 && <p className="text-sm text-gray-500">Nenhum fluxo ainda.</p>}

        {flows?.map((flow) => (
          <div key={flow.id} className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <Toggle on={flow.active} onClick={() => toggle(flow)} />
            <div className="min-w-0 flex-1">
              <Link to={`/funil/${flow.id}`} className="font-medium text-gray-900 hover:underline">
                {flow.name}
              </Link>
              <p className="truncate text-xs text-gray-500">
                {flow.triggerKeywords.length ? `Gatilho: ${flow.triggerKeywords.join(" · ")}` : "Sem palavra-chave"}
              </p>
            </div>
            <div className="text-right text-xs text-gray-500">
              <p>{flow.activeRuns} no fluxo agora</p>
              <p>{flow.totalRuns} no total</p>
            </div>
            <Link to={`/funil/${flow.id}`} className="text-xs font-medium text-brand-dark hover:underline">
              Editar
            </Link>
            {confirmDelete === flow.id ? (
              <span className="flex gap-2 text-xs">
                <button onClick={() => remove(flow)} className="font-medium text-red-600 hover:underline">
                  Excluir mesmo
                </button>
                <button onClick={() => setConfirmDelete(null)} className="text-gray-500 hover:underline">
                  Cancelar
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmDelete(flow.id)} className="text-xs text-gray-400 hover:text-red-600">
                Excluir
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
