-- Praetor API — enable RLS + strict policies on all public-schema tables.
--
-- Applied after Supabase Security Advisor flagged tables exposed via the
-- publishable anon key (sb_publishable_*). The frontend uses the anon key
-- to talk to PostgREST directly (see packages/dashboard/.env.production);
-- without RLS, anyone could read users + subscriptions + api_keys.
--
-- This migration:
--   1. Enables RLS on tables 0002_billing.sql forgot (users, subscriptions,
--      api_keys, usage_counters, stripe_events).
--   2. Adds per-user policies so authenticated callers (auth.uid() = ...)
--      see only their own rows.
--   3. Adds policies for the existing RLS-enabled missions* tables so the
--      dashboard can read its own data with anon-key + JWT (the previous
--      migration enabled RLS but added no policies, so even the dashboard's
--      authenticated calls were getting deny-all).
--
-- Service-role calls (the API server) bypass RLS automatically, so the
-- API itself keeps working unchanged.
--
-- Apply: paste into Supabase SQL editor for project awjqnxlslggxlfjmoubi
-- and run, OR run via the apply-rls-migration.mjs script with
-- SUPABASE_SERVICE_ROLE_KEY in env.

-- ─── Enable RLS on tables previously missed ────────────────────────────────
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events   ENABLE ROW LEVEL SECURITY;

-- ─── users: every authenticated user sees + edits only their own profile ──
DROP POLICY IF EXISTS users_self_read   ON public.users;
DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_read   ON public.users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY users_self_update ON public.users FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ─── subscriptions: each user reads their own subscription state ──────────
-- Writes are service_role only (bypasses RLS) — Stripe webhook handler.
DROP POLICY IF EXISTS subscriptions_self_read ON public.subscriptions;
CREATE POLICY subscriptions_self_read ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ─── api_keys: each user reads + manages their own keys ───────────────────
-- key_hash is NEVER exposed to client (column-level visibility would be the
-- ideal long-term move; for now keep policy at row level and rely on the
-- dashboard never SELECT-ing key_hash).
DROP POLICY IF EXISTS api_keys_self_read   ON public.api_keys;
DROP POLICY IF EXISTS api_keys_self_insert ON public.api_keys;
DROP POLICY IF EXISTS api_keys_self_update ON public.api_keys;
DROP POLICY IF EXISTS api_keys_self_delete ON public.api_keys;
CREATE POLICY api_keys_self_read   ON public.api_keys FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY api_keys_self_insert ON public.api_keys FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY api_keys_self_update ON public.api_keys FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY api_keys_self_delete ON public.api_keys FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ─── usage_counters: read-only for the owner, writes via service role ────
DROP POLICY IF EXISTS usage_counters_self_read ON public.usage_counters;
CREATE POLICY usage_counters_self_read ON public.usage_counters FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ─── stripe_events: never exposed to anon or authenticated. Service-role only.
--   No policies → RLS defaults to deny-all for non-service-role callers.

-- ─── missions: 0001_init enabled RLS but never added policies → dashboard
--   queries returned empty arrays for the user's own data. Add policies.
DROP POLICY IF EXISTS missions_self_read   ON public.missions;
DROP POLICY IF EXISTS missions_self_insert ON public.missions;
DROP POLICY IF EXISTS missions_self_update ON public.missions;
DROP POLICY IF EXISTS missions_self_delete ON public.missions;
CREATE POLICY missions_self_read   ON public.missions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY missions_self_insert ON public.missions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY missions_self_update ON public.missions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY missions_self_delete ON public.missions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ─── mission_logs / mission_events / mission_audit: scope through the
--   parent mission's user_id. Read-only for the authenticated user; writes
--   come from the service-role API server.
DROP POLICY IF EXISTS mission_logs_self_read ON public.mission_logs;
CREATE POLICY mission_logs_self_read ON public.mission_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mission_logs.mission_id AND m.user_id = auth.uid()));

DROP POLICY IF EXISTS mission_events_self_read ON public.mission_events;
CREATE POLICY mission_events_self_read ON public.mission_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mission_events.mission_id AND m.user_id = auth.uid()));

DROP POLICY IF EXISTS mission_audit_self_read ON public.mission_audit;
CREATE POLICY mission_audit_self_read ON public.mission_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mission_audit.mission_id AND m.user_id = auth.uid()));

-- ─── Sanity check: list every public-schema table without RLS. If this
--   returns any rows after the migration applies, the Security Advisor
--   will still flag the project.
-- SELECT schemaname, tablename FROM pg_tables
--   WHERE schemaname='public' AND tablename NOT IN (
--     SELECT tablename FROM pg_tables t
--     JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname=t.schemaname)
--     WHERE c.relrowsecurity = true
--   );
