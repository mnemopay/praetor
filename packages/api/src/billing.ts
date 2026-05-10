// Praetor SaaS billing — Stripe checkout sessions + webhook handler + tier-gating.
//
// Tiers (canonical, as approved 2026-05-06 by Jeremiah):
//   free        — 5 missions/mo, $1 LLM cap, no article12, no marketplace
//   pro $29/mo  — 100 missions/mo, $25 LLM cap, article12 yes, no marketplace
//   team $99/mo — unlimited missions, $100 LLM cap (BYOK above), 5 seats, marketplace yes
//   enterprise  — invoice-only, custom
//
// Stripe price IDs are read from scripts/.stripe-praetor-prices.json so the IDs
// stay in lockstep with what's actually in Stripe.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import { authMiddleware, type AuthedRequest } from "./auth.js";
import type { PraetorApp } from "./http.js";
import { supabaseAdmin } from "./supabase.js";

export type Tier = "free" | "pro" | "team" | "enterprise";

export interface TierLimits {
  missionCapPerMonth: number | null;   // null = unlimited
  llmSpendCapUsd: number;               // $/month covered by Praetor's wallet
  byokAboveCap: boolean;                // can the user bring their own LLM key for spend above cap
  articleTwelveAuditAllowed: boolean;
  marketplacePublishAllowed: boolean;
  seatsIncluded: number;
  auditRetentionMonths: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    missionCapPerMonth: 5,
    llmSpendCapUsd: 1,
    byokAboveCap: false,
    articleTwelveAuditAllowed: false,
    marketplacePublishAllowed: false,
    seatsIncluded: 1,
    auditRetentionMonths: 1,
  },
  pro: {
    missionCapPerMonth: 100,
    llmSpendCapUsd: 25,
    byokAboveCap: false,
    articleTwelveAuditAllowed: true,
    marketplacePublishAllowed: false,
    seatsIncluded: 1,
    auditRetentionMonths: 6,
  },
  team: {
    missionCapPerMonth: null,
    llmSpendCapUsd: 100,
    byokAboveCap: true,
    articleTwelveAuditAllowed: true,
    marketplacePublishAllowed: true,
    seatsIncluded: 5,
    auditRetentionMonths: 6,
  },
  enterprise: {
    missionCapPerMonth: null,
    llmSpendCapUsd: 1000,
    byokAboveCap: true,
    articleTwelveAuditAllowed: true,
    marketplacePublishAllowed: true,
    seatsIncluded: 25,
    auditRetentionMonths: 84, // 7y
  },
};

interface StripeConfig {
  secretKey: string;
  webhookSecret: string | null;
  prices: Record<Tier, { productId: string | null; prices: Record<string, { id: string; lookupKey?: string; amount: number | null }> }>;
}

let cached: StripeConfig | null = null;

function loadConfig(): StripeConfig {
  if (cached) return cached;

  // Paths: when running from packages/api/dist, the prices file lives 4 levels up.
  // Try a few sensible roots so we don't break depending on CWD.
  const candidates = [
    join(env.repoRoot, "scripts", ".stripe-praetor-prices.json"),
    join(env.repoRoot, "..", "scripts", ".stripe-praetor-prices.json"),
    join(process.cwd(), "scripts", ".stripe-praetor-prices.json"),
  ];
  let pricesJson: any = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      pricesJson = JSON.parse(readFileSync(p, "utf8"));
      break;
    }
  }
  if (!pricesJson) {
    throw new Error("billing: scripts/.stripe-praetor-prices.json not found — run scripts/stripe-create-products.mjs first");
  }
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? null;
  if (!secretKey) throw new Error("billing: STRIPE_SECRET_KEY missing");
  cached = { secretKey, webhookSecret, prices: pricesJson.tiers };
  return cached;
}

