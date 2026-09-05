import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { REALTIME_CHANNEL, RealtimeEvent } from "@crm/shared";
import { env } from "./env";
import { verifyJwt } from "./utils/jwt";
import { createRedisClient } from "./redis";

export function setupRealtime(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("missing_token"));
    try {
      const payload = verifyJwt(token);
      socket.data.organizationId = payload.organizationId;
      next();
    } catch {
      next(new Error("invalid_token"));
    }
  });

  io.on("connection", (socket) => {
    const organizationId = socket.data.organizationId as string;
    socket.join(`org:${organizationId}`);
  });

  const subscriber = createRedisClient();
  subscriber.subscribe(REALTIME_CHANNEL).catch((err) => console.error("redis_subscribe_error", err));

  subscriber.on("message", (_channel, raw) => {
    try {
      const event = JSON.parse(raw) as RealtimeEvent;
      io.to(`org:${event.organizationId}`).emit(event.type, event);
    } catch (err) {
      console.error("realtime_event_parse_error", err);
    }
  });

  return io;
}
