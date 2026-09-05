import { Worker } from "bullmq";
import { QUEUE_LABEL_COMMANDS, LabelCommandJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { addWhatsappLabelToChat, removeWhatsappLabelFromChat, createWhatsappLabel } from "../baileys/session-manager";

export function createLabelCommandsWorker() {
  return new Worker<LabelCommandJob>(
    QUEUE_LABEL_COMMANDS,
    async (job) => {
      const data = job.data;
      if (data.action === "add") return addWhatsappLabelToChat(data.sessionId, data.waJid, data.waLabelId);
      if (data.action === "remove") return removeWhatsappLabelFromChat(data.sessionId, data.waJid, data.waLabelId);
      if (data.action === "create") return createWhatsappLabel(data.sessionId, data.name, data.color);
    },
    { connection: createRedisClient() },
  );
}
