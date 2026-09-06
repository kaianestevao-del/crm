import { Queue } from "bullmq";
import {
  QUEUE_OUTBOUND_MESSAGES,
  QUEUE_SESSION_COMMANDS,
  QUEUE_LABEL_COMMANDS,
  QUEUE_SCHEDULED_MESSAGES,
  QUEUE_INBOUND_CLOUD_MESSAGES,
  OutboundMessageJob,
  SessionCommandJob,
  LabelCommandJob,
  ScheduledMessageJob,
  InboundCloudMessageJob,
} from "@crm/shared";
import { createRedisClient } from "./redis";

const connection = createRedisClient();

export const outboundMessagesQueue = new Queue<OutboundMessageJob>(QUEUE_OUTBOUND_MESSAGES, { connection });
export const sessionCommandsQueue = new Queue<SessionCommandJob>(QUEUE_SESSION_COMMANDS, { connection });
export const labelCommandsQueue = new Queue<LabelCommandJob>(QUEUE_LABEL_COMMANDS, { connection });
export const scheduledMessagesQueue = new Queue<ScheduledMessageJob>(QUEUE_SCHEDULED_MESSAGES, { connection });
export const inboundCloudMessagesQueue = new Queue<InboundCloudMessageJob>(QUEUE_INBOUND_CLOUD_MESSAGES, { connection });
