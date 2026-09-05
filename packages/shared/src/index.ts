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

export enum CampaignStatus {
  DRAFT = "DRAFT",
  RUNNING = "RUNNING",
  DONE = "DONE",
  FAILED = "FAILED",
}

export enum CampaignRecipientStatus {
  PENDING = "PENDING",
  SENT = "SENT",
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
  | { type: "conversation.updated"; organizationId: string; conversationId: string };

// BullMQ queue names shared between the API (producer) and the worker (consumer).
export const QUEUE_OUTBOUND_MESSAGES = "outbound-messages";
export const QUEUE_CAMPAIGN_JOBS = "campaign-jobs";
export const QUEUE_SESSION_COMMANDS = "session-commands";

export interface OutboundMessageJob {
  organizationId: string;
  sessionId: string;
  conversationId: string;
  messageId: string;
  waJid: string;
  text: string;
}

export interface CampaignJob {
  organizationId: string;
  campaignId: string;
}

export type SessionCommand = "START" | "LOGOUT" | "RESTART";

export interface SessionCommandJob {
  sessionId: string;
  command: SessionCommand;
}

export interface JwtPayload {
  sub: string; // userId
  organizationId: string;
  role: Role;
}
