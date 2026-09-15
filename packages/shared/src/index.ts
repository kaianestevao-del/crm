export enum Role {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  AGENT = "AGENT",
}

// Per-Agent module access. OWNER/ADMIN always see every module regardless of this list — it
// only ever restricts AGENT accounts, one on/off switch per module (no separate view/edit
// distinction, by request).
export const MODULE_KEYS = ["inbox", "contacts", "dashboard", "kanban", "autoatendimento"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  inbox: "Caixa de Entrada",
  contacts: "Contatos",
  dashboard: "Dashboard",
  kanban: "Funil",
  autoatendimento: "Autoatendimento",
};

// What a pipeline stage means for Dashboard metrics, independent of its display name (each
// org names its own stages) — assigned by the owner in Configurações.
export const PIPELINE_STAGE_ROLES = ["FOLLOW_UP", "UNFOLLOW", "ACTIVE_PATIENT", "LOST_PATIENT"] as const;
export type PipelineStageRole = (typeof PIPELINE_STAGE_ROLES)[number];
export const PIPELINE_STAGE_ROLE_LABELS: Record<PipelineStageRole, string> = {
  FOLLOW_UP: "Follow-up",
  UNFOLLOW: "Perdido (Unfollow)",
  ACTIVE_PATIENT: "Paciente Ativa",
  LOST_PATIENT: "Paciente Vencida",
};

// What a Deal's value refers to — set together with the value itself, from the conversation.
export const PLAN_TYPES = [
  "MENSAL",
  "TRIMESTRAL",
  "SEMESTRAL",
  "ANUAL",
  "DESAFIO_7",
  "DESAFIO_14",
  "DESAFIO_21",
  "DESAFIO_30",
  "AVULSO",
] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  MENSAL: "Mensal",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
  DESAFIO_7: "Desafio de 7 dias",
  DESAFIO_14: "Desafio de 14 dias",
  DESAFIO_21: "Desafio de 21 dias",
  DESAFIO_30: "Desafio de 30 dias",
  AVULSO: "Comprou avulso",
};

export const PAYMENT_METHODS = ["CREDIT_CARD", "PIX"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CREDIT_CARD: "Cartão de Crédito",
  PIX: "Pix",
};

// A contact's arrival month is stored as a single "Mês/Ano" Tag (e.g. "Setembro/2026") — set
// automatically by the worker on first contact, and editable from the Timeline picker in the
// conversation view. Shared so the worker (auto-tagging), API (Dashboard cohort query) and web
// (Timeline picker, and filtering these out of the generic tag dropdown) all agree on the format.
export const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const;

export function isMonthYearTagName(name: string): boolean {
  return new RegExp(`^(${MONTH_NAMES_PT.join("|")})/\\d{4}$`).test(name);
}

// Canonical acquisition-channel tags, applied from the Timeline picker (a contact can carry
// more than one — they may have reached out through different channels over time). Anything
// else falls into the Dashboard's "Outra origem" bucket.
export const ORIGIN_TAGS_PT = [
  "Link na Bio do Instagram",
  "Social Selling Instagram",
  "Social Selling WhatsApp",
  "Site",
  "Tráfego Pago",
  "Diagnóstico Nutricional",
  "Indicação",
  "Parcerias Médicas",
] as const;

export enum SessionStatus {
  PENDING = "PENDING",
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
  LOGGED_OUT = "LOGGED_OUT",
}

export enum MessageDirection {
  INBOUND = "INBOUND",
  OUTBOUND = "OUTBOUND",
}

export enum MessageType {
  TEXT = "TEXT",
  IMAGE = "IMAGE",
  AUDIO = "AUDIO",
  VIDEO = "VIDEO",
  DOCUMENT = "DOCUMENT",
  STICKER = "STICKER",
  CONTACT = "CONTACT",
  LOCATION = "LOCATION",
  UNKNOWN = "UNKNOWN",
}

export enum MessageStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  READ = "READ",
  FAILED = "FAILED",
}

// Redis pub/sub channel used by the worker to notify the API of realtime events,
// which the API then relays to connected browser clients over Socket.IO.
export const REALTIME_CHANNEL = "crm:realtime";

// `status` is a plain string (not the SessionStatus enum) because these events cross a
// JSON serialization boundary (worker -> Redis -> API -> Socket.IO); the worker's copy of
// SessionStatus comes from the generated Prisma client, which is a structurally-compatible
// but nominally distinct type from the enum declared in this file.
export type RealtimeEvent =
  | { type: "session.qr"; organizationId: string; sessionId: string; qr: string }
  | { type: "session.pairingCode"; organizationId: string; sessionId: string; pairingCode: string }
  | { type: "session.status"; organizationId: string; sessionId: string; status: string; phoneNumber?: string | null }
  | { type: "message.new"; organizationId: string; conversationId: string; message: unknown }
  | { type: "message.updated"; organizationId: string; conversationId: string; message: unknown }
  | { type: "conversation.updated"; organizationId: string; conversationId: string }
  | { type: "contact.updated"; organizationId: string; contactId: string };

