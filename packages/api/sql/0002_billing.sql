-- Praetor API — billing schema (subscriptions + API keys + usage tracking)
--
-- Apply this AFTER 0001_init.sql in your Supabase SQL editor.
-- Powers: GET /api/v1/billing, POST /api/v1/checkout/session,
-- POST /api/v1/webhooks/stripe, mission-cap gating middleware,
-- POST/GET/DELETE /api/v1/keys (SDK API key generation).

-- ─── Subscriptions ───────────────────────────────────────────────────────────
-- One row per user representing their current Praetor subscription state.
-- Updated by Stripe webhook on customer.subscription.{created,updated,deleted}.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id                  uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  tier                     text NOT NULL DEFAULT 'free'
                           CHECK (tier IN ('free','pro','team','enterprise')),
  status                   text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','trialing','past_due','canceled','incomplete','unpaid')),
  stripe_customer_id       text UNIQUE,
  stripe_subscription_id   text UNIQUE,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON public.subscriptions(stripe_customer_id);

-- ─── API keys ────────────────────────────────────────────────────────────────
-- For the @kpanks/sdk and @kpanks/cli to authenticate requests against
-- api.praetor.mnemopay.com without going through the dashboard's Supabase
-- session flow. Keys are hashed at rest (SHA-256) and the plaintext is shown
-- to the user exactly once at creation.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         text NOT NULL,                 -- user-supplied label, e.g. "ci-prod"
  key_prefix   text NOT NULL,                 -- first 8 chars of plaintext, for UX recognition
  key_hash     text NOT NULL UNIQUE,          -- sha256(plaintext) hex
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash) WHERE revoked_at IS NULL;

-- ─── Usage counters ──────────────────────────────────────────────────────────
-- Per user, per calendar month: missions started + LLM spend in cents.
-- The mission-creation middleware reads this row to enforce tier caps.
-- Reset by ON CONFLICT bumping period_start when a new month rolls over.
CREATE TABLE IF NOT EXISTS public.usage_counters (
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_start     date NOT NULL,                -- first day of the calendar month, UTC
  missions_started integer NOT NULL DEFAULT 0,
  llm_spend_cents  integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start)
);

-- ─── Stripe events idempotency ───────────────────────────────────────────────
-- Stripe re-delivers webhooks. Storing the event id lets the handler
-- short-circuit duplicates without doing the work twice.
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id          text PRIMARY KEY,            -- evt_xxxx from Stripe
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb
);

-- ─── Trigger: keep updated_at fresh on subscriptions ─────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
