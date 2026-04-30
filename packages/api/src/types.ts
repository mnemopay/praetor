export interface ApiUser {
  id: string;
  email?: string;
}

export interface PluginInfo {
  name: string;
  version: string;
  provider: string;
  description: string;
}

export interface MissionRecord {
  id: string;
  user_id: string;
  status: "queued" | "running" | "completed" | "failed";
  goal: string;
  budget: number;
  charter_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
