-- Praetor service account — fixed UUID for automated callers (cron, dogfood,
-- scheduled charters) that authenticate via PRAETOR_SERVICE_TOKEN instead of
-- a real Supabase JWT. See packages/api/src/auth.ts service-token bypass.
INSERT INTO public.users (id, email, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'service@praetor.local', 'Praetor Service Account')
ON CONFLICT (id) DO NOTHING;
