import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FLOW_BUTTON_LABEL_MAX,
  FLOW_MAX_BUTTONS,
  type FlowAction,
  type FlowGraph,
  type FlowItem,
  type FlowNode,
  type FlowNodeStats,
  type FlowStats,
  type FlowWaitUnit,
} from "@crm/shared";
import { api, API_URL } from "../lib/api";
import { flowErrorMessage } from "./FlowsPage";

type TriggerData = Extract<FlowNode, { type: "trigger" }>["data"];
type MessageData = Extract<FlowNode, { type: "message" }>["data"];
type ActionData = Extract<FlowNode, { type: "action" }>["data"];
type EditorNode = Node<TriggerData, "trigger"> | Node<MessageData, "message"> | Node<ActionData, "action">;

interface StageOption {
  id: string;
  name: string;
  pipelineName: string;
}

const UNIT_LABELS: Record<FlowWaitUnit, string> = { seconds: "seg", minutes: "min", hours: "h", days: "dias" };
const SAVE_TO_LABELS = { name: "Nome do contato", objective: "Objetivo do contato", note: "Nota no contato", none: "Não salvar" };
const MEDIA_LABELS = { IMAGE: "Imagem", VIDEO: "Vídeo", AUDIO: "Áudio", DOCUMENT: "Documento" };

function newId() {
  return crypto.randomUUID().slice(0, 8);
}

const inputClass = "w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";
const handleClass = "!h-3 !w-3 !border-2 !border-white !bg-gray-500";

// --- Numbers (📊) --------------------------------------------------------------------------

// Set while the editor shows numbers; the blocks read it instead of carrying it in their data
// (which is what gets saved).
const FlowStatsContext = createContext<FlowStats | null>(null);

function useNodeStats(nodeId: string): FlowNodeStats | null {
  const stats = useContext(FlowStatsContext);
  if (!stats) return null;
  return stats.nodes[nodeId] ?? { entered: 0, delivered: 0, read: 0, failed: 0, answered: 0, noReply: 0, buttons: {} };
}

function pct(n: number, of: number) {
  return of ? `${Math.round((n / of) * 100)}%` : "–";
}

