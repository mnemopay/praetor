import type { MissionRecord } from "./types.js";
import type { ActivityEvent } from "@praetor/core";
import { supabaseAdmin } from "./supabase.js";

export async function createMissionRow(input: {
  id: string;
  userId: string;
  goal: string;
  budget: number;
  charterJson: Record<string, unknown>;
}): Promise<MissionRecord> {
  const { data, error } = await supabaseAdmin()
    .from("missions")
    .insert({
      id: input.id,
      user_id: input.userId,
      status: "queued",
      goal: input.goal,
      budget: input.budget,
      charter_json: input.charterJson,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as MissionRecord;
}

export async function updateMissionStatus(id: string, status: MissionRecord["status"]): Promise<void> {
  const { error } = await supabaseAdmin().from("missions").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function appendMissionLog(missionId: string, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  const { error } = await supabaseAdmin().from("mission_logs").insert({ mission_id: missionId, line: trimmed });
  if (error) throw error;
}

export async function listMissions(userId: string): Promise<MissionRecord[]> {
  const { data, error } = await supabaseAdmin()
    .from("missions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as MissionRecord[];
}

export async function getMissionForUser(missionId: string, userId: string): Promise<MissionRecord | null> {
  const { data, error } = await supabaseAdmin()
    .from("missions")
    .select("*")
    .eq("id", missionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as MissionRecord | null) ?? null;
}

export async function getMissionLogs(missionId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("mission_logs")
    .select("line")
    .eq("mission_id", missionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => String((row as { line: string }).line));
}

export async function listInstalledPlugins(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("plugin_installs")
    .select("plugin_name")
    .eq("user_id", userId)
    .order("installed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => String((row as { plugin_name: string }).plugin_name));
}

export async function installPlugin(userId: string, pluginName: string): Promise<void> {
  const { error } = await supabaseAdmin().from("plugin_installs").insert({ user_id: userId, plugin_name: pluginName });
  if (error && error.code !== "23505") throw error;
}

/* ─── Activity events (Phase E) ───────────────────────────────────────── */

export async function recordActivityEvent(userId: string, e: ActivityEvent): Promise<void> {
  const row = {
    user_id: userId,
    mission_id: e.missionId,
    kind: e.kind,
    payload: e as unknown as Record<string, unknown>,
    ts: e.ts,
  };
  const { error } = await supabaseAdmin().from("activity_events").insert(row);
  if (error) throw error;
}

export async function getRecentActivity(
  userId: string,
  missionId: string,
  limit = 50,
): Promise<ActivityEvent[]> {
  const { data, error } = await supabaseAdmin()
    .from("activity_events")
    .select("payload")
    .eq("user_id", userId)
    .eq("mission_id", missionId)
    .order("ts", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => (row as { payload: ActivityEvent }).payload);
}

/** Resolve mission owner; used by the activity bus persistence subscriber. */
export async function getMissionOwner(missionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("missions")
    .select("user_id")
    .eq("id", missionId)
    .maybeSingle();
  if (error) return null;
  return (data as { user_id?: string } | null)?.user_id ?? null;
}
