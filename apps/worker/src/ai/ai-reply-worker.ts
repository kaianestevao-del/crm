import { Queue, Worker } from "bullmq";
import { getPrismaClient, Message } from "@crm/db";
import {
  QUEUE_AI_REPLIES,
  QUEUE_OUTBOUND_MESSAGES,
  AiReplyJob,
  OutboundMessageJob,
  MessageDirection,
  MessageStatus,
  MessageType,
} from "@crm/shared";
import {
  AiError,
  AiStage,
  AiTurn,
  allowedUrls,
  buildConversationContext,
  buildSystemPrompt,
  findActivationKeyword,
  findUnknownUrl,
  generateAiReply,
} from "@crm/ai";
import { createRedisClient } from "../redis";
import { publishRealtimeEvent } from "../pubsub";
import { isContactTyping } from "./typing";
import { hasActiveFlowRun } from "../flows/flow-inbound";

const prisma = getPrismaClient();

const aiRepliesQueue = new Queue<AiReplyJob>(QUEUE_AI_REPLIES, { connection: createRedisClient() });
const outboundMessagesQueue = new Queue<OutboundMessageJob>(QUEUE_OUTBOUND_MESSAGES, { connection: createRedisClient() });

// Guard rails — the assistant must never run away with a conversation:
// - it waits 30s to 1min (random, so it doesn't feel like a bot) after the last inbound message,
//   so several short messages get one reply...
const DEBOUNCE_MIN_MS = 30_000;
const DEBOUNCE_MAX_MS = 60_000;
// - ...and while the customer is typing it keeps pushing the reply back, up to a limit;
const TYPING_RECHECK_MS = 10_000;
const MAX_TYPING_WAITS = 12;
// - at most this many replies per conversation in 24h, then it hands off to the team;
const MAX_REPLIES_PER_DAY = 25;
// - a reply longer than this is not sent (hand off instead) — real replies are a few lines;
const MAX_REPLY_CHARS = 1200;
// - an expired patient's conversation only switches itself on if no attendant wrote in this window.
const ATTENDANT_QUIET_MS = 12 * 60 * 60 * 1000;
// How much of the conversation the assistant reads.
const HISTORY_LIMIT = 40;

// How long "digitando…" shows before a reply goes out — roughly typing speed, within bounds.
function typingDuration(text: string) {
  return Math.min(8_000, Math.max(2_000, text.length * 30));
}

// Called for every live inbound message, right after it's recorded. Applies the keyword's origin
// tag, switches the assistant on for the conversation when the message matches an activation
// phrase, and schedules the (debounced) reply. Never sends anything itself. Returns whether a
// reply was scheduled.
export async function onInboundMessageForAi(organizationId: string, conversationId: string, contactId: string, message: Message) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiEnabled: true, anthropicApiKey: true, aiKeywords: true },
  });
  if (!org) return false;

  const keyword = message.content ? findActivationKeyword(message.content, org.aiKeywords) : null;
  if (keyword?.origin) await tagContact(organizationId, contactId, keyword.origin);

  if (!org.aiEnabled || !org.anthropicApiKey) return false;

  if (keyword) {
    // Only an automatic (null) conversation is switched on by a keyword — one an attendant or the
    // Inbox toggle switched off stays off.
    const switched = await prisma.conversation.updateMany({ where: { id: conversationId, aiEnabled: null }, data: { aiEnabled: true } });
    if (switched.count) publishRealtimeEvent({ type: "conversation.updated", organizationId, conversationId });
  }

  const delay = DEBOUNCE_MIN_MS + Math.floor(Math.random() * (DEBOUNCE_MAX_MS - DEBOUNCE_MIN_MS));
  await aiRepliesQueue.add(
    "reply",
    { organizationId, conversationId, messageId: message.id },
    { delay, jobId: `ai-${message.id}`, removeOnComplete: true, removeOnFail: 200 },
  );
  return true;
}

// Pushes the reply back a few seconds because the customer is still typing. False once it already
// waited long enough — then it answers anyway (a stuck "composing" must not silence it forever).
async function waitForTyping(job: AiReplyJob, sessionId: string, waJid: string) {
  const waits = job.typingWaits ?? 0;
  if (waits >= MAX_TYPING_WAITS || !isContactTyping(sessionId, waJid)) return false;
  await aiRepliesQueue.add(
    "reply",
    { ...job, typingWaits: waits + 1 },
    { delay: TYPING_RECHECK_MS, jobId: `ai-${job.messageId}-t${waits + 1}`, removeOnComplete: true, removeOnFail: 200 },
  );
  return true;
}

async function tagContact(organizationId: string, contactId: string, tagName: string) {
  const tag = await prisma.tag.upsert({
    where: { organizationId_name: { organizationId, name: tagName } },
    update: {},
    create: { organizationId, name: tagName },
  });
  await prisma.contactTag.createMany({ data: [{ contactId, tagId: tag.id }], skipDuplicates: true });
  publishRealtimeEvent({ type: "contact.updated", organizationId, contactId });
}

