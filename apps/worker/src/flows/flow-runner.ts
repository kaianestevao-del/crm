import { Worker } from "bullmq";
import { getPrismaClient, FlowRunStatus, MessageDirection, MessageStatus, MessageType } from "@crm/db";
import { QUEUE_FLOW_STEPS, FLOW_WAIT_UNIT_MS, FlowStepJob, FlowAction, FlowItem, OutboundMessageJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { publishRealtimeEvent } from "../pubsub";
import { env } from "../env";
import { interactiveAsText, sendOutboundMessage } from "../baileys/session-manager";
import { edgeTarget, findNode, flowGraph, flowStepsQueue, moveRunTo, newToken } from "./flow-inbound";

const prisma = getPrismaClient();

// A broken graph (a loop with no message or wait in it) must not spin forever inside one job.
const MAX_NODES_PER_JOB = 50;

type RunWithContext = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

function loadRun(runId: string) {
  return prisma.flowRun.findUnique({
    where: { id: runId },
    include: { flow: true, conversation: { include: { contact: true } } },
  });
}

// {{nome}} is her first name (empty if we don't know it yet), {{telefone}} her number.
function fillVariables(text: string, contact: { name: string | null; phoneNumber: string }) {
  const firstName = contact.name?.trim().split(/\s+/)[0] ?? "";
  return text.replace(/\{\{\s*nome\s*\}\}/gi, firstName).replace(/\{\{\s*telefone\s*\}\}/gi, contact.phoneNumber);
}

function absoluteUrl(url: string) {
  return url.startsWith("/") ? `${env.PUBLIC_URL}${url}` : url;
}

// The run may have been stopped (an attendant replied) or moved on while this job was running.
async function stillOwned(run: RunWithContext, token: string) {
  const fresh = await prisma.flowRun.findUnique({ where: { id: run.id }, select: { status: true, token: true } });
  return fresh?.status === FlowRunStatus.RUNNING && fresh.token === token;
}

async function send(run: RunWithContext, item: Exclude<FlowItem, { kind: "wait" }>) {
  const { conversation } = run;
  const contact = conversation.contact;
  const job: Omit<OutboundMessageJob, "messageId"> = {
    organizationId: run.organizationId,
    sessionId: conversation.whatsappSessionId,
    conversationId: conversation.id,
    waJid: contact.waJid,
  };
  let type: MessageType = MessageType.TEXT;
  let mediaUrl: string | null = null;

  if (item.kind === "media") {
    type = MessageType[item.mediaType];
    mediaUrl = item.url;
    Object.assign(job, {
      mediaType: item.mediaType,
      mediaUrl: absoluteUrl(item.url),
      mediaName: item.fileName,
      text: item.caption ? fillVariables(item.caption, contact) : undefined,
    });
  } else if (item.kind === "buttons") {
    Object.assign(job, { text: fillVariables(item.text, contact), buttons: item.buttons.map((b) => ({ id: b.id, title: b.label })) });
  } else if (item.kind === "link") {
    Object.assign(job, { text: fillVariables(item.text, contact), ctaUrl: { label: item.label, url: item.url } });
  } else {
    job.text = fillVariables(item.text, contact);
  }

  // What the Inbox shows — the same text a Baileys number actually sends, which also lets the
  // echo of our own send be recognised as ours (see session-manager's ownAutomatedEcho).
  const content = type === MessageType.TEXT ? interactiveAsText(job) : job.text ?? null;
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type,
      content,
      mediaUrl,
      status: MessageStatus.PENDING,
      sentByFlow: true,
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  publishRealtimeEvent({ type: "message.new", organizationId: run.organizationId, conversationId: conversation.id, message });
  publishRealtimeEvent({ type: "conversation.updated", organizationId: run.organizationId, conversationId: conversation.id });

  await sendOutboundMessage({ ...job, messageId: message.id });
}

async function setTag(organizationId: string, contactId: string, tagName: string, add: boolean) {
  const name = tagName.trim();
  if (!name) return;
  if (add) {
    const tag = await prisma.tag.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: {},
      create: { organizationId, name },
    });
    await prisma.contactTag.createMany({ data: [{ contactId, tagId: tag.id }], skipDuplicates: true });
  } else {
    const tag = await prisma.tag.findUnique({ where: { organizationId_name: { organizationId, name } } });
    if (tag) await prisma.contactTag.deleteMany({ where: { contactId, tagId: tag.id } });
  }
  publishRealtimeEvent({ type: "contact.updated", organizationId, contactId });
}

