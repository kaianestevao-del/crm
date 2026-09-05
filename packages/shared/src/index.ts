export enum Role {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  AGENT = "AGENT",
}

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

export type SessionCommand = "START" | "LOGOUT" | "RESTART";

export interface SessionCommandJob {
  sessionId: string;
  command: SessionCommand;
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

export interface JwtPayload {
  sub: string; // userId
  organizationId: string;
  role: Role;
}
