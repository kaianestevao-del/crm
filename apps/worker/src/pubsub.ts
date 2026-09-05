import { REALTIME_CHANNEL, RealtimeEvent } from "@crm/shared";
import { createRedisClient } from "./redis";

const publisher = createRedisClient();

export function publishRealtimeEvent(event: RealtimeEvent) {
  publisher.publish(REALTIME_CHANNEL, JSON.stringify(event)).catch((err) => {
    console.error("failed_to_publish_realtime_event", err);
  });
}
