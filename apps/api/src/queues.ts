import { Queue } from "bullmq";
import {
  QUEUE_OUTBOUND_MESSAGES,
  QUEUE_SESSION_COMMANDS,
  QUEUE_LABEL_COMMANDS,
  QUEUE_SCHEDULED_MESSAGES,
  QUEUE_INBOUND_CLOUD_MESSAGES,
  QUEUE_CAMPAIGN_DISPATCH,
  OutboundMessageJob,
  OutboundMessageSequenceJob,
  SessionCommandJob,
  LabelCommandJob,
  ScheduledMessageJob,
  InboundCloudMessageJob,
  CampaignDispatchJob,
} from "@crm/shared";
import { createRedisClient } from "./redis";

const connection = createRedisClient();

// Safe to retry: sendOutboundMessage only lets a genuine send failure (never a later DB-write
// hiccup after WhatsApp/Meta already accepted the message) reach BullMQ as a job failure, so a
// retry here can never resend something the customer already received.
export const outboundMessagesQueue = new Queue<OutboundMessageJob | OutboundMessageSequenceJob>(QUEUE_OUTBOUND_MESSAGES, {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 } },
});
export const sessionCommandsQueue = new Queue<SessionCommandJob>(QUEUE_SESSION_COMMANDS, { connection });
export const labelCommandsQueue = new Queue<LabelCommandJob>(QUEUE_LABEL_COMMANDS, { connection });
export const scheduledMessagesQueue = new Queue<ScheduledMessageJob>(QUEUE_SCHEDULED_MESSAGES, { connection });
export const inboundCloudMessagesQueue = new Queue<InboundCloudMessageJob>(QUEUE_INBOUND_CLOUD_MESSAGES, { connection });
export const campaignDispatchQueue = new Queue<CampaignDispatchJob>(QUEUE_CAMPAIGN_DISPATCH, { connection });