async function stripeFetch<T = any>(method: string, path: string, body?: Record<string, string | number>): Promise<T> {
  const cfg = loadConfig();
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString() : undefined,
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(`Stripe ${method} ${path} ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j as T;
}

function priceIdFromLookupKey(key: string): { tier: Tier; priceId: string; amount: number } | null {
  const cfg = loadConfig();
  for (const tierName of Object.keys(cfg.prices) as Tier[]) {
    const tier = cfg.prices[tierName];
    for (const priceObj of Object.values(tier.prices)) {
      if (priceObj.lookupKey === key) {
        return { tier: tierName, priceId: priceObj.id, amount: priceObj.amount ?? 0 };
      }
    }
  }
  return null;
}

// Verify Stripe webhook signature (Stripe-Signature header).
function verifyStripeSignature(payload: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => { const [k, v] = p.split("="); return [k, v]; }));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex")); } catch { return false; }
}

// Subscription state lives in `subscriptions` table (see sql/0002_billing.sql).
// Works against both the in-memory PraetorStoreClient and real Supabase.
async function readUserTier(userId: string): Promise<Tier> {
  const { data } = await supabaseAdmin()
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return "free";
  const row = data as { tier?: string; status?: string };
  if (row.status && !["active", "trialing"].includes(row.status)) return "free";
  return (row.tier as Tier) ?? "free";
}

async function persistTier(userId: string, tier: Tier, stripeCustomerId: string | null, stripeSubscriptionId: string | null, status: string = "active"): Promise<void> {
  const existing = await supabaseAdmin().from("subscriptions").select("user_id").eq("user_id", userId).maybeSingle();
  const patch: Record<string, unknown> = { tier, status, stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId };
  if (existing.data) {
    await supabaseAdmin().from("subscriptions").update(patch).eq("user_id", userId);
  } else {
    await supabaseAdmin().from("subscriptions").insert({ user_id: userId, ...patch });
  }
  console.log(`[billing] persistTier user=${userId} tier=${tier} status=${status}`);
}

// ─── Usage counters: missions per calendar month ────────────────────────────
function currentPeriodStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function getMissionsThisMonth(userId: string): Promise<number> {
  const period = currentPeriodStart();
  const { data } = await supabaseAdmin().from("usage_counters").select("*").eq("user_id", userId).eq("period_start", period).maybeSingle();
  if (!data) return 0;
  return Number((data as { missions_started?: number }).missions_started ?? 0);
}

export async function incrementMissionCount(userId: string): Promise<void> {
  const period = currentPeriodStart();
  const existing = await supabaseAdmin().from("usage_counters").select("*").eq("user_id", userId).eq("period_start", period).maybeSingle();
  if (existing.data) {
    const cur = Number((existing.data as { missions_started?: number }).missions_started ?? 0);
    await supabaseAdmin().from("usage_counters").update({ missions_started: cur + 1 }).eq("user_id", userId).eq("period_start", period);
  } else {
    await supabaseAdmin().from("usage_counters").insert({ user_id: userId, period_start: period, missions_started: 1, llm_spend_cents: 0 });
  }
}

// ─── Stripe event idempotency ────────────────────────────────────────────────
async function isEventProcessed(eventId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("stripe_events").select("id").eq("id", eventId).maybeSingle();
  return !!data;
}
async function markEventProcessed(eventId: string, type: string, payload: unknown): Promise<void> {
  await supabaseAdmin().from("stripe_events").insert({ id: eventId, type, payload });
}

export async function getUserTier(userId: string): Promise<Tier> {
  return readUserTier(userId);
}

export async function checkMissionCap(userId: string): Promise<{ allowed: true; tier: Tier; used: number } | { allowed: false; reason: string; tier: Tier; cap: number; used: number }> {
  const tier = await readUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const used = await getMissionsThisMonth(userId);
  if (limits.missionCapPerMonth === null) return { allowed: true, tier, used };
  if (used >= limits.missionCapPerMonth) {
    return {
      allowed: false,
      reason: `You're on the ${tier} tier (${limits.missionCapPerMonth} missions/mo). You've used ${used} this month. Upgrade at https://app.praetor.mnemopay.com/billing`,
      tier,
      cap: limits.missionCapPerMonth,
      used,
    };
  }
  return { allowed: true, tier, used };
}