// Puts her card in the given Kanban stage (creating it if she has none), with the same
// bookkeeping as pipelines.controller.ts transitionDealStage so Dashboard metrics stay right.
async function moveToStage(organizationId: string, contact: { id: string; name: string | null; phoneNumber: string }, stageId: string) {
  const target = await prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline: { organizationId } } });
  if (!target) return;
  const deal = await prisma.deal.findFirst({ where: { organizationId, contactId: contact.id }, orderBy: { createdAt: "desc" } });
  if (deal?.stageId === target.id) return;
  const lastInColumn = await prisma.deal.findFirst({ where: { stageId: target.id }, orderBy: { order: "desc" } });
  const order = (lastInColumn?.order ?? -1) + 1;

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    if (!deal) {
      const created = await tx.deal.create({
        data: {
          organizationId,
          pipelineId: target.pipelineId,
          stageId: target.id,
          contactId: contact.id,
          title: contact.name ?? contact.phoneNumber,
          order,
        },
      });
      await tx.dealStageHistory.create({ data: { dealId: created.id, stageId: target.id, enteredAt: now } });
      return;
    }
    await tx.deal.update({ where: { id: deal.id }, data: { stageId: target.id, pipelineId: target.pipelineId, order } });
    await tx.dealStageHistory.updateMany({ where: { dealId: deal.id, stageId: deal.stageId, exitedAt: null }, data: { exitedAt: now } });
    await tx.dealStageHistory.create({ data: { dealId: deal.id, stageId: target.id, enteredAt: now } });
  });
}

async function finish(runId: string, status: FlowRunStatus) {
  await prisma.flowRun.update({ where: { id: runId }, data: { status, token: null, finishedAt: new Date() } });
}

// Runs the actions of an "Ações" block. Returns true when one of them ended the flow.
async function runActions(run: RunWithContext, actions: FlowAction[]) {
  const { organizationId, conversation } = run;
  for (const action of actions) {
    if (action.kind === "addTag" || action.kind === "removeTag") {
      await setTag(organizationId, conversation.contactId, action.tag, action.kind === "addTag");
    } else if (action.kind === "moveStage") {
      await moveToStage(organizationId, conversation.contact, action.stageId);
    } else if (action.kind === "startAi") {
      await finish(run.id, FlowRunStatus.DONE);
      await prisma.conversation.update({ where: { id: conversation.id }, data: { aiEnabled: true } });
      publishRealtimeEvent({ type: "conversation.updated", organizationId, conversationId: conversation.id });
      return true;
    } else if (action.kind === "handoff") {
      await finish(run.id, FlowRunStatus.DONE);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiEnabled: false, unreadCount: { increment: 1 }, status: "OPEN" },
      });
      await prisma.note.create({
        data: {
          organizationId,
          contactId: conversation.contactId,
          content: `⚡ Funil "${run.flow.name}" transferiu a conversa${action.note.trim() ? `: ${action.note.trim()}` : "."}`,
        },
      });
      publishRealtimeEvent({ type: "conversation.updated", organizationId, conversationId: conversation.id });
      publishRealtimeEvent({ type: "contact.updated", organizationId, contactId: conversation.contactId });
      return true;
    }
  }
  return false;
}

