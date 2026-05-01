import { InMemoryActivityBus, type ActivityBus, type ActivityEvent } from "@praetor/core";
import { recordActivityEvent } from "./db.js";

/**
 * Process-wide activity bus. Tools running in the API process publish to
 * this bus; SSE clients subscribe to it. A single bus is fine here — every
 * event carries `missionId` and the SSE handler filters by user/mission.
 */
const BUS: ActivityBus = new InMemoryActivityBus();

/**
 * Returns the process-wide activity bus. World-gen tools and other
 * registries call `getActivityBus().publish(event)` as work progresses.
 */
export function getActivityBus(): ActivityBus {
  return BUS;
}

/**
 * Mounts the best-effort persistence subscriber. Called once during
 * `createApp()` so every event the bus sees lands in the
 * `activity_events` table for reconnect. Persistence failures are
 * swallowed — losing one event must not poison the live stream.
 */
let persistMounted = false;
export function mountActivityPersistence(resolveUserId: (missionId: string) => Promise<string | null>): void {
  if (persistMounted) return;
  persistMounted = true;
  BUS.subscribe((e: ActivityEvent) => {
    void persist(e, resolveUserId);
  });
}

async function persist(e: ActivityEvent, resolveUserId: (missionId: string) => Promise<string | null>): Promise<void> {
  try {
    const userId = await resolveUserId(e.missionId);
    if (!userId) return;
    await recordActivityEvent(userId, e);
  } catch {
    // Persistence is best-effort — failures must never break live delivery.
  }
}