function StatCell({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex-1 text-center">
      <p className="text-sm font-semibold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

function StatBadge({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">{children}</span>;
}

// --- Blocks as drawn on the canvas ---------------------------------------------------------

function BlockShell({
  title,
  color,
  selected,
  stats,
  children,
}: {
  title: string;
  color: string;
  selected: boolean;
  stats?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`w-64 rounded-2xl border bg-white text-xs shadow-sm ${selected ? "border-brand ring-2 ring-brand/30" : "border-gray-200"}`}>
      <div className={`rounded-t-2xl px-3 py-2 font-semibold ${color}`}>{title}</div>
      {stats && <div className="flex gap-1 border-b border-sky-100 bg-sky-50/60 px-2 py-1.5">{stats}</div>}
      <div className="space-y-1.5 p-3">{children}</div>
    </div>
  );
}

function OutputRow({ label, handleId, tone = "text-gray-500" }: { label: string; handleId: string; tone?: string }) {
  return (
    <div className={`relative pr-2 text-right text-[11px] ${tone}`}>
      {label}
      <Handle type="source" position={Position.Right} id={handleId} className={handleClass} style={{ right: -18 }} />
    </div>
  );
}

function TriggerBlock({ data, selected }: NodeProps<Node<TriggerData, "trigger">>) {
  const flowStats = useContext(FlowStatsContext);
  return (
    <BlockShell
      title="⚡ Quando a mensagem contém…"
      color="bg-amber-50 text-amber-800"
      selected={!!selected}
      stats={
        flowStats && (
          <>
            <StatCell label="Disparos" value={flowStats.runs.total} />
            <StatCell label="Contatos únicos" value={flowStats.runs.contacts} />
          </>
        )
      }
    >
      {data.keywords.some((k) => k.trim()) ? (
        data.keywords.filter((k) => k.trim()).map((k) => (
          <p key={k} className="rounded-lg bg-gray-50 px-2 py-1 text-gray-700">
            {k}
          </p>
        ))
      ) : (
        <p className="text-gray-400">Clique para adicionar palavras-chave</p>
      )}
      <OutputRow label="Então" handleId="next" />
    </BlockShell>
  );
}

function itemPreview(item: FlowItem) {
  switch (item.kind) {
    case "text":
      return item.text;
    case "media":
      return `📎 ${MEDIA_LABELS[item.mediaType]}${item.caption ? ` · ${item.caption}` : ""}`;
    case "wait":
      return `⏱ Esperar ${item.amount} ${UNIT_LABELS[item.unit]}`;
    case "question":
      return `❓ ${item.text}`;
    case "link":
      return `${item.text}\n🔗 ${item.label}`;
    case "buttons":
      return item.text;
  }
}

function MessageBlock({ id, data, selected }: NodeProps<Node<MessageData, "message">>) {
  const waits = data.items.some((i) => i.kind === "question" || i.kind === "buttons");
  const stats = useNodeStats(id);
  const sends = data.items.some((i) => i.kind !== "wait");
  return (
    <BlockShell
      title={`💬 ${data.title || "Enviar mensagem"}`}
      color="bg-green-50 text-green-800"
      selected={!!selected}
      stats={
        stats &&
        (sends ? (
          <>
            <StatCell label="Chegaram" value={stats.entered} />
            <StatCell label="Entregue" value={pct(stats.delivered, stats.entered)} sub={stats.failed ? `${stats.failed} falharam` : undefined} />
            <StatCell label="Lido" value={pct(stats.read, stats.entered)} />
          </>
        ) : (
          <StatCell label="Chegaram" value={stats.entered} />
        ))
      }
    >
      <Handle type="target" position={Position.Left} className={handleClass} style={{ left: -6 }} />
      {data.items.length === 0 && <p className="text-gray-400">Clique para adicionar mensagens</p>}
      {data.items.map((item) => (
        <div key={item.id}>
          <p
            className={`line-clamp-3 whitespace-pre-wrap rounded-lg px-2 py-1 ${item.kind === "wait" ? "bg-violet-50 text-center text-violet-700" : "bg-gray-50 text-gray-700"}`}
          >
            {itemPreview(item)}
          </p>
          {item.kind === "question" && stats && (
            <p className="mt-0.5 text-right text-[10px] text-sky-800">
              {stats.answered} responderam ({pct(stats.answered, stats.entered)})
            </p>
          )}
          {item.kind === "buttons" &&
            item.buttons.map((b) => (
              <div key={b.id} className="relative mt-1 rounded-lg border border-gray-200 px-2 py-1 text-center font-medium text-gray-800">
                {b.label}
                {stats && (
                  <StatBadge>
                    {stats.buttons[b.id] ?? 0} · {pct(stats.buttons[b.id] ?? 0, stats.entered)}
                  </StatBadge>
                )}
                <Handle type="source" position={Position.Right} id={`btn:${b.id}`} className={handleClass} style={{ right: -18 }} />
              </div>
            ))}
        </div>
      ))}
      {waits && data.noReplyAfter && (
        <OutputRow
          label={`Sem resposta em ${data.noReplyAfter.amount} ${UNIT_LABELS[data.noReplyAfter.unit]}${stats ? ` · ${stats.noReply}` : ""}`}
          handleId="noReply"
          tone="text-red-500"
        />
      )}
      <OutputRow label="Próximo passo" handleId="next" />
    </BlockShell>
  );
}

function actionPreview(action: FlowAction, stages: StageOption[]) {
  switch (action.kind) {
    case "addTag":
      return `🏷 Adicionar tag: ${action.tag}`;
    case "removeTag":
      return `🏷 Remover tag: ${action.tag}`;
    case "moveStage":
      return `📊 Kanban: ${stages.find((s) => s.id === action.stageId)?.name ?? "etapa"}`;
    case "startAi":
      return "🤖 Passar para a IA (encerra o fluxo)";
    case "handoff":
      return "🙋 Transferir para a equipe (encerra o fluxo)";
  }
}

// --- Side panel editors --------------------------------------------------------------------

function ItemEditor({
  item,
  onChange,
  onRemove,
  onMove,
}: {
  item: FlowItem;
  onChange: (item: FlowItem) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post("/flows/media", form);
      if (item.kind === "media") onChange({ ...item, url: res.data.url, fileName: res.data.fileName });
    } finally {
      setUploading(false);
    }
  }

  const titles: Record<FlowItem["kind"], string> = {
    text: "Texto",
    media: "Mídia",
    wait: "Esperar",
    question: "Pergunta (espera a resposta)",
    buttons: "Botões (espera o clique)",
    link: "Botão de link",
  };

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between text-xs font-medium text-gray-600">
        {titles[item.kind]}
        <span className="flex gap-2">
          <button onClick={() => onMove(-1)} title="Subir">
            ↑
          </button>
          <button onClick={() => onMove(1)} title="Descer">
            ↓
          </button>
          <button onClick={onRemove} className="text-red-500" title="Remover">
            ✕
          </button>
        </span>
      </div>

      {(item.kind === "text" || item.kind === "question" || item.kind === "buttons" || item.kind === "link") && (
        <textarea
          value={item.text}
          onChange={(e) => onChange({ ...item, text: e.target.value })}
          rows={3}
          placeholder="Use {{nome}} para o primeiro nome"
          className={inputClass}
        />
      )}

      {item.kind === "question" && (
        <label className="block text-xs text-gray-600">
          Salvar a resposta em
          <select
            value={item.saveTo}
            onChange={(e) => onChange({ ...item, saveTo: e.target.value as typeof item.saveTo })}
            className={`${inputClass} mt-1`}
          >
            {Object.entries(SAVE_TO_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}

      {item.kind === "buttons" && (
        <div className="space-y-1">
          {item.buttons.map((b, i) => (
            <div key={b.id} className="flex gap-1">
              <input
                value={b.label}
                maxLength={FLOW_BUTTON_LABEL_MAX}
                onChange={(e) =>
                  onChange({ ...item, buttons: item.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                }
                placeholder={`Botão ${i + 1}`}
                className={inputClass}
              />
              <button
                onClick={() => onChange({ ...item, buttons: item.buttons.filter((_, j) => j !== i) })}
                className="px-1 text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
          {item.buttons.length < FLOW_MAX_BUTTONS && (
            <button
              onClick={() => onChange({ ...item, buttons: [...item.buttons, { id: newId(), label: "" }] })}
              className="text-xs font-medium text-brand-dark hover:underline"
            >
              + Botão
            </button>
          )}
          <p className="text-[11px] text-gray-400">Até {FLOW_MAX_BUTTONS} botões, com até {FLOW_BUTTON_LABEL_MAX} letras cada (regra do WhatsApp).</p>
        </div>
      )}

      {item.kind === "link" && (
        <>
          <input
            value={item.label}
            maxLength={FLOW_BUTTON_LABEL_MAX}
            onChange={(e) => onChange({ ...item, label: e.target.value })}
            placeholder="Texto do botão (ex.: PAGAR)"
            className={inputClass}
          />
          <input value={item.url} onChange={(e) => onChange({ ...item, url: e.target.value })} placeholder="https://..." className={inputClass} />
        </>
      )}

      {item.kind === "wait" && (
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={item.amount}
            onChange={(e) => onChange({ ...item, amount: Math.max(1, Number(e.target.value) || 1) })}
            className={inputClass}
          />
          <select value={item.unit} onChange={(e) => onChange({ ...item, unit: e.target.value as FlowWaitUnit })} className={inputClass}>
            {Object.entries(UNIT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {item.kind === "media" && (
        <>
          <select
            value={item.mediaType}
            onChange={(e) => onChange({ ...item, mediaType: e.target.value as typeof item.mediaType })}
            className={inputClass}
          >
            {Object.entries(MEDIA_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="block w-full text-xs" />
          {uploading && <p className="text-xs text-gray-500">Enviando arquivo...</p>}
          {item.url && (
            <a
              href={item.url.startsWith("/") ? `${API_URL}${item.url}` : item.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-brand-dark hover:underline"
            >
              {item.fileName ?? item.url}
            </a>
          )}
          {item.mediaType !== "AUDIO" && (
            <input
              value={item.caption ?? ""}
              onChange={(e) => onChange({ ...item, caption: e.target.value })}
              placeholder="Legenda (opcional)"
              className={inputClass}
            />
          )}
        </>
      )}
    </div>
  );
}

function MessagePanel({ data, onChange }: { data: MessageData; onChange: (data: MessageData) => void }) {
  const hasButtons = data.items.some((i) => i.kind === "buttons");
  const waits = data.items.some((i) => i.kind === "question" || i.kind === "buttons");

  function add(kind: FlowItem["kind"]) {
    const id = newId();
    const item: FlowItem =
      kind === "text"
        ? { id, kind, text: "" }
        : kind === "media"
          ? { id, kind, mediaType: "IMAGE", url: "" }
          : kind === "wait"
            ? { id, kind, amount: 3, unit: "seconds" }
            : kind === "question"
              ? { id, kind, text: "", saveTo: "none" }
              : kind === "buttons"
                ? { id, kind, text: "", buttons: [{ id: newId(), label: "" }] }
                : { id, kind, text: "", label: "", url: "" };
    // Buttons always stay last — new items go before them.
    const buttonsAt = data.items.findIndex((i) => i.kind === "buttons");
    const items = [...data.items];
    if (kind !== "buttons" && buttonsAt >= 0) items.splice(buttonsAt, 0, item);
    else items.push(item);
    onChange({ ...data, items });
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= data.items.length) return;
    const items = [...data.items];
    [items[index], items[target]] = [items[target], items[index]];
    onChange({ ...data, items });
  }

  return (
    <div className="space-y-3">
      <input
        value={data.title ?? ""}
        onChange={(e) => onChange({ ...data, title: e.target.value })}
        placeholder="Nome do bloco (opcional)"
        className={inputClass}
      />
      {data.items.map((item, i) => (
        <ItemEditor
          key={item.id}
          item={item}
          onChange={(next) => onChange({ ...data, items: data.items.map((x, j) => (j === i ? next : x)) })}
          onRemove={() => onChange({ ...data, items: data.items.filter((_, j) => j !== i) })}
          onMove={(dir) => move(i, dir)}
        />
      ))}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["text", "+ Texto"],
            ["wait", "+ Esperar"],
            ["media", "+ Mídia"],
            ["question", "+ Pergunta"],
            ["link", "+ Botão de link"],
          ] as const
        ).map(([kind, label]) => (
          <button key={kind} onClick={() => add(kind)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
            {label}
          </button>
        ))}
        {!hasButtons && (
          <button onClick={() => add("buttons")} className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
            + Botões
          </button>
        )}
      </div>

      {waits && (
        <div className="rounded-xl border border-gray-200 p-3 text-xs text-gray-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!data.noReplyAfter}
              onChange={(e) => onChange({ ...data, noReplyAfter: e.target.checked ? { amount: 1, unit: "hours" } : undefined })}
            />
            Se ela não responder em…
          </label>
          {data.noReplyAfter && (
            <div className="mt-2 flex gap-2">
              <input
                type="number"
                min={1}
                value={data.noReplyAfter.amount}
                onChange={(e) =>
                  onChange({ ...data, noReplyAfter: { ...data.noReplyAfter!, amount: Math.max(1, Number(e.target.value) || 1) } })
                }
                className={inputClass}
              />
              <select
                value={data.noReplyAfter.unit}
                onChange={(e) => onChange({ ...data, noReplyAfter: { ...data.noReplyAfter!, unit: e.target.value as FlowWaitUnit } })}
                className={inputClass}
              >
                {Object.entries(UNIT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="mt-1 text-[11px] text-gray-400">
            Ligue a saída vermelha "Sem resposta" a um bloco de follow-up. Depois de 24h sem resposta, o WhatsApp só deixa enviar
            template.
          </p>
        </div>
      )}
    </div>
  );
}

function ActionPanel({
  data,
  tags,
  stages,
  onChange,
}: {
  data: ActionData;
  tags: string[];
  stages: StageOption[];
  onChange: (data: ActionData) => void;
}) {
  function update(i: number, action: FlowAction) {
    onChange({ ...data, actions: data.actions.map((a, j) => (j === i ? action : a)) });
  }
  function blank(kind: FlowAction["kind"]): FlowAction {
    if (kind === "addTag" || kind === "removeTag") return { kind, tag: "" };
    if (kind === "moveStage") return { kind, stageId: stages[0]?.id ?? "" };
    if (kind === "handoff") return { kind, note: "" };
    return { kind };
  }

  return (
    <div className="space-y-3">
      <input
        value={data.title ?? ""}
        onChange={(e) => onChange({ ...data, title: e.target.value })}
        placeholder="Nome do bloco (opcional)"
        className={inputClass}
      />
      <datalist id="flow-tags">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {data.actions.map((action, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex gap-2">
            <select value={action.kind} onChange={(e) => update(i, blank(e.target.value as FlowAction["kind"]))} className={inputClass}>
              <option value="addTag">Adicionar tag</option>
              <option value="removeTag">Remover tag</option>
              <option value="moveStage">Mover no Kanban</option>
              <option value="startAi">Passar para a IA</option>
              <option value="handoff">Transferir para a equipe</option>
            </select>
            <button onClick={() => onChange({ ...data, actions: data.actions.filter((_, j) => j !== i) })} className="px-1 text-red-500">
              ✕
            </button>
          </div>
          {(action.kind === "addTag" || action.kind === "removeTag") && (
            <input list="flow-tags" value={action.tag} onChange={(e) => update(i, { ...action, tag: e.target.value })} placeholder="Nome da tag" className={inputClass} />
          )}
          {action.kind === "moveStage" && (
            <select value={action.stageId} onChange={(e) => update(i, { ...action, stageId: e.target.value })} className={inputClass}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.pipelineName} · {s.name}
                </option>
              ))}
            </select>
          )}
          {action.kind === "handoff" && (
            <input
              value={action.note}
              onChange={(e) => update(i, { ...action, note: e.target.value })}
              placeholder="Nota para a equipe (ex.: quer pagar no cartão)"
              className={inputClass}
            />
          )}
          {(action.kind === "startAi" || action.kind === "handoff") && (
            <p className="text-[11px] text-gray-400">Encerra o fluxo — as ações abaixo desta não rodam.</p>
          )}
        </div>
      ))}
      <button onClick={() => onChange({ ...data, actions: [...data.actions, blank("addTag")] })} className="text-xs font-medium text-brand-dark hover:underline">
        + Ação
      </button>
    </div>
  );
}

function ActionStats({ nodeId }: { nodeId: string }) {
  const stats = useNodeStats(nodeId);
  return stats ? <StatCell label="Passaram" value={stats.entered} /> : null;
}

// --- Page ----------------------------------------------------------------------------------

function toEditor(graph: FlowGraph): { nodes: EditorNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ ...n, deletable: n.type !== "trigger" }) as EditorNode),
    edges: graph.edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed } })),
  };
}

function toGraph(nodes: EditorNode[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }) as FlowNode),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? "next", target: e.target })),
  };
}