// What the assistant "sees" for each message — media it can't open is described, so it knows to
// hand off instead of pretending it read it.
function turnText(m: Message): string {
  const caption = m.content?.trim();
  switch (m.type) {
    case MessageType.TEXT:
      return caption ?? "";
    case MessageType.AUDIO:
      return m.transcript?.trim() ? `(áudio transcrito) ${m.transcript.trim()}` : "[enviou um áudio que não foi transcrito]";
    case MessageType.IMAGE:
      return caption ? `[enviou uma foto] ${caption}` : "[enviou uma foto]";
    case MessageType.VIDEO:
      return caption ? `[enviou um vídeo] ${caption}` : "[enviou um vídeo]";
    case MessageType.DOCUMENT:
      return caption ? `[enviou um documento] ${caption}` : "[enviou um documento]";
    case MessageType.STICKER:
      return "[enviou uma figurinha]";
    default:
      return caption ? caption : "[enviou uma mensagem que não dá para ler]";
  }
}

async function processAiReply(job: AiReplyJob) {
  const { organizationId, conversationId, messageId } = job;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conversation) return;

  // Debounce: only the newest message's job answers. If anything came after this message (more
  // messages from the customer, or an attendant's reply), this job steps aside.
  const latest = await prisma.message.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" } });
  if (latest?.id !== messageId) return;

  if (await waitForTyping(job, conversation.whatsappSessionId, conversation.contact.waJid)) return;

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!org.aiEnabled || !org.anthropicApiKey) return;
  if (conversation.aiEnabled === false) return;
  // A Funil flow started after this reply was scheduled — the flow has the conversation now.
  if (await hasActiveFlowRun(conversationId)) return;

  const deal = await prisma.deal.findFirst({
    where: { organizationId, contactId: conversation.contactId },
    orderBy: { createdAt: "desc" },
    include: { stage: true },
  });
  // An active patient is the team's — the assistant never talks to her.
  if (deal?.stage.role === "ACTIVE_PATIENT") return;
  const expiredPatient = deal?.stage.role === "LOST_PATIENT";

  if (conversation.aiEnabled === null) {
    // Not switched on by a keyword or the toggle. The one automatic case: an expired patient
    // writing back (renewal), and only if nobody from the team has been talking to her lately.
    if (!expiredPatient) return;
    const recentAttendant = await prisma.message.findFirst({
      where: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        sentByAi: false,
        createdAt: { gte: new Date(Date.now() - ATTENDANT_QUIET_MS) },
      },
    });
    if (recentAttendant) return;
    await prisma.conversation.update({ where: { id: conversationId }, data: { aiEnabled: true } });
  }

  const repliesToday = await prisma.message.count({
    where: { conversationId, sentByAi: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  if (repliesToday >= MAX_REPLIES_PER_DAY) {
    await handOff(organizationId, conversationId, conversation.contactId, "Limite de respostas automáticas do dia atingido.");
    return;
  }

  const history = await prisma.message.findMany({
    where: { conversationId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const turns: AiTurn[] = history
    .reverse()
    .map((m) => ({ role: m.direction === MessageDirection.INBOUND ? ("customer" as const) : ("assistant" as const), text: turnText(m) }))
    .filter((t) => t.text);

  const [plans, links] = await Promise.all([
    prisma.aiPlan.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.aiLink.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
  ]);
  const schedulingUrl = org.aiSchedulingEnabled && org.aiSchedulingUrl?.trim() ? org.aiSchedulingUrl.trim() : null;
  const systemPrompt = buildSystemPrompt(org.name, org.aiPrompt, plans, links, schedulingUrl);
  const context = buildConversationContext({
    contactName: conversation.contact.name,
    objective: conversation.contact.objective,
    expiredPatient,
  });

  let reply;
  try {
    reply = await generateAiReply(org.anthropicApiKey, systemPrompt, turns, context);
  } catch (err) {
    console.error("ai_reply_failed", { conversationId, error: err instanceof AiError ? err.code : err });
    await handOff(organizationId, conversationId, conversation.contactId, "A IA não conseguiu responder (erro técnico). Responda manualmente.");
    return;
  }

  // Last checks before anything reaches the customer.
  let blocked: string | null = null;
  if (!reply.reply && !reply.handoff) blocked = "A IA gerou uma resposta vazia.";
  else if (reply.reply.length > MAX_REPLY_CHARS) blocked = "A IA gerou uma resposta longa demais.";
  else if (findUnknownUrl(reply.reply, allowedUrls(plans, links, schedulingUrl))) blocked = "A IA tentou enviar um link que não está cadastrado.";
  if (blocked) {
    console.error("ai_reply_blocked", { conversationId, blocked, reply: reply.reply });
    await handOff(organizationId, conversationId, conversation.contactId, blocked);
    return;
  }

  // The Claude call takes a few seconds — if someone wrote meanwhile, or the assistant was switched
  // off, drop this reply (a newer job, if any, answers with the full picture).
  const [stillLatest, fresh] = await Promise.all([
    prisma.message.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.conversation.findUnique({ where: { id: conversationId }, select: { aiEnabled: true } }),
  ]);
  if (stillLatest?.id !== messageId || fresh?.aiEnabled === false) return;
  // She started typing while the reply was being written — ask again once she's done, with
  // whatever she adds.
  if (await waitForTyping(job, conversation.whatsappSessionId, conversation.contact.waJid)) return;

  if (reply.reply) await sendAiMessage(organizationId, conversation, reply.reply);

  if (reply.objective && reply.objective !== conversation.contact.objective) {
    await prisma.contact.update({ where: { id: conversation.contactId }, data: { objective: reply.objective.slice(0, 200) } });
    publishRealtimeEvent({ type: "contact.updated", organizationId, contactId: conversation.contactId });
  }

  await advanceDeal(org, conversation.contactId, conversation.contact.name ?? conversation.contact.phoneNumber, reply.stage).catch((err) =>
    console.error("ai_advance_deal_failed", err),
  );

  if (reply.handoff) await handOff(organizationId, conversationId, conversation.contactId, reply.handoffReason || "A IA transferiu a conversa.");
}

async function sendAiMessage(
  organizationId: string,
  conversation: { id: string; whatsappSessionId: string; contact: { waJid: string } },
  text: string,
) {
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      content: text,
      status: MessageStatus.PENDING,
      sentByAi: true,
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  publishRealtimeEvent({ type: "message.new", organizationId, conversationId: conversation.id, message });
  publishRealtimeEvent({ type: "conversation.updated", organizationId, conversationId: conversation.id });

  // Cloud API shows "digitando…" against her last message.
  const lastInbound = await prisma.message.findFirst({
    where: { conversationId: conversation.id, direction: MessageDirection.INBOUND, waMessageId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { waMessageId: true },
  });

  await outboundMessagesQueue.add("send", {
    organizationId,
    sessionId: conversation.whatsappSessionId,
    conversationId: conversation.id,
    messageId: message.id,
    waJid: conversation.contact.waJid,
    text,
    typingMs: typingDuration(text),
    typingForWaMessageId: lastInbound?.waMessageId ?? undefined,
  });
}

// Switches the assistant off for this conversation and leaves the reason as a note on the contact,
// with the conversation marked unread so the team sees it.
async function handOff(organizationId: string, conversationId: string, contactId: string, reason: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { aiEnabled: false, unreadCount: { increment: 1 }, status: "OPEN" },
  });
  await prisma.note.create({ data: { organizationId, contactId, content: `🤖 IA transferiu a conversa: ${reason}` } });
  publishRealtimeEvent({ type: "conversation.updated", organizationId, conversationId });
  publishRealtimeEvent({ type: "contact.updated", organizationId, contactId });
}

// Moves the lead along the stages picked in the AI tab — only forward, and only while the deal is
// in one of those stages (a deal the team put anywhere else is never touched). A contact with no
// deal yet gets one in the matching stage.
async function advanceDeal(
  org: { id: string; aiStageStartId: string | null; aiStageQualifyingId: string | null; aiStageNegotiationId: string | null },
  contactId: string,
  title: string,
  stage: AiStage,
) {
  const sequence = [org.aiStageStartId, org.aiStageQualifyingId, org.aiStageNegotiationId];
  const targetIndex = ["inicio", "qualificando", "negociacao"].indexOf(stage);
  // The furthest configured stage at or before the reported one.
  let targetId: string | null = null;
  for (let i = targetIndex; i >= 0 && !targetId; i--) targetId = sequence[i];
  if (!targetId) return;

  const target = await prisma.pipelineStage.findFirst({ where: { id: targetId, pipeline: { organizationId: org.id } } });
  if (!target) return;

  const deal = await prisma.deal.findFirst({ where: { organizationId: org.id, contactId }, orderBy: { createdAt: "desc" } });
  const lastInColumn = await prisma.deal.findFirst({ where: { stageId: target.id }, orderBy: { order: "desc" } });
  const order = (lastInColumn?.order ?? -1) + 1;

  if (!deal) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: { organizationId: org.id, pipelineId: target.pipelineId, stageId: target.id, contactId, title, order },
      });
      await tx.dealStageHistory.create({ data: { dealId: created.id, stageId: target.id, enteredAt: created.createdAt } });
    });
    return;
  }

  const currentIndex = sequence.indexOf(deal.stageId);
  if (currentIndex < 0 || sequence.indexOf(target.id) <= currentIndex) return;

  // Same bookkeeping as pipelines.controller.ts transitionDealStage, so the Dashboard's
  // time-in-stage metrics stay right.
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.deal.update({ where: { id: deal.id }, data: { stageId: target.id, pipelineId: target.pipelineId, order } });
    await tx.dealStageHistory.updateMany({ where: { dealId: deal.id, stageId: deal.stageId, exitedAt: null }, data: { exitedAt: now } });
    await tx.dealStageHistory.create({ data: { dealId: deal.id, stageId: target.id, enteredAt: now } });
  });
}

export function createAiReplyWorker() {
  return new Worker<AiReplyJob>(
    QUEUE_AI_REPLIES,
    async (job) => {
      await processAiReply(job.data);
    },
    // One reply at a time per worker slot is plenty; failures are logged and handed off above, so
    // BullMQ never retries a reply that might already have been sent.
    { connection: createRedisClient(), concurrency: 5 },
  );
}
