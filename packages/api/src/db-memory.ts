/**
 * In-memory database adapter for Praetor API.
 *
 * Exports the same 11 named functions as db.ts / db-supabase.ts but backed
 * by in-process Maps. Data is lost on process restart — this is intentional;
 * the adapter exists for local dev and end-to-end testing without a real
 * Supabase project.
 *
 * Active when PRAETOR_DEV_MODE=1.
 */

import type { MissionRecord } from "./types.js";
import type { ActivityEvent } from "@praetor/core";

// ── Storage ──────────────────────────────────────────────────────────────────

/** All missions keyed by mission id. */
const missions = new Map<string, MissionRecord>();

/** Per-mission log lines in insertion order. */
const missionLogs = new Map<string, string[]>();

/** Per-user installed plugin names (ordered set via array). */
const pluginInstalls = new Map<string, string[]>();

/** Per-user activity events in insertion order. */
const activityEvents = new Map<string, ActivityEvent[]>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function userEventKey(userId: string): string {
  return userId;
}

// ── Mission operations ────────────────────────────────────────────────────────

export async function createMissionRow(input: {
  id: string;
  userId: string;
  goal: string;
  budget: number;
  charterJson: Record<string, unknown>;
}): Promise<MissionRecord> {
  const ts = now();
  const record: MissionRecord = {
    id: input.id,
    user_id: input.userId,
    status: "queued",
    goal: input.goal,
    budget: input.budget,
    charter_json: input.charterJson,
    created_at: ts,
    updated_at: ts,
  };
  missions.set(input.id, record);
  return record;
}

export async function updateMissionStatus(
  id: string,
  status: MissionRecord["status"],
): Promise<void> {
  const record = missions.get(id);
  if (!record) return; // Best-effort — consistent with Supabase adapter behaviour on unknown ids.
  record.status = status;
  record.updated_at = now();
}

export async function listMissions(userId: string): Promise<MissionRecord[]> {
  const all: MissionRecord[] = [];
  for (const m of missions.values()) {
    if (m.user_id === userId) all.push(m);
  }
  // Descending by created_at, limit 100 (mirrors Supabase adapter).
  all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return all.slice(0, 100);
}

export async function getMissionForUser(
  missionId: string,
  userId: string,
): Promise<MissionRecord | null> {
  const m = missions.get(missionId);
  if (!m || m.user_id !== userId) return null;
  return m;
}

export async function getMissionOwner(missionId: string): Promise<string | null> {
  return missions.get(missionId)?.user_id ?? null;
}

// ── Mission logs ──────────────────────────────────────────────────────────────

export async function appendMissionLog(missionId: string, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (!missionLogs.has(missionId)) missionLogs.set(missionId, []);
  missionLogs.get(missionId)!.push(trimmed);
}

export async function getMissionLogs(missionId: string): Promise<string[]> {
  return [...(missionLogs.get(missionId) ?? [])];
}

// ── Plugin installs ───────────────────────────────────────────────────────────

export async function listInstalledPlugins(userId: string): Promise<string[]> {
  return [...(pluginInstalls.get(userId) ?? [])];
}

export async function installPlugin(userId: string, pluginName: string): Promise<void> {
  if (!pluginInstalls.has(userId)) pluginInstalls.set(userId, []);
  const list = pluginInstalls.get(userId)!;
  // Idempotent — mirrors the "23505 unique violation swallowed" behaviour of
  // the Supabase adapter.
  if (!list.includes(pluginName)) list.push(pluginName);
}

// ── Activity events ───────────────────────────────────────────────────────────

export async function recordActivityEvent(userId: string, e: ActivityEvent): Promise<void> {
  const key = userEventKey(userId);
  if (!activityEvents.has(key)) activityEvents.set(key, []);
  activityEvents.get(key)!.push(e);
}

export async function getRecentActivity(
  userId: string,
  missionId: string,
  limit = 50,
): Promise<ActivityEvent[]> {
  const all = activityEvents.get(userEventKey(userId)) ?? [];
  // Filter to the given mission, preserve insertion order (oldest first),
  // return the last `limit` entries.
  const filtered = all.filter((e) => e.missionId === missionId);
  return filtered.slice(-limit);
}