// Arrows whose button or "no reply" exit no longer exists would never fire — drop them.
function pruneEdges(nodes: EditorNode[], edges: Edge[]) {
  return edges.filter((e) => {
    const node = nodes.find((n) => n.id === e.source);
    if (!node || !nodes.some((n) => n.id === e.target)) return false;
    if (node.type !== "message") return true;
    const handle = e.sourceHandle ?? "next";
    if (handle.startsWith("btn:")) {
      return node.data.items.some((i) => i.kind === "buttons" && i.buttons.some((b) => `btn:${b.id}` === handle));
    }
    if (handle === "noReply") return !!node.data.noReplyAfter;
    return true;
  });
}

export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState("");
  const [active, setActive] = useState(false);
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<FlowStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  async function loadStats() {
    setLoadingStats(true);
    try {
      const res = await api.get<FlowStats>(`/flows/${id}/stats`);
      setStats(res.data);
    } finally {
      setLoadingStats(false);
    }
  }

  function toggleStats() {
    if (!showStats) loadStats();
    setShowStats(!showStats);
  }

  useEffect(() => {
    Promise.all([api.get(`/flows/${id}`), api.get("/flows/options")]).then(([flow, options]) => {
      setName(flow.data.name);
      setActive(flow.data.active);
      const editor = toEditor(flow.data.graph as FlowGraph);
      setNodes(editor.nodes);
      setEdges(editor.edges);
      setTags(options.data.tags);
      setStages(options.data.stages);
      setLoaded(true);
    });
  }, [id]);

  const nodeTypes = useMemo(
    () => ({
      trigger: TriggerBlock,
      message: MessageBlock,
      action: (props: NodeProps<Node<ActionData, "action">>) => (
        <BlockShell
          title={`⚙️ ${props.data.title || "Ações"}`}
          color="bg-yellow-50 text-yellow-800"
          selected={!!props.selected}
          stats={<ActionStats nodeId={props.id} />}
        >
          <Handle type="target" position={Position.Left} className={handleClass} style={{ left: -6 }} />
          {props.data.actions.length === 0 && <p className="text-gray-400">Clique para adicionar ações</p>}
          {props.data.actions.map((a, i) => (
            <p key={i} className="rounded-lg bg-gray-50 px-2 py-1 text-gray-700">
              {actionPreview(a, stages)}
            </p>
          ))}
          <OutputRow label="Próximo passo" handleId="next" />
        </BlockShell>
      ),
    }),
    [stages],
  );

  const onNodesChange = useCallback((changes: NodeChange<EditorNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type !== "select" && c.type !== "dimensions")) setDirty(true);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type !== "select")) setDirty(true);
  }, []);
  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    const handle = c.sourceHandle ?? "next";
    // One arrow per exit: connecting it again replaces the old arrow.
    setEdges((es) => [
      ...es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "next") === handle)),
      { id: newId(), source: c.source, sourceHandle: handle, target: c.target, markerEnd: { type: MarkerType.ArrowClosed } },
    ]);
    setDirty(true);
  }, []);

  function updateData(nodeId: string, data: EditorNode["data"]) {
    setNodes((ns) => {
      const next = ns.map((n) => (n.id === nodeId ? ({ ...n, data } as EditorNode) : n));
      setEdges((es) => pruneEdges(next, es));
      return next;
    });
    setDirty(true);
  }

  function addBlock(type: "message" | "action") {
    const right = nodes.reduce((max, n) => Math.max(max, n.position.x), 0);
    const node: EditorNode =
      type === "message"
        ? { id: newId(), type, position: { x: right + 320, y: 0 }, data: { items: [] } }
        : { id: newId(), type, position: { x: right + 320, y: 0 }, data: { actions: [] } };
    setNodes((ns) => [...ns, node]);
    setSelectedId(node.id);
    setDirty(true);
  }

  async function save(nextActive = active) {
    setSaving(true);
    setMessage(null);
    try {
      await api.patch(`/flows/${id}`, { name, active: nextActive, graph: toGraph(nodes, edges) });
      setActive(nextActive);
      setDirty(false);
      setMessage({ ok: true, text: nextActive ? "Salvo — fluxo ligado." : "Salvo." });
    } catch (err) {
      setMessage({ ok: false, text: flowErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  if (!loaded) return <div className="p-6 text-sm text-gray-500">Carregando fluxo...</div>;

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <Link to="/funil" className="text-sm text-gray-500 hover:underline">
          ← Funil
        </Link>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className="w-64 rounded-xl border border-gray-300 px-3 py-1.5 text-sm font-medium focus:border-brand focus:outline-none"
        />
        <button onClick={() => addBlock("message")} className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          + Mensagem
        </button>
        <button onClick={() => addBlock("action")} className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          + Ações
        </button>
        <button
          onClick={toggleStats}
          className={`rounded-xl border px-3 py-1.5 text-sm ${showStats ? "border-sky-300 bg-sky-50 text-sky-800" : "border-gray-300 hover:bg-gray-50"}`}
        >
          📊 Números
        </button>
        <div className="flex-1" />
        {message && <span className={`text-xs ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</span>}
        {dirty && !message && <span className="text-xs text-gray-400">Alterações não salvas</span>}
        <button
          onClick={() => save(!active)}
          disabled={saving}
          className={`rounded-xl px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${active ? "border border-gray-300 text-gray-700" : "border border-brand-dark text-brand-dark"}`}
        >
          {active ? "Desligar fluxo" : "Salvar e ligar"}
        </button>
        <button
          onClick={() => save()}
          disabled={saving}
          className="rounded-xl bg-brand-dark px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {showStats && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-sky-100 bg-sky-50 px-4 py-2 text-xs text-sky-900">
          {stats ? (
            <>
              <span>
                <b>{stats.runs.total}</b> disparos
              </span>
              <span>
                <b>{stats.runs.contacts}</b> contatos únicos
              </span>
              <span>
                <b>{stats.runs.done}</b> concluíram ({pct(stats.runs.done, stats.runs.total)})
              </span>
              <span>
                <b>{stats.runs.active}</b> em andamento
              </span>
              <span title="Alguém da equipe respondeu no meio do fluxo, ou uma mensagem não pôde ser enviada.">
                <b>{stats.runs.stopped}</b> interrompidos
              </span>
            </>
          ) : (
            <span>Carregando números...</span>
          )}
          <div className="flex-1" />
          <span className="text-sky-700/70">Porcentagens sobre quem chegou em cada bloco.</span>
          <button onClick={loadStats} disabled={loadingStats} className="font-medium text-sky-800 hover:underline disabled:opacity-50">
            {loadingStats ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <FlowStatsContext.Provider value={showStats ? stats : null}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
              fitView
              fitViewOptions={{ maxZoom: 1 }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </FlowStatsContext.Provider>
        </div>

        {selected && (
          <aside className="w-96 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                {selected.type === "trigger" ? "Gatilho" : selected.type === "message" ? "Mensagem" : "Ações"}
              </p>
              <span className="flex gap-3">
                {selected.type !== "trigger" && (
                  <button
                    onClick={() => {
                      setNodes((ns) => ns.filter((n) => n.id !== selected.id));
                      setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
                      setSelectedId(null);
                      setDirty(true);
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Excluir bloco
                  </button>
                )}
                <button onClick={() => setSelectedId(null)} className="text-xs text-gray-500">
                  Fechar
                </button>
              </span>
            </div>

            {selected.type === "trigger" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  Uma frase por linha. O fluxo começa quando a mensagem dela contém uma delas (sem diferenciar maiúsculas ou acentos) e
                  ela não está em outro fluxo.
                </p>
                <textarea
                  rows={6}
                  value={selected.data.keywords.join("\n")}
                  onChange={(e) => updateData(selected.id, { keywords: e.target.value.split("\n") })}
                  placeholder={"Quero participar do Desafio 7.0\nDesafio 7.0"}
                  className={inputClass}
                />
              </div>
            )}
            {selected.type === "message" && <MessagePanel data={selected.data} onChange={(d) => updateData(selected.id, d)} />}
            {selected.type === "action" && (
              <ActionPanel data={selected.data} tags={tags} stages={stages} onChange={(d) => updateData(selected.id, d)} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
