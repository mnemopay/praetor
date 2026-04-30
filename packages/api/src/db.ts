import type { MissionRecord } from "./types.js";
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