// Walks the graph from the run's pointer: sends each item of a "Mensagem" block in order, runs
// "Ações" blocks, and stops at the first thing that has to wait (a timer, or her answer).
async function advance(run: RunWithContext, token: string) {
  const graph = flowGraph(run.flow.graph);
  let nodeId: string | null = run.nodeId;
  let step = run.step;

  for (let hops = 0; hops < MAX_NODES_PER_JOB; hops++) {
    const node = nodeId ? findNode(graph, nodeId) : null;
    if (!node) {
      await finish(run.id, FlowRunStatus.DONE);
      return;
    }

    if (node.type === "action") {
      if (await runActions(run, node.data.actions)) return;
      nodeId = edgeTarget(graph, node.id, "next");
      step = 0;
      continue;
    }

    if (node.type === "message") {
      const items = node.data.items;
      for (let i = step; i < items.length; i++) {
        const item = items[i];
        if (!(await stillOwned(run, token))) return;

        if (item.kind === "wait") {
          const next = newToken();
          await prisma.flowRun.update({ where: { id: run.id }, data: { nodeId: node.id, step: i + 1, token: next } });
          await flowStepsQueue.add(
            "step",
            { runId: run.id, token: next, kind: "continue" },
            { delay: Math.max(0, item.amount) * FLOW_WAIT_UNIT_MS[item.unit], removeOnComplete: true, removeOnFail: 200 },
          );
          return;
        }

        if (item.kind === "question" || item.kind === "buttons") {
          // Waiting before sending: an answer that arrives right after the send must find the
          // run already expecting it.
          const next = newToken();
          await prisma.flowRun.update({
            where: { id: run.id },
            data: { status: FlowRunStatus.WAITING, nodeId: node.id, step: i, token: next },
          });
          await send(run, item);
          const noReply = node.data.noReplyAfter;
          if (noReply && noReply.amount > 0 && edgeTarget(graph, node.id, "noReply")) {
            await flowStepsQueue.add(
              "step",
              { runId: run.id, token: next, kind: "noReply" },
              { delay: noReply.amount * FLOW_WAIT_UNIT_MS[noReply.unit], removeOnComplete: true, removeOnFail: 200 },
            );
          }
          return;
        }

        await send(run, item);
        await prisma.flowRun.update({ where: { id: run.id }, data: { nodeId: node.id, step: i + 1 } });
      }
    }

    nodeId = edgeTarget(graph, node.id, "next");
    step = 0;
    if (nodeId) await prisma.flowRun.update({ where: { id: run.id }, data: { nodeId, step: 0 } });
  }

  console.error("flow_run_too_many_hops", { runId: run.id });
  await finish(run.id, FlowRunStatus.STOPPED);
}

async function processFlowStep(job: FlowStepJob) {
  const run = await loadRun(job.runId);
  if (!run || run.token !== job.token) return;

  if (job.kind === "noReply") {
    // She never answered the block this timer belongs to — follow its "sem resposta" arrow.
    if (run.status !== FlowRunStatus.WAITING) return;
    await moveRunTo(run.id, edgeTarget(flowGraph(run.flow.graph), run.nodeId, "noReply"));
    return;
  }

  if (run.status !== FlowRunStatus.RUNNING) return;
  try {
    await advance(run, job.token);
  } catch (err) {
    // Most likely a send Meta refused (e.g. outside the 24h window after a long wait). Stop here
    // and tell the team instead of retrying a sequence that may be half delivered.
    console.error("flow_run_failed", { runId: run.id, err });
    await finish(run.id, FlowRunStatus.STOPPED);
    await prisma.note.create({
      data: {
        organizationId: run.organizationId,
        contactId: run.conversation.contactId,
        content: `⚡ Funil "${run.flow.name}" parou: uma mensagem não pôde ser enviada. Continue o atendimento manualmente.`,
      },
    });
    publishRealtimeEvent({ type: "contact.updated", organizationId: run.organizationId, contactId: run.conversation.contactId });
  }
}

export function createFlowStepsWorker() {
  return new Worker<FlowStepJob>(
    QUEUE_FLOW_STEPS,
    async (job) => {
      await processFlowStep(job.data);
    },
    { connection: createRedisClient(), concurrency: 5 },
  );
}
