import { REALTIME_CHANNEL, RealtimeEvent } from "@crm/shared";
import { createRedisClient } from "./redis";

const publisher = createRedisClient();

// Mirrors apps/worker/src/pubsub.ts — each app owns its own Redis connection, so the API
// publishes its own realtime events (e.g. markAsRead) the same way the worker does for
// everything WhatsApp-sourced, instead of reaching across the app boundary.
export function publishRealtimeEvent(event: RealtimeEvent) {
  publisher.publish(REALTIME_CHANNEL, JSON.stringify(event)).catch((err) => {
    console.error("failed_to_publish_realtime_event", err);
  });
}