// BullMQ queue names shared between the API (producer) and the worker (consumer).
export const QUEUE_OUTBOUND_MESSAGES = "outbound-messages";
export const QUEUE_SESSION_COMMANDS = "session-commands";
// Raw Meta webhook payloads land here (from the API's public webhook route) so the actual
// Contact/Conversation/Message writes happen in the worker, same as every other WhatsApp event.
export const QUEUE_INBOUND_CLOUD_MESSAGES = "inbound-cloud-messages";
// Producer and consumer both live in the worker process (it's the only one with access to
// the org's Groq key and the audio files), but the queue name is still shared so the API
// could enqueue directly in the future without going through the worker's HTTP surface.
export const QUEUE_TRANSCRIBE_AUDIO = "transcribe-audio";

export interface TranscribeAudioJob {
  organizationId: string;
  messageId: string;
  // Absolute URL the audio file can be fetched from (see OutboundMessageJob.mediaUrl).
  mediaUrl: string;
}

export interface OutboundMessageJob {
  organizationId: string;
  sessionId: string;
  conversationId: string;
  messageId: string;
  waJid: string;
  text?: string;
  // Absolute URL (e.g. http://api-host:4000/uploads/...) so the worker process — which may
  // run on a different host than the API — can fetch the file regardless of where it's hosted.
  mediaUrl?: string;
  mediaType?: MessageType;
  mediaName?: string;
}

// A multi-step quick reply (e.g. text, then a document, then a follow-up text) is sent as
// one job with job.name "send-sequence" instead of several separate "send" jobs — the
// outbound queue's concurrency (multiple *different* jobs run in parallel) would otherwise
// not guarantee these parts arrive to the customer in the order they were configured.
export interface OutboundMessageSequenceJob {
  organizationId: string;
  sessionId: string;
  conversationId: string;
  waJid: string;
  steps: Omit<OutboundMessageJob, "organizationId" | "sessionId" | "conversationId" | "waJid">[];
}

export interface InboundCloudMessageJob {
  sessionId: string;
  organizationId: string;
  // Raw `entry[].changes[].value` object from Meta's webhook POST — parsed in the worker,
  // which is also where the Cloud API credentials needed to resolve media live.
  payload: unknown;
}

export const WHATSAPP_PROVIDERS = ["BAILEYS", "CLOUD_API"] as const;
export type WhatsappProvider = (typeof WHATSAPP_PROVIDERS)[number];

export type SessionCommand = "START" | "LOGOUT" | "RESTART" | "RESYNC_LABELS";

export interface SessionCommandJob {
  sessionId: string;
  command: SessionCommand;
  // START only: request a pairing code for this phone number instead of a scannable QR code —
  // for a team member linking a number remotely, the way WhatsApp Web's own "link with phone
  // number" flow works.
  pairingPhoneNumber?: string;
}

// Mirrors WhatsApp's own native Business labels via Baileys (addChatLabel/removeChatLabel/
// addLabel). Fire-and-forget: the worker performs the action, and Baileys' own
// `labels.edit`/`labels.association` events are what actually update our database — the API
// never writes WhatsappLabel rows directly, only WhatsApp's own confirmation does.
export const QUEUE_LABEL_COMMANDS = "label-commands";

export type LabelCommandJob =
  | { action: "add"; sessionId: string; waJid: string; waLabelId: string }
  | { action: "remove"; sessionId: string; waJid: string; waLabelId: string }
  | { action: "create"; sessionId: string; name: string; color?: number };

// A single scheduled message tied to one conversation (never a bulk/broadcast send — this
// product deliberately has no mass-campaign feature). The API enqueues this as a delayed
// BullMQ job (jobId = the ScheduledMessage row's id, so it can be cancelled by removing the
// job); the worker looks the row up by id when the delay elapses and sends it then.
export const QUEUE_SCHEDULED_MESSAGES = "scheduled-messages";

export interface ScheduledMessageJob {
  scheduledMessageId: string;
}

// Fires on a cron schedule (see daily-backup-worker.ts) — no payload needed, the processor
// always dumps the whole database fresh.
export const QUEUE_DAILY_BACKUP = "daily-backup";

export interface JwtPayload {
  sub: string; // userId
  organizationId: string;
  role: Role;
}
