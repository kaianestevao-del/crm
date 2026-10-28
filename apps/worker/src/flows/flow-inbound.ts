import crypto from "crypto";
import { Queue } from "bullmq";
import { getPrismaClient, Message, FlowRunStatus } from "@crm/db";
import { QUEUE_FLOW_STEPS, FlowStepJob, FlowGraph, FlowNode, FlowItem } from "@crm/shared";
import { findActivationKeyword } from "@crm/ai";
import { createRedisClient } from "../redis";
import { publishRealtimeEvent } from "../pubsub";

// The inbound side of the Funil: deciding whether a message belongs to a flow (an answer to the
// block a run is waiting on, or a trigger keyword starting one) and moving the run's pointer.
// Nothing is sent from here — every send happens in flow-runner.ts, one queue job at a time per
// run, so a flow's messages always go out in order.

const prisma = getPrismaClient();
export const flowStepsQueue = new Queue<FlowStepJob>(QUEUE_FLOW_STEPS, { connection: createRedisClient() });

export const ACTIVE_RUN_STATUSES = [FlowRunStatus.RUNNING, FlowRunStatus.WAITING];

export function flowGraph(graph: unknown): FlowGraph {
  const g = graph as Partial<FlowGraph> | null;
  return { nodes: g?.nodes ?? [], edges: g?.edges ?? [] };
}

export function edgeTarget(graph: FlowGraph, source: string, handle: string) {
  return graph.edges.find((e) => e.source === source && e.sourceHandle === handle)?.target ?? null;
}

export function findNode(graph: FlowGraph, id: string): FlowNode | null {
  return graph.nodes.find((n) => n.id === id) ?? null;
}

export function newToken() {
  return crypto.randomUUID();
}

// Points the run at `nodeId` (or ends it when there's nowhere to go) and queues the runner.
export async function moveRunTo(runId: string, nodeId: string | null, step = 0) {
  if (!nodeId) {
    await prisma.flowRun.update({ where: { id: runId }, data: { status: FlowRunStatus.DONE, token: null, finishedAt: new Date() } });
    return;
  }
  const token = newToken();
  await prisma.flowRun.update({ where: { id: runId }, data: { status: FlowRunStatus.RUNNING, nodeId, step, token } });
  await flowStepsQueue.add("step", { runId, token, kind: "continue" }, { removeOnComplete: true, removeOnFail: 200 });
}

export async function hasActiveFlowRun(conversationId: string) {
  const run = await prisma.flowRun.findFirst({ where: { conversationId, status: { in: ACTIVE_RUN_STATUSES } }, select: { id: true } });
  return !!run;
}

// An attendant stepped in — the flow gets out of the way (same rule as the AI assistant).
export async function stopFlowRuns(conversationId: string) {
  await prisma.flowRun.updateMany({
    where: { conversationId, status: { in: ACTIVE_RUN_STATUSES } },
    data: { status: FlowRunStatus.STOPPED, token: null, finishedAt: new Date() },
  });
}

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// The button she tapped (Cloud API sends its title as the message text) or, where buttons went
// out as numbered text, the number or the option written out.
function matchButton(item: Extract<FlowItem, { kind: "buttons" }>, answer: string) {
  const text = normalize(answer);
  if (!text) return null;
  const byNumber = /^\d+$/.test(text) ? item.buttons[Number(text) - 1] : undefined;
  return byNumber ?? item.buttons.find((b) => normalize(b.label) === text) ?? null;
}

async function saveAnswer(
  run: { organizationId: string; contactId: string; flow: { name: string } },
  item: Extract<FlowItem, { kind: "question" }>,
  answer: string,
) {
  const value = answer.trim();
  if (!value || item.saveTo === "none") return;
  if (item.saveTo === "name") {
    await prisma.contact.update({ where: { id: run.contactId }, data: { name: value.slice(0, 80) } });
  } else if (item.saveTo === "objective") {
    await prisma.contact.update({ where: { id: run.contactId }, data: { objective: value.slice(0, 200) } });
  } else {
    await prisma.note.create({
      data: { organizationId: run.organizationId, contactId: run.contactId, content: `📝 Funil "${run.flow.name}": ${item.text}\n→ ${value}` },
    });
  }
  publishRealtimeEvent({ type: "contact.updated", organizationId: run.organizationId, contactId: run.contactId });
}

// Called for every live inbound message before the AI assistant. True means the message belongs
// to a flow — the assistant must not answer it.
export async function onInboundMessageForFlows(organizationId: string, conversationId: string, contactId: string, message: Message) {
  const run = await prisma.flowRun.findFirst({
    where: { conversationId, status: { in: ACTIVE_RUN_STATUSES } },
    include: { flow: true },
    orderBy: { startedAt: "desc" },
  });

  if (run) {
    // Still sending (RUNNING) — she wrote mid-sequence; the flow keeps going and the AI stays out.
    if (run.status !== FlowRunStatus.WAITING) return true;
    const graph = flowGraph(run.flow.graph);
    const node = findNode(graph, run.nodeId);
    const item = node?.type === "message" ? node.data.items[run.step] : undefined;
    const answer = message.content ?? message.transcript ?? "";

    if (item?.kind === "question") {
      await saveAnswer(run, item, answer);
      await moveRunTo(run.id, run.nodeId, run.step + 1);
    } else if (item?.kind === "buttons" && node) {
      const chosen = matchButton(item, answer);
      // Anything that isn't one of the options: keep waiting (the block's "no reply" timer, if
      // any, still runs) — the team sees her message in the Inbox as usual.
      if (!chosen) return true;
      await moveRunTo(run.id, edgeTarget(graph, node.id, `btn:${chosen.id}`) ?? edgeTarget(graph, node.id, "next"));
    } else {
      // The flow was edited under a waiting run and the item is gone — end it cleanly.
      await moveRunTo(run.id, null);
      return false;
    }
    return true;
  }

  if (!message.content) return false;
  const flows = await prisma.flow.findMany({ where: { organizationId, active: true }, orderBy: { createdAt: "asc" } });
  const flow = flows.find((f) => findActivationKeyword(message.content!, f.triggerKeywords.map((phrase) => ({ phrase, origin: null }))));
  if (!flow) return false;

  const graph = flowGraph(flow.graph);
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const first = trigger ? edgeTarget(graph, trigger.id, "next") : null;
  if (!first) return false;

  const created = await prisma.flowRun.create({
    data: { flowId: flow.id, organizationId, conversationId, contactId, nodeId: first },
  });
  await moveRunTo(created.id, first);
  return true;
}
