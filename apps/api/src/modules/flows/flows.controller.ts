import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@crm/db";
import { FLOW_BUTTON_LABEL_MAX, FLOW_MAX_BUTTONS, FlowGraph, FlowStats, Role } from "@crm/shared";
import { prisma } from "../../prisma";
import { HttpError } from "../../utils/httpError";

// The Funil is OWNER/ADMIN only, like Campanhas — a flow messages leads on its own.
function assertOwnerOrAdmin(req: Request) {
  const { role } = req.auth!;
  if (role !== Role.OWNER && role !== Role.ADMIN) throw new HttpError(403, "only_owner_or_admin_can_change_this");
}

const position = z.object({ x: z.number(), y: z.number() });
const waitUnit = z.enum(["seconds", "minutes", "hours", "days"]);
const id = z.string().min(1).max(64);

const itemSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("text"), text: z.string().trim().min(1).max(4096) }),
  z.object({
    id,
    kind: z.literal("media"),
    mediaType: z.enum(["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"]),
    url: z.string().trim().min(1),
    caption: z.string().max(1024).optional(),
    fileName: z.string().max(200).optional(),
  }),
  z.object({ id, kind: z.literal("wait"), amount: z.number().int().min(1).max(10000), unit: waitUnit }),
  z.object({
    id,
    kind: z.literal("question"),
    text: z.string().trim().min(1).max(4096),
    saveTo: z.enum(["name", "objective", "note", "none"]),
  }),
  z.object({
    id,
    kind: z.literal("buttons"),
    // Meta's limit for an interactive message body.
    text: z.string().trim().min(1).max(1024),
    buttons: z
      .array(z.object({ id, label: z.string().trim().min(1).max(FLOW_BUTTON_LABEL_MAX) }))
      .min(1)
      .max(FLOW_MAX_BUTTONS),
  }),
  z.object({
    id,
    kind: z.literal("link"),
    text: z.string().trim().min(1).max(1024),
    label: z.string().trim().min(1).max(FLOW_BUTTON_LABEL_MAX),
    url: z.string().trim().url(),
  }),
]);

const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("addTag"), tag: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal("removeTag"), tag: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal("moveStage"), stageId: z.string().min(1) }),
  z.object({ kind: z.literal("startAi") }),
  z.object({ kind: z.literal("handoff"), note: z.string().max(500).default("") }),
]);

const nodeSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("trigger"), position, data: z.object({ keywords: z.array(z.string().trim().max(200)).max(30) }) }),
  z.object({
    id,
    type: z.literal("message"),
    position,
    data: z.object({
      title: z.string().max(80).optional(),
      items: z.array(itemSchema).max(40),
      noReplyAfter: z.object({ amount: z.number().int().min(1).max(10000), unit: waitUnit }).optional(),
    }),
  }),
  z.object({
    id,
    type: z.literal("action"),
    position,
    data: z.object({ title: z.string().max(80).optional(), actions: z.array(actionSchema).max(20) }),
  }),
]);

const graphSchema = z
  .object({
    nodes: z.array(nodeSchema).max(200),
    edges: z.array(z.object({ id, source: id, sourceHandle: z.string().min(1).max(80), target: id })).max(500),
  })
  .superRefine((graph, ctx) => {
    if (graph.nodes.filter((n) => n.type === "trigger").length !== 1) {
      ctx.addIssue({ code: "custom", message: "flow_needs_exactly_one_trigger" });
    }
    for (const node of graph.nodes) {
      if (node.type !== "message") continue;
      const buttonsAt = node.data.items.findIndex((i) => i.kind === "buttons");
      if (buttonsAt >= 0 && buttonsAt !== node.data.items.length - 1) {
        ctx.addIssue({ code: "custom", message: "buttons_must_be_the_last_item_of_a_block" });
      }
    }
  });

const DEFAULT_GRAPH: FlowGraph = {
  nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: [] } }],
  edges: [],
};

function triggerKeywords(graph: FlowGraph) {
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  return trigger?.type === "trigger" ? trigger.data.keywords.map((k) => k.trim()).filter(Boolean) : [];
}

async function findFlow(organizationId: string, flowId: string) {
  const flow = await prisma.flow.findFirst({ where: { id: flowId, organizationId } });
  if (!flow) throw new HttpError(404, "flow_not_found");
  return flow;
}

export async function listFlows(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const [flows, active, total] = await Promise.all([
    prisma.flow.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, active: true, triggerKeywords: true, updatedAt: true },
    }),
    prisma.flowRun.groupBy({
      by: ["flowId"],
      where: { organizationId, status: { in: ["RUNNING", "WAITING"] } },
      _count: { _all: true },
    }),
    prisma.flowRun.groupBy({ by: ["flowId"], where: { organizationId }, _count: { _all: true } }),
  ]);
  const activeBy = new Map(active.map((r) => [r.flowId, r._count._all]));
  const totalBy = new Map(total.map((r) => [r.flowId, r._count._all]));
  res.json({
    items: flows.map((f) => ({ ...f, activeRuns: activeBy.get(f.id) ?? 0, totalRuns: totalBy.get(f.id) ?? 0 })),
  });
}

