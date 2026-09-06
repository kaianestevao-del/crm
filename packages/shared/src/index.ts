export enum Role {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  AGENT = "AGENT",
}

// Per-Agent module access. OWNER/ADMIN always see every module regardless of this list — it
// only ever restricts AGENT accounts, one on/off switch per module (no separate view/edit
// distinction, by request).
export const MODULE_KEYS = ["inbox", "dashboard", "kanban", "autoatendimento"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  inbox: "Caixa de Entrada",
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
};

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

export interface JwtPayload {
  sub: string; // userId
  organizationId: string;
  role: Role;
}
