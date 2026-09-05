import { Queue } from "bullmq";
import {
  QUEUE_OUTBOUND_MESSAGES,
  QUEUE_CAMPAIGN_JOBS,
  QUEUE_SESSION_COMMANDS,
  QUEUE_LABEL_COMMANDS,
  OutboundMessageJob,
  CampaignJob,
  SessionCommandJob,
  LabelCommandJob,
} from "@crm/shared";
import { createRedisClient } from "./redis";

const connection = createRedisClient();

export const outboundMessagesQueue = new Queue<OutboundMessageJob>(QUEUE_OUTBOUND_MESSAGES, { connection });
export const campaignJobsQueue = new Queue<CampaignJob>(QUEUE_CAMPAIGN_JOBS, { connection });
export const sessionCommandsQueue = new Queue<SessionCommandJob>(QUEUE_SESSION_COMMANDS, { connection });
export const labelCommandsQueue = new Queue<LabelCommandJob>(QUEUE_LABEL_COMMANDS, { connection });
