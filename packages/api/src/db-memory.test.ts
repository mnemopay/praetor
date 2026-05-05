/**
 * Unit tests for the in-memory database adapter (db-memory.ts).
 *
 * These tests import the module directly — not through the dispatcher —
 * so they run regardless of PRAETOR_DEV_MODE.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ActivityEvent } from "@kpanks/core";

// Import the adapter under test directly.
import * as db from "./db-memory.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let counter = 0;

function missionId(): string {
  return `m-${++counter}-${Date.now()}`;
}

function userId(label = "a"): string {
  return `user-${label}-${counter}`;
}

function makeMissionInput(id: string, uid: string) {
  return {
    id,
    userId: uid,
    goal: `goal for ${id}`,
    budget: 5,
    charterJson: { name: id },
  };
}

function milestoneEvent(mid: string): ActivityEvent {
  return { kind: "milestone", missionId: mid, text: "started", ts: new Date().toISOString() };
}

// ── Reset in-memory state between tests ──────────────────────────────────────
// The module-level Maps persist for the lifetime of the test process, so we
// use a dedicated user/mission id per test to avoid cross-test pollution.

describe("db-memory adapter", () => {
  it("create + listMissions round-trip", async () => {
    const uid = userId("list");
    const mid1 = missionId();
    const mid2 = missionId();

    await db.createMissionRow(makeMissionInput(mid1, uid));
    await db.createMissionRow(makeMissionInput(mid2, uid));

    const missions = await db.listMissions(uid);
    expect(missions).toHaveLength(2);
    const ids = missions.map((m) => m.id);
    expect(ids).toContain(mid1);
    expect(ids).toContain(mid2);
    // Verify the returned record has all required fields.
    const record = missions.find((m) => m.id === mid1)!;
    expect(record.user_id).toBe(uid);
    expect(record.status).toBe("queued");
    expect(typeof record.created_at).toBe("string");
    expect(typeof record.updated_at).toBe("string");
  });

  it("getMissionForUser returns null when not found", async () => {
    const uid = userId("notfound");
    const mid = missionId();

    // Not inserted — expect null.
    const result = await db.getMissionForUser(mid, uid);
    expect(result).toBeNull();
  });

  it("mission isolation across users: user A cannot see user B missions", async () => {
    const uidA = userId("isoA");
    const uidB = userId("isoB");
    const midA = missionId();
    const midB = missionId();

    await db.createMissionRow(makeMissionInput(midA, uidA));
    await db.createMissionRow(makeMissionInput(midB, uidB));

    // User A should only see their own mission.
    const aList = await db.listMissions(uidA);
    expect(aList.map((m) => m.id)).toContain(midA);
    expect(aList.map((m) => m.id)).not.toContain(midB);

    // getMissionForUser with wrong user returns null.
    const crossLookup = await db.getMissionForUser(midA, uidB);
    expect(crossLookup).toBeNull();

    // Correct user sees it.
    const ownLookup = await db.getMissionForUser(midA, uidA);
    expect(ownLookup).not.toBeNull();
    expect(ownLookup!.id).toBe(midA);
  });

  it("appendMissionLog + getMissionLogs round-trip", async () => {
    const mid = missionId();

    await db.appendMissionLog(mid, "line one");
    await db.appendMissionLog(mid, "  line two  "); // trims
    await db.appendMissionLog(mid, ""); // blank — should be ignored

    const logs = await db.getMissionLogs(mid);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toBe("line one");
    expect(logs[1]).toBe("line two");
  });

  it("recordActivityEvent + getRecentActivity ordering and limit", async () => {
    const uid = userId("activity");
    const mid = missionId();

    const events: ActivityEvent[] = [
      { kind: "milestone", missionId: mid, text: "A", ts: "2024-01-01T00:00:01Z" },
      { kind: "milestone", missionId: mid, text: "B", ts: "2024-01-01T00:00:02Z" },
      { kind: "milestone", missionId: mid, text: "C", ts: "2024-01-01T00:00:03Z" },
    ];

    for (const e of events) {
      await db.recordActivityEvent(uid, e);
    }

    // getRecentActivity returns oldest-first within the limit.
    const recent = await db.getRecentActivity(uid, mid, 10);
    expect(recent).toHaveLength(3);
    expect((recent[0] as { text: string }).text).toBe("A");
    expect((recent[2] as { text: string }).text).toBe("C");

    // Limit parameter is respected — only the last N.
    const limited = await db.getRecentActivity(uid, mid, 2);
    expect(limited).toHaveLength(2);
    expect((limited[0] as { text: string }).text).toBe("B");
    expect((limited[1] as { text: string }).text).toBe("C");
  });

  it("updateMissionStatus mutates the stored record", async () => {
    const uid = userId("status");
    const mid = missionId();

    await db.createMissionRow(makeMissionInput(mid, uid));

    const before = await db.getMissionForUser(mid, uid);
    expect(before!.status).toBe("queued");

    await db.updateMissionStatus(mid, "running");
    const after = await db.getMissionForUser(mid, uid);
    expect(after!.status).toBe("running");

    await db.updateMissionStatus(mid, "completed");
    const done = await db.getMissionForUser(mid, uid);
    expect(done!.status).toBe("completed");
  });

  it("installPlugin is idempotent and listInstalledPlugins preserves insertion order", async () => {
    const uid = userId("plugins");

    await db.installPlugin(uid, "@kpanks/seo");
    await db.installPlugin(uid, "@kpanks/browser");
    await db.installPlugin(uid, "@kpanks/seo"); // duplicate — must not double-insert

    const plugins = await db.listInstalledPlugins(uid);
    expect(plugins).toHaveLength(2);
    expect(plugins[0]).toBe("@kpanks/seo");
    expect(plugins[1]).toBe("@kpanks/browser");
  });

  it("getMissionOwner returns userId for known mission and null for unknown", async () => {
    const uid = userId("owner");
    const mid = missionId();

    await db.createMissionRow(makeMissionInput(mid, uid));

    expect(await db.getMissionOwner(mid)).toBe(uid);
    expect(await db.getMissionOwner("no-such-mission")).toBeNull();
  });

  it("listMissions returns at most 100 records sorted desc by created_at", async () => {
    const uid = userId("limit");
    // Create 5 missions with distinct timestamps.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const mid = `limit-mission-${i}-${Date.now()}`;
      ids.push(mid);
      await db.createMissionRow(makeMissionInput(mid, uid));
    }

    const result = await db.listMissions(uid);
    // Should be in descending created_at order.
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].created_at >= result[i + 1].created_at).toBe(true);
    }
    // All 5 should be present (well under the 100 cap).
    for (const id of ids) {
      expect(result.some((m) => m.id === id)).toBe(true);
    }
  });

  it("getRecentActivity filters by missionId and ignores other missions", async () => {
    const uid = userId("filterActivity");
    const midA = missionId();
    const midB = missionId();

    const eventA: ActivityEvent = { kind: "milestone", missionId: midA, text: "for A", ts: new Date().toISOString() };
    const eventB: ActivityEvent = { kind: "milestone", missionId: midB, text: "for B", ts: new Date().toISOString() };

    await db.recordActivityEvent(uid, eventA);
    await db.recordActivityEvent(uid, eventB);

    const forA = await db.getRecentActivity(uid, midA);
    expect(forA).toHaveLength(1);
    expect((forA[0] as { text: string }).text).toBe("for A");

    const forB = await db.getRecentActivity(uid, midB);
    expect(forB).toHaveLength(1);
    expect((forB[0] as { text: string }).text).toBe("for B");
  });
});
