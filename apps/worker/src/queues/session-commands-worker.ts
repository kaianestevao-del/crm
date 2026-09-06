import { Worker } from "bullmq";
import { QUEUE_SESSION_COMMANDS, SessionCommandJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { startSession, restartSession, logoutSession, resyncLabels } from "../baileys/session-manager";

export function createSessionCommandsWorker() {
  return new Worker<SessionCommandJob>(
    QUEUE_SESSION_COMMANDS,
    async (job) => {
      const { sessionId, command, pairingPhoneNumber } = job.data;
      if (command === "START") return startSession(sessionId, pairingPhoneNumber);
      if (command === "RESTART") return restartSession(sessionId);
      if (command === "LOGOUT") return logoutSession(sessionId);
      if (command === "RESYNC_LABELS") return resyncLabels(sessionId);
    },
    { connection: createRedisClient() },
  );
}
