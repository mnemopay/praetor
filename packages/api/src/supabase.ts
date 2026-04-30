import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let singleton: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!singleton) {
    singleton = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
      },
    });
  }
  return singleton;
}
