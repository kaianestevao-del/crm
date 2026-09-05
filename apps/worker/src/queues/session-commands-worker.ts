import { Worker } from "bullmq";
import { QUEUE_SESSION_COMMANDS, SessionCommandJob } from "@crm/shared";
import { createRedisClient } from "../redis";
import { startSession, restartSession, logoutSession } from "../baileys/session-manager";

export function createSessionCommandsWorker() {
  return new Worker<SessionCommandJob>(
    QUEUE_SESSION_COMMANDS,
    async (job) => {
      const { sessionId, command } = job.data;
      if (command === "START") return startSession(sessionId);
      if (command === "RESTART") return restartSession(sessionId);
      if (command === "LOGOUT") return logoutSession(sessionId);
    },
    { connection: createRedisClient() },
  );
}
