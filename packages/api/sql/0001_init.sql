-- Praetor API — initial schema
--
-- Run this in your Supabase SQL editor after creating a new project.
-- Then on the praetor-api Fly app:
--   fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... -a praetor-api
--   fly secrets unset PRAETOR_DEV_MODE -a praetor-api
--   fly deploy ...
--
-- Schema mirrors what the in-memory store at packages/api/src/supabase.ts
-- already serves through its PostgREST-shaped `.from()` chain.

-- Users — minimal. Real auth is delegated to Supabase Auth (auth.users
-- table that Supabase manages); this `users` table is a profile join.
CREATE TABLE IF NOT EXISTS public.users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE,
  display_name text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Missions — one row per `praetor run` invocation.
CREATE TABLE IF NOT EXISTS public.missions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES public.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','succeeded','failed','canceled','timed_out')),
  goal          text NOT NULL,
  budget        numeric(10,4) NOT NULL DEFAULT 0,  -- USD cap from FiscalGate
  charter_json  jsonb NOT NULL,                    -- the full Charter spec
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_missions_user        ON public.missions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_missions_status      ON public.missions(status, created_at DESC);

-- Mission logs — append-only stream for the dashboard live tail.
CREATE TABLE IF NOT EXISTS public.mission_logs (
  id          bigserial PRIMARY KEY,
  mission_id  uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  line        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mission_logs_mission ON public.mission_logs(mission_id, created_at);

-- Activity events — the audit trail Article 12 requires.
CREATE TABLE IF NOT EXISTS public.mission_events (
  id          bigserial PRIMARY KEY,
  mission_id  uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  kind        text NOT NULL,           -- "tool.start" | "tool.end" | "milestone" | "chat.user" | etc
  event_json  jsonb NOT NULL,
  ts          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mission_events ON public.mission_events(mission_id, ts);

-- Per-mission audit chain root (Merkle from @praetor/core).
CREATE TABLE IF NOT EXISTS public.mission_audit (
  mission_id  uuid PRIMARY KEY REFERENCES public.missions(id) ON DELETE CASCADE,
  merkle_root text NOT NULL,
  bundle_url  text,                    -- path to manifest.json + chain.txt + events.csv archive
  sealed_at   timestamptz
);

-- Update the updated_at column on missions automatically.
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_missions_touch ON public.missions;
CREATE TRIGGER trg_missions_touch
BEFORE UPDATE ON public.missions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Row Level Security — Praetor API uses the SERVICE_ROLE_KEY which
-- bypasses RLS by default, so we don't need to define RLS policies for
-- the api server itself. If you later expose an anon-key surface
-- (e.g. a web client that talks to Supabase directly), add policies
-- here that scope every row by user_id = auth.uid().
ALTER TABLE public.missions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_audit  ENABLE ROW LEVEL SECURITY;