// What the editor's selects offer: existing tags and Kanban stages.
export async function getFlowOptions(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const [tags, stages] = await Promise.all([
    prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.pipelineStage.findMany({
      where: { pipeline: { organizationId } },
      orderBy: [{ pipeline: { createdAt: "asc" } }, { order: "asc" }],
      select: { id: true, name: true, pipeline: { select: { name: true } } },
    }),
  ]);
  res.json({
    tags: tags.map((t) => t.name),
    stages: stages.map((s) => ({ id: s.id, name: s.name, pipelineName: s.pipeline.name })),
  });
}

export async function getFlow(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  res.json(await findFlow(req.auth!.organizationId, req.params.id));
}

// Per-block numbers for the editor. Counts are distinct runs (FlowEvent for reaching a block,
// tapping a button, answering, no-reply; the block's Messages for delivered/read/failed).
// Runs from before FlowEvent existed only show up in the totals.
export async function getFlowStats(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const flow = await findFlow(req.auth!.organizationId, req.params.id);

  const [runRows, eventRows, messageRows] = await Promise.all([
    prisma.$queryRaw<{ total: number; contacts: number; done: number; active: number; stopped: number }[]>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(DISTINCT "contactId")::int AS contacts,
        (COUNT(*) FILTER (WHERE status = 'DONE'))::int AS done,
        (COUNT(*) FILTER (WHERE status IN ('RUNNING', 'WAITING')))::int AS active,
        (COUNT(*) FILTER (WHERE status = 'STOPPED'))::int AS stopped
      FROM "FlowRun"
      WHERE "flowId" = ${flow.id}
    `,
    prisma.$queryRaw<{ nodeId: string; kind: string; handle: string | null; runs: number }[]>`
      SELECT "nodeId", kind, handle, COUNT(DISTINCT "runId")::int AS runs
      FROM "FlowEvent"
      WHERE "flowId" = ${flow.id}
      GROUP BY "nodeId", kind, handle
    `,
    prisma.$queryRaw<{ nodeId: string; delivered: number; read: number; failed: number }[]>`
      SELECT
        m."flowNodeId" AS "nodeId",
        (COUNT(DISTINCT m."flowRunId") FILTER (WHERE m.status::text IN ('DELIVERED', 'READ')))::int AS delivered,
        (COUNT(DISTINCT m."flowRunId") FILTER (WHERE m.status::text = 'READ'))::int AS read,
        (COUNT(DISTINCT m."flowRunId") FILTER (WHERE m.status::text = 'FAILED'))::int AS failed
      FROM "Message" m
      JOIN "FlowRun" r ON r.id = m."flowRunId"
      WHERE r."flowId" = ${flow.id} AND m."flowNodeId" IS NOT NULL
      GROUP BY m."flowNodeId"
    `,
  ]);

  const nodes: FlowStats["nodes"] = {};
  const nodeStats = (nodeId: string) =>
    (nodes[nodeId] ??= { entered: 0, delivered: 0, read: 0, failed: 0, answered: 0, noReply: 0, buttons: {} });
  for (const e of eventRows) {
    const s = nodeStats(e.nodeId);
    if (e.kind === "enter") s.entered += e.runs;
    else if (e.kind === "answer") s.answered += e.runs;
    else if (e.kind === "noReply") s.noReply += e.runs;
    else if (e.kind === "button" && e.handle) s.buttons[e.handle] = (s.buttons[e.handle] ?? 0) + e.runs;
  }
  for (const m of messageRows) Object.assign(nodeStats(m.nodeId), { delivered: m.delivered, read: m.read, failed: m.failed });

  const stats: FlowStats = { runs: runRows[0] ?? { total: 0, contacts: 0, done: 0, active: 0, stopped: 0 }, nodes };
  res.json(stats);
}

export async function createFlow(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const flow = await prisma.flow.create({
    data: { organizationId: req.auth!.organizationId, name, graph: DEFAULT_GRAPH as unknown as Prisma.InputJsonValue },
  });
  res.status(201).json(flow);
}

export async function updateFlow(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const organizationId = req.auth!.organizationId;
  const flow = await findFlow(organizationId, req.params.id);
  const input = z
    .object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional(), graph: graphSchema.optional() })
    .parse(req.body);

  const graph = (input.graph ?? flow.graph) as unknown as FlowGraph;
  const keywords = triggerKeywords(graph);
  if (input.active ?? flow.active) {
    // An active flow must be reachable: at least one keyword, and the trigger connected to a block.
    if (!keywords.length) throw new HttpError(400, "flow_needs_a_keyword");
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    if (!trigger || !graph.edges.some((e) => e.source === trigger.id)) throw new HttpError(400, "flow_trigger_not_connected");
  }

  const updated = await prisma.flow.update({
    where: { id: flow.id },
    data: {
      name: input.name,
      active: input.active,
      ...(input.graph ? { graph: input.graph as unknown as Prisma.InputJsonValue, triggerKeywords: keywords } : {}),
    },
  });
  res.json(updated);
}

export async function deleteFlow(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  const flow = await findFlow(req.auth!.organizationId, req.params.id);
  await prisma.flow.delete({ where: { id: flow.id } });
  res.status(204).end();
}

// Images/audio/documents a flow sends — stored like quick-reply media and served from /uploads.
export async function uploadFlowMedia(req: Request, res: Response) {
  assertOwnerOrAdmin(req);
  if (!req.file) throw new HttpError(400, "file_required");
  res.status(201).json({ url: `/uploads/flows/${req.file.filename}`, fileName: req.file.originalname });
}