// ─── API key generation (for SDK / CLI users) ────────────────────────────────
function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString("base64url"); // ~43 chars
  const plaintext = `praetor_${raw}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, 16); // "praetor_" + 8 chars
  return { plaintext, hash, prefix };
}

export async function lookupKeyHash(plaintext: string): Promise<{ userId: string; keyId: string } | null> {
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const { data } = await supabaseAdmin().from("api_keys").select("*").eq("key_hash", hash).maybeSingle();
  if (!data) return null;
  const row = data as { id: string; user_id: string; revoked_at?: string | null };
  if (row.revoked_at) return null;
  return { userId: row.user_id, keyId: row.id };
}

export function mountBilling(app: PraetorApp): void {
  // ─── GET /api/v1/billing — replaces the stub. Returns user's tier + limits + (TODO: usage). ─────
  app.get("/api/v1/billing", authMiddleware, async (req, res) => {
    const userId = (req as AuthedRequest).user!.id;
    const tier = await getUserTier(userId);
    const limits = TIER_LIMITS[tier];
    const missions = await getMissionsThisMonth(userId);
    res.json({
      ok: true,
      tier,
      limits,
      currentMonth: { missions, llmSpendUsd: 0 },
      pricing: {
        pro: { monthly: { lookupKey: "praetor_pro_monthly", priceUsd: 29 }, yearly: { lookupKey: "praetor_pro_yearly", priceUsd: 290 } },
        team: { monthly: { lookupKey: "praetor_team_monthly", priceUsd: 99 }, yearly: { lookupKey: "praetor_team_yearly", priceUsd: 990 } },
      },
    });
  });

  // ─── POST /api/v1/checkout/session — creates a Stripe Checkout Session. ──────
  app.post("/api/v1/checkout/session", authMiddleware, async (req, res) => {
    const userId = (req as AuthedRequest).user!.id;
    const userEmail = (req as AuthedRequest).user!.email;
    const body = (req.body ?? {}) as { priceLookupKey?: string; successUrl?: string; cancelUrl?: string };
    const lookupKey = body.priceLookupKey;
    if (!lookupKey) {
      res.status(400).json({ ok: false, error: "priceLookupKey required (e.g. praetor_pro_monthly)" });
      return;
    }
    const found = priceIdFromLookupKey(lookupKey);
    if (!found) {
      res.status(400).json({ ok: false, error: `unknown priceLookupKey: ${lookupKey}` });
      return;
    }

    const successUrl = body.successUrl ?? "https://app.praetor.mnemopay.com/billing?status=success&session={CHECKOUT_SESSION_ID}";
    const cancelUrl = body.cancelUrl ?? "https://app.praetor.mnemopay.com/billing?status=cancel";

    try {
      const params: Record<string, string | number> = {
        mode: "subscription",
        "line_items[0][price]": found.priceId,
        "line_items[0][quantity]": 1,
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        "metadata[praetor_user_id]": userId,
        "metadata[praetor_tier]": found.tier,
        allow_promotion_codes: "true",
        billing_address_collection: "auto",
      };
      if (userEmail) params.customer_email = userEmail;
      const session = await stripeFetch<{ id: string; url: string }>("POST", "/checkout/sessions", params);
      res.json({ ok: true, sessionId: session.id, url: session.url, tier: found.tier });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? "checkout failed" });
    }
  });

  // ─── POST /api/v1/webhooks/stripe — handles subscription lifecycle events. ────
  // Note: this needs the RAW request body (not JSON-parsed) for signature verification.
  // praetorHttp's jsonBodyParser parses on Content-Type:application/json — Stripe sends
  // application/json so we re-stringify for verification. In production wire a raw-body
  // parser on this route specifically.
  app.post("/api/v1/webhooks/stripe", async (req, res) => {
    const cfg = loadConfig();
    const sig = req.headers["stripe-signature"] as string | undefined;
    const rawBody = JSON.stringify(req.body ?? {});

    if (cfg.webhookSecret) {
      const ok = verifyStripeSignature(rawBody, sig, cfg.webhookSecret);
      if (!ok) {
        res.status(400).json({ ok: false, error: "invalid signature" });
        return;
      }
    } else {
      console.warn("[billing] STRIPE_WEBHOOK_SECRET missing — skipping signature verification (DEV ONLY)");
    }

    const event = req.body as { type: string; data: { object: any } };
    const obj = event.data?.object ?? {};

    try {
      // Idempotency: short-circuit if Stripe re-delivers the same event.
      const eventId = (event as any).id;
      if (eventId && (await isEventProcessed(eventId))) {
        res.json({ ok: true, deduped: true });
        return;
      }
      if (eventId) await markEventProcessed(eventId, event.type, event);

      switch (event.type) {
        case "checkout.session.completed": {
          const userId = obj.client_reference_id ?? obj.metadata?.praetor_user_id;
          const tier = (obj.metadata?.praetor_tier ?? "pro") as Tier;
          const customerId = obj.customer ?? null;
          const subscriptionId = obj.subscription ?? null;
          if (userId) await persistTier(userId, tier, customerId, subscriptionId, "active");
          console.log(`[billing] checkout.completed user=${userId} tier=${tier}`);
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.created": {
          const customerId = obj.customer;
          const status = obj.status;
          const userId = obj.metadata?.praetor_user_id;
          const tier = (obj.metadata?.praetor_tier ?? "pro") as Tier;
          const subscriptionId = obj.id;
          if (userId && (status === "active" || status === "trialing")) {
            await persistTier(userId, tier, customerId, subscriptionId);
          }
          console.log(`[billing] subscription.${event.type.split(".")[2]} user=${userId} tier=${tier} status=${status}`);
          break;
        }
        case "customer.subscription.deleted": {
          const userId = obj.metadata?.praetor_user_id;
          const customerId = obj.customer;
          if (userId) await persistTier(userId, "free", customerId, null);
          console.log(`[billing] subscription.deleted user=${userId} -> free`);
          break;
        }
        case "invoice.payment_failed": {
          const userId = obj.subscription_details?.metadata?.praetor_user_id;
          console.warn(`[billing] payment_failed user=${userId} — keep tier active during retry window`);
          break;
        }
        default:
          // Ignore unrelated events.
          break;
      }
      res.json({ ok: true, received: event.type });
    } catch (e: any) {
      console.error(`[billing] webhook handler error: ${e?.message}`);
      res.status(500).json({ ok: false, error: e?.message ?? "webhook handler failed" });
    }
  });

  // ─── API key generation (for SDK / CLI users) ──────────────────────────────
  app.post("/api/v1/keys", authMiddleware, async (req, res) => {
    const userId = (req as AuthedRequest).user!.id;
    const body = (req.body ?? {}) as { name?: string };
    const name = String(body.name ?? "default").slice(0, 64);
    const { plaintext, hash, prefix } = generateApiKey();
    const { data, error } = await supabaseAdmin().from("api_keys").insert({
      user_id: userId,
      name,
      key_prefix: prefix,
      key_hash: hash,
    }).select("*").single();
    if (error) {
      res.status(500).json({ ok: false, error: (error as { message?: string }).message ?? "create failed" });
      return;
    }
    const row = data as { id: string };
    // Plaintext is returned ONCE; we only store the hash.
    res.json({ ok: true, id: row.id, name, keyPrefix: prefix, secret: plaintext, warning: "Save this key — we won't show it again." });
  });

  app.get("/api/v1/keys", authMiddleware, async (req, res) => {
    const userId = (req as AuthedRequest).user!.id;
    const { data } = await supabaseAdmin().from("api_keys").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    const keys = (Array.isArray(data) ? data : []).map((row: any) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }));
    res.json({ ok: true, keys });
  });

  app.post("/api/v1/keys/:id/revoke", authMiddleware, async (req, res) => {
    const userId = (req as AuthedRequest).user!.id;
    const id = String(req.params?.id ?? "");
    if (!id) {
      res.status(400).json({ ok: false, error: "key id required" });
      return;
    }
    const owned = await supabaseAdmin().from("api_keys").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!owned.data) {
      res.status(404).json({ ok: false, error: "key not found" });
      return;
    }
    await supabaseAdmin().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    res.json({ ok: true, revoked: id });
  });

  console.log("[billing] mounted: GET /api/v1/billing, POST /api/v1/checkout/session, POST /api/v1/webhooks/stripe, POST/GET /api/v1/keys, POST /api/v1/keys/:id/revoke");
}
