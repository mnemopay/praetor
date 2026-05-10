import "./style.css";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
  type Session as SupabaseSession,
} from "@supabase/supabase-js";

// Praetor dashboard auth.
//
// Three modes, in order of precedence:
//
//   1. PRODUCTION — VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set.
//      Uses real @supabase/supabase-js. Email magic-link or password login.
//      Tokens are real JWTs that the API server verifies via supabase.auth.getUser().
//
//   2. DEV-MODE BYPASS — VITE_PRAETOR_DEV_MODE=1, no Supabase configured.
//      Uses an in-memory shim that mints a fake `dev:<email>` token. The API
//      server's PRAETOR_DEV_MODE auth bypass accepts any non-empty bearer
//      token under the same flag, so the loop closes without a real backend.
//
//   3. UNCONFIGURED — neither of the above. Renders a config-error screen
//      instructing the operator to copy .env.example to .env and either
//      configure Supabase or set VITE_PRAETOR_DEV_MODE=1.
//
// The shim is opt-in only. Removing the inline createClient that auto-signed
// every visitor in as `dev-user` was task #20 — production deployments must
// fail closed if Supabase is missing, not silently issue a fake session.

type Session = { user: { id: string; email: string }; access_token: string };

interface MinimalAuthClient {
  auth: {
    getSession(): Promise<{ data: { session: Session | null } }>;
    getUser(): Promise<{ data: { user: Session["user"] | null }; error: { message: string } | null }>;
    onAuthStateChange(cb: (evt: string, s: Session | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
    signInWithPassword(args: { email: string; password: string }): Promise<{
      data: { user: Session["user"] | null; session: Session | null };
      error: { message: string } | null;
    }>;
    signUp(args: { email: string; password: string }): Promise<{
      data: { user: Session["user"] | null; session: Session | null };
      error: { message: string } | null;
    }>;
    signOut(): Promise<{ error: { message: string } | null }>;
  };
}

function adaptSupabase(client: SupabaseClient): MinimalAuthClient {
  const toSession = (s: SupabaseSession | null): Session | null => {
    if (!s) return null;
    return {
      user: { id: s.user.id, email: s.user.email ?? "" },
      access_token: s.access_token,
    };
  };
  return {
    auth: {
      async getSession() {
        const { data } = await client.auth.getSession();
        return { data: { session: toSession(data.session) } };
      },
      async getUser() {
        const { data, error } = await client.auth.getUser();
        return {
          data: {
            user: data.user
              ? { id: data.user.id, email: data.user.email ?? "" }
              : null,
          },
          error: error ? { message: error.message } : null,
        };
      },
      onAuthStateChange(cb) {
        const sub = client.auth.onAuthStateChange((evt, s) => cb(evt, toSession(s)));
        return { data: { subscription: { unsubscribe: () => sub.data.subscription.unsubscribe() } } };
      },
      async signInWithPassword(args) {
        const { data, error } = await client.auth.signInWithPassword(args);
        return {
          data: {
            user: data.user ? { id: data.user.id, email: data.user.email ?? "" } : null,
            session: toSession(data.session),
          },
          error: error ? { message: error.message } : null,
        };
      },
      async signUp(args) {
        const { data, error } = await client.auth.signUp(args);
        return {
          data: {
            user: data.user ? { id: data.user.id, email: data.user.email ?? "" } : null,
            session: toSession(data.session),
          },
          error: error ? { message: error.message } : null,
        };
      },
      async signOut() {
        const { error } = await client.auth.signOut();
        return { error: error ? { message: error.message } : null };
      },
    },
  };
}

function createDevModeShim(): MinimalAuthClient {
  let session: Session | null = null;
  const listeners: Array<(evt: string, s: Session | null) => void> = [];
  return {
    auth: {
      async getSession() { return { data: { session } }; },
      async getUser() {
        return { data: { user: session?.user ?? null }, error: null };
      },
      onAuthStateChange(cb) {
        listeners.push(cb);
        return {
          data: {
            subscription: {
              unsubscribe() {
                const i = listeners.indexOf(cb);
                if (i >= 0) listeners.splice(i, 1);
              },
            },
          },
        };
      },
      async signInWithPassword({ email }) {
        session = { user: { id: email, email }, access_token: `dev:${email}` };
        listeners.forEach((cb) => cb("SIGNED_IN", session));
        return { data: { user: session.user, session }, error: null };
      },
      async signUp({ email }) {
        session = { user: { id: email, email }, access_token: `dev:${email}` };
        listeners.forEach((cb) => cb("SIGNED_IN", session));
        return { data: { user: session.user, session }, error: null };
      },
      async signOut() {
        session = null;
        listeners.forEach((cb) => cb("SIGNED_OUT", null));
        return { error: null };
      },
    },
  };
}
import { renderMarkdown as praetorRenderMarkdown } from "./praetor_markdown.js";
import { ActivityPanel, type ActivityEvent } from "./components/ActivityPanel.js";
import { openActivityStream, type ActivityStreamHandle } from "./eventStream.js";
import { renderTheater, type Theater } from "./views/theater/index.js";

type Route = "overview" | "chat" | "missions" | "audit" | "theater" | "billing" | "marketplace" | "tools" | "world" | "charters";
type Mission = { id: string; status: string; goal: string; created_at: string; budget?: number; spent_usd?: number };
type Plugin = { name: string; version: string; provider: string; description: string };
type BillingTier = "free" | "pro" | "team" | "enterprise";
type BillingPayload = {
  ok: boolean;
  tier: BillingTier;
  limits: {
    missionCapPerMonth: number | null;
    llmSpendCapUsd: number;
    byokAboveCap: boolean;
    articleTwelveAuditAllowed: boolean;
    marketplacePublishAllowed: boolean;
    seatsIncluded: number;
    auditRetentionMonths: number;
  };
  currentMonth: { missions: number; llmSpendUsd: number };
  pricing: {
    pro: { monthly: { lookupKey: string; priceUsd: number }; yearly: { lookupKey: string; priceUsd: number } };
    team: { monthly: { lookupKey: string; priceUsd: number }; yearly: { lookupKey: string; priceUsd: number } };
  };
};
type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};
type ToolMetadata = {
  origin: "native" | "adapter" | "mock" | "experimental";
  capability: string;
  risk: string[];
  approval: string;
  sandbox: string;
  production: "ready" | "needs-live-test" | "needs-native-rewrite" | "stub";
  costEffective?: boolean;
  note?: string;
};
type ToolCatalogItem = {
  name: string;
  description: string;
  tags: string[];
  allowedRoles: string[];
  costUsd: number;
  metadata: ToolMetadata | null;
};
type ToolCatalogReport = {
  total: number;
  byOrigin: Record<string, number>;
  byState: Record<string, number>;
  missingMetadata: string[];
};
type WorldScene = {
  id: string;
  title: string;
  glbUrl: string | null;
  splatUrl: string | null;
  publishedAt: string | null;
  viewerPath: string;
};
type ChatMessage = { id: string; role: "user" | "praetor" | "system"; content: string; missionId?: string; status?: string };
type AgentChoice = "native" | "coding" | "research" | "world-gen";

const IS_PRAETOR_PROD_HOST =
  typeof window !== "undefined" && /(^|\.)praetor\.mnemopay\.com$/.test(window.location.hostname);
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? (IS_PRAETOR_PROD_HOST ? "https://api.praetor.mnemopay.com" : "http://127.0.0.1:8788")).replace(/\/$/, "");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? (IS_PRAETOR_PROD_HOST ? "https://awjqnxlslggxlfjmoubi.supabase.co" : "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? (IS_PRAETOR_PROD_HOST ? "sb_publishable_3j1Oq9zyyAh3668v_vpGvA_83vFeatd" : "");
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const DEV_MODE_BYPASS = import.meta.env.VITE_PRAETOR_DEV_MODE === "1";

function buildAuthClient(): MinimalAuthClient | null {
  if (SUPABASE_CONFIGURED) {
    const real = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return adaptSupabase(real);
  }
  if (DEV_MODE_BYPASS) {
    return createDevModeShim();
  }
  return null;
}

const THEMES = ["dark", "solarized-light", "solarized-dark"] as const;
type Theme = (typeof THEMES)[number];
const THEME_STORAGE_KEY = "praetor.theme";
const THEME_LABEL: Record<Theme, string> = {
  dark: "Dark",
  "solarized-light": "Solarized light",
  "solarized-dark": "Solarized dark",
};
const THEME_GLYPH: Record<Theme, string> = {
  dark: "\u25D1",
  "solarized-light": "\u263C",
  "solarized-dark": "\u263E",
};

function defaultTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "solarized-light";
    }
  } catch {
    // ignore matchMedia failures
  }
  return "dark";
}

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && (THEMES as readonly string[]).includes(stored)) {
      return stored as Theme;
    }
  } catch {
    // localStorage may be disabled
  }
  return defaultTheme();
}

function applyTheme(next: Theme) {
  currentTheme = next;
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // ignore quota / disabled storage
  }
  refreshThemeButtons();
}

function cycleTheme() {
  const idx = THEMES.indexOf(currentTheme);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next);
}

function refreshThemeButtons() {
  const next = THEMES[(THEMES.indexOf(currentTheme) + 1) % THEMES.length];
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".btn-theme"))) {
    btn.textContent = `${THEME_GLYPH[currentTheme]} ${THEME_LABEL[currentTheme]}`;
    btn.title = `Theme: ${THEME_LABEL[currentTheme]}. Click for ${THEME_LABEL[next]}.`;
    btn.setAttribute("aria-label", `Switch theme. Current: ${THEME_LABEL[currentTheme]}.`);
  }
}

let currentTheme: Theme = "dark";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("dashboard: #app container not found");

const supabase = buildAuthClient();

let session: Session | null = null;
let currentRoute: Route = initialRoute();
let selectedMissionId: string | null = null;
let chatLog: ChatMessage[] = [];
const pollers = new Map<string, number>();
let activityPanel: ActivityPanel | null = null;
let activityStream: ActivityStreamHandle | null = null;
let activityMissionId: string | null = null;
let theaterInstance: Theater | null = null;
let selectedAgent: AgentChoice = "native";
let cachedTools: ToolCatalogItem[] | null = null;

function initialRoute(): Route {
  if (typeof window === "undefined") return "overview";
  const route = window.location.pathname.replace(/^\/+/, "").split("/")[0] as Route;
  return route && ["overview", "chat", "charters", "missions", "audit", "theater", "tools", "world", "billing", "marketplace"].includes(route)
    ? route
    : "overview";
}

async function fetchToolsOnce() {
  if (cachedTools !== null) return;
  try {
    const res = await authedFetch("/api/v1/tools");
    const payload = await res.json();
    if (res.ok && payload.ok) {
      cachedTools = payload.tools;
    }
  } catch (err) {
    // silently fail
  }
}

async function renderAgentToolsSummary() {
  const summaryDiv = document.getElementById("agentToolsSummary");
  if (!summaryDiv) return;
  await fetchToolsOnce();
  if (!cachedTools) return;

  const agentTools = cachedTools.filter(t => t.allowedRoles.length === 0 || t.allowedRoles.includes(selectedAgent));
  let mocks = 0;
  let stubs = 0;
  let adapters = 0;
  const risks = new Set<string>();

  for (const t of agentTools) {
    const origin = t.metadata?.origin;
    const prod = t.metadata?.production;
    if (origin === "mock") mocks++;
    if (origin === "adapter") adapters++;
    if (prod === "stub") stubs++;
    if (t.metadata?.risk) {
      for (const r of t.metadata.risk) risks.add(r);
    }
  }

  if (mocks === 0 && stubs === 0 && adapters === 0 && risks.size === 0) {
    summaryDiv.innerHTML = "";
    return;
  }

  const badges = [];
  if (mocks > 0) badges.push(`<span class="tool-badge mock">${mocks} mock</span>`);
  if (stubs > 0) badges.push(`<span class="tool-badge err">${stubs} stub</span>`);
  if (adapters > 0) badges.push(`<span class="tool-badge warn">${adapters} adapter</span>`);
  for (const r of risks) badges.push(`<span class="tool-badge risk-pill">${escapeHtml(r)}</span>`);

  summaryDiv.innerHTML = `
    <div class="tool-warning-banner">
      <span class="warning-icon">⚠</span>
      <div>
        <strong>${agentTools.length} tools available</strong> to ${selectedAgent}
        <div class="tool-badges mt-1">${badges.join("")}</div>
      </div>
    </div>
  `;
}

void bootstrap();

async function bootstrap() {
  applyTheme(loadTheme());
  if (!supabase) {
    renderConfigError();
    return;
  }
  const { data } = await supabase.auth.getSession();
  session = data.session;
  render();
  supabase.auth.onAuthStateChange((_evt, s) => {
    session = s;
    if (!session) {
      selectedMissionId = null;
      chatLog = [];
      stopAllPollers();
      activityStream?.close();
      activityStream = null;
      activityMissionId = null;
    }
    render();
  });
}

function renderConfigError() {
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div>
          <h1>Praetor</h1>
          <p class="subtitle">Authentication not configured</p>
        </div>
      </header>
      <section class="glass-panel">
        <p>This dashboard fails closed when no auth backend is configured. Pick one:</p>
        <p class="card-hint">
          <strong>Production:</strong> set <code>VITE_SUPABASE_URL</code> and
          <code>VITE_SUPABASE_ANON_KEY</code> in <code>packages/dashboard/.env</code>.
          The API server must run with the matching <code>SUPABASE_URL</code> +
          <code>SUPABASE_SERVICE_ROLE_KEY</code> pair.
        </p>
        <p class="card-hint">
          <strong>Local dev:</strong> set <code>VITE_PRAETOR_DEV_MODE=1</code> in
          <code>packages/dashboard/.env</code> AND <code>PRAETOR_DEV_MODE=1</code>
          in the API server's environment. Any email + password combo will sign
          in with a deterministic <code>dev-user</code>.
        </p>
        <p class="card-hint">Restart <code>vite</code> after editing <code>.env</code>.</p>
      </section>
    </main>
  `;
}

function render() {
  if (!session) {
    renderLogin();
    return;
  }
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div>
          <h1>Praetor</h1>
          <p class="subtitle">${session.user.email ?? "Signed in"} · ${API_BASE.replace(/^https?:\/\//, "")}</p>
        </div>
        <div class="topbar-actions">
          <span id="apiHealth" class="status-pill">checking…</span>
          <button id="themeToggle" class="btn-theme" type="button">Theme</button>
          <button id="signOutBtn" class="btn-secondary">Sign out</button>
        </div>
      </header>
      <nav class="tabs">
        ${tabButton("overview", "Overview")}
        ${tabButton("chat", "Chat")}
        ${tabButton("charters", "Charters")}
        ${tabButton("missions", "Missions")}
        ${tabButton("audit", "Audit")}
        ${tabButton("theater", "Theater")}
        ${tabButton("tools", "Tools")}
        ${tabButton("world", "World")}
        ${tabButton("billing", "Billing")}
        ${tabButton("marketplace", "Marketplace")}
      </nav>
      <section class="glass-panel" id="view"></section>
    </main>
  `;
  wireAuthedHandlers();
  void pingHealth();
  void renderRoute();
}

function renderLogin() {
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div>
          <h1>Praetor</h1>
          <p class="subtitle">Mission runtime for autonomous agents</p>
        </div>
      </header>
      <section class="glass-panel narrow">
        <div class="auth-tabs">
          <button class="auth-tab-btn active" data-mode="signin">Sign in</button>
          <button class="auth-tab-btn" data-mode="signup">Create account</button>
        </div>
        <form id="loginForm" class="stack">
          <label>Email</label>
          <input id="emailInput" class="field" type="email" required placeholder="you@company.com" autocomplete="email" />
          <label>Password</label>
          <input id="passwordInput" class="field" type="password" required placeholder="••••••••" minlength="6" autocomplete="current-password" />
          <button class="btn-primary" type="submit" id="loginSubmit">Sign in</button>
          <p id="loginError" class="card-hint error"></p>
        </form>
      </section>
    </main>
  `;

  const form = document.getElementById("loginForm") as HTMLFormElement | null;
  const emailInput = document.getElementById("emailInput") as HTMLInputElement | null;
  const passwordInput = document.getElementById("passwordInput") as HTMLInputElement | null;
  const loginError = document.getElementById("loginError") as HTMLParagraphElement | null;
  const submitBtn = document.getElementById("loginSubmit") as HTMLButtonElement | null;
  const tabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".auth-tab-btn"));
  let mode: "signin" | "signup" = "signin";

  for (const btn of tabBtns) {
    btn.addEventListener("click", () => {
      mode = (btn.dataset.mode as "signin" | "signup") ?? "signin";
      tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (submitBtn) submitBtn.textContent = mode === "signin" ? "Sign in" : "Create account";
      if (loginError) loginError.textContent = "";
    });
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loginError || !emailInput || !passwordInput || !supabase) return;
    loginError.textContent = "";
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) loginError.textContent = error.message;
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        loginError.textContent = error.message;
      } else if (!data.session) {
        loginError.textContent = "Account created. Check your email to confirm, then sign in.";
        loginError.classList.remove("error");
      }
    }
  });
}

function tabButton(route: Route, label: string): string {
  const cls = currentRoute === route ? "tab-btn active-tab" : "tab-btn";
  return `<button class="${cls}" data-route="${route}">${label}</button>`;
}

function wireAuthedHandlers() {
  document.getElementById("signOutBtn")?.addEventListener("click", async () => {
    await supabase?.auth.signOut();
  });
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    cycleTheme();
  });
  refreshThemeButtons();
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-btn"))) {
    btn.addEventListener("click", () => {
      currentRoute = btn.dataset.route as Route;
      render();
    });
  }
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!session) throw new Error("No active session");
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function pingHealth() {
  const pill = document.getElementById("apiHealth");
  if (!pill) return;
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      pill.textContent = "● API live";
      pill.className = "status-pill ok";
    } else {
      pill.textContent = `API ${res.status}`;
      pill.className = "status-pill warn";
    }
  } catch {
    pill.textContent = "● API offline";
    pill.className = "status-pill err";
  }
}

async function renderRoute() {
  // Tear down theater instance whenever we leave its route. Each route owns
  // its own DOM lifecycle; the theater also owns an SSE handle + scrub timer.
  if (currentRoute !== "theater" && theaterInstance) {
    theaterInstance.destroy();
    theaterInstance = null;
  }
  switch (currentRoute) {
    case "overview": return renderOverview();
    case "chat": return renderChat();
    case "charters": return renderCharters();
    case "missions": return renderMissions();
    case "audit": return renderAudit();
    case "theater": return renderTheaterRoute();
    case "tools": return renderTools();
    case "billing": return renderBilling();
    case "marketplace": return renderMarketplace();
    case "world": return renderWorld();
  }
}

async function renderTheaterRoute() {
  const view = document.getElementById("view");
  if (!view) return;
  if (!selectedMissionId) {
    view.innerHTML = `<p class="card-hint">Select a mission first — Missions tab → click a mission card → Theater.</p>`;
    return;
  }
  if (!session) return;
  // Reset host so prior theater DOM doesn't leak.
  view.innerHTML = "";
  theaterInstance?.destroy();
  theaterInstance = await renderTheater(view, {
    apiBase: API_BASE,
    token: session.access_token,
    missionId: selectedMissionId,
    authedFetch,
  });
}

// ─── FiscalGate gauge + Article 12 badge — small reusable HTML primitives ─────

async function renderOverview() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `<p class="card-hint">Loading command center...</p>`;
  try {
    const [billingRes, missionsRes, keysRes] = await Promise.all([
      authedFetch("/api/v1/billing"),
      authedFetch("/api/v1/missions"),
      authedFetch("/api/v1/keys").catch(() => null),
    ]);
    const billing = (await billingRes.json()) as BillingPayload;
    const missionsPayload = await missionsRes.json();
    const keysPayload = keysRes ? await keysRes.json() : { keys: [] };
    const missions = (missionsPayload.missions ?? []) as Mission[];
    const keys = ((keysPayload.keys ?? []) as ApiKey[]).filter((k) => !k.revokedAt);
    const running = missions.filter((m) => m.status === "running" || m.status === "queued").length;
    const completed = missions.filter((m) => m.status === "completed" || m.status === "succeeded" || m.status === "ok").length;
    const missionCap = billing.limits.missionCapPerMonth;
    const missionUsage = missionCap ? Math.min(100, (billing.currentMonth.missions / missionCap) * 100) : 100;
    const spendUsage = billing.limits.llmSpendCapUsd > 0
      ? Math.min(100, (billing.currentMonth.llmSpendUsd / billing.limits.llmSpendCapUsd) * 100)
      : 0;
    const latest = missions.slice(0, 4);

    view.innerHTML = `
      <div class="overview-grid">
        <section class="overview-hero">
          <div>
            <p class="card-label">Mission runtime</p>
            <h2>Charter-driven. Fiscally gated. Audit logged.</h2>
            <p class="overview-copy">Praetor turns agent work into governed missions with caps, logs, receipts, and a path to paid execution.</p>
          </div>
          <pre class="ascii-mark" aria-hidden="true">PRAETOR
| charter
| fiscal_gate
| article12
| receipt</pre>
        </section>
        <section class="overview-rail">
          ${overviewMetric("Plan", billing.tier.toUpperCase(), `${missionCap === null ? "Unlimited" : missionCap} missions/mo`)}
          ${overviewMetric("Active", String(running), "queued or running")}
          ${overviewMetric("Sealed", String(completed), "completed missions")}
          ${overviewMetric("Keys", String(keys.length), "active API keys")}
        </section>
        <section class="card overview-card span-2">
          <div class="section-head">
            <div>
              <p class="card-label">Monthly usage</p>
              <p class="card-hint">Plan gates enforced by the API before every mission starts.</p>
            </div>
            <button class="btn-secondary overview-go" data-route-target="billing">Manage billing</button>
          </div>
          ${usageBar("Missions", billing.currentMonth.missions, missionCap, missionUsage)}
          ${usageBar("LLM wallet", billing.currentMonth.llmSpendUsd, billing.limits.llmSpendCapUsd, spendUsage, "$")}
        </section>
        <section class="card overview-card">
          <div class="section-head">
            <div>
              <p class="card-label">Next action</p>
              <p class="card-value compact">Run a governed mission</p>
            </div>
          </div>
          <p class="card-hint">Start with a charter for predictable scope, or chat if you want Praetor to shape the mission.</p>
          <div class="quick-actions">
            <button class="btn-primary overview-go" data-route-target="charters">Open charters</button>
            <button class="btn-secondary overview-go" data-route-target="chat">Open chat</button>
          </div>
        </section>
        <section class="card overview-card">
          <div class="section-head">
            <div>
              <p class="card-label">Trust surface</p>
              <p class="card-value compact">${billing.limits.articleTwelveAuditAllowed ? "Article 12 enabled" : "Audit upgrade gated"}</p>
            </div>
          </div>
          <p class="card-hint">${billing.limits.articleTwelveAuditAllowed ? `${billing.limits.auditRetentionMonths} months retention on current plan.` : "Upgrade to Pro for EU AI Act audit bundles."}</p>
          <button class="btn-secondary overview-go" data-route-target="audit">Inspect audit logs</button>
        </section>
        <section class="card overview-card span-2">
          <div class="section-head">
            <div>
              <p class="card-label">Recent missions</p>
              <p class="card-hint">Click any mission to open its audit trail.</p>
            </div>
            <button class="btn-secondary overview-go" data-route-target="missions">All missions</button>
          </div>
          <div class="mini-mission-list">
            ${latest.length ? latest.map((m) => `
              <button class="mini-mission" data-mission-id="${escapeHtml(m.id)}">
                <span class="status-pill ${statusClass(m.status)}">${escapeHtml(m.status)}</span>
                <span>${escapeHtml(m.goal)}</span>
                <em>${new Date(m.created_at).toLocaleDateString()}</em>
              </button>
            `).join("") : `<p class="card-hint">No missions yet. Launch one from Charters or Chat.</p>`}
          </div>
        </section>
      </div>
    `;

    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".overview-go"))) {
      btn.addEventListener("click", () => {
        currentRoute = btn.dataset.routeTarget as Route;
        render();
      });
    }
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".mini-mission"))) {
      btn.addEventListener("click", () => {
        selectedMissionId = btn.dataset.missionId ?? null;
        currentRoute = "audit";
        render();
      });
    }
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

function overviewMetric(label: string, value: string, hint: string): string {
  return `
    <div class="card overview-metric">
      <p class="card-label">${escapeHtml(label)}</p>
      <p class="card-value">${escapeHtml(value)}</p>
      <p class="card-hint">${escapeHtml(hint)}</p>
    </div>
  `;
}

function usageBar(label: string, used: number, cap: number | null, pct: number, prefix = ""): string {
  const usedText = `${prefix}${Number(used).toFixed(prefix ? 2 : 0)}`;
  const capText = cap === null ? "unlimited" : `${prefix}${Number(cap).toFixed(prefix ? 2 : 0)}`;
  return `
    <div class="usage-row">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(usedText)} / ${escapeHtml(capText)}</span>
      </div>
      <div class="usage-track"><span style="width:${pct.toFixed(1)}%"></span></div>
    </div>
  `;
}

function fiscalGateGauge(m: Mission): string {
  const budget = Number(m.budget ?? 0);
  const spent = Number(m.spent_usd ?? 0);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const halted = m.status === "halted-budget" || (budget > 0 && spent > budget);
  const fillClass = halted ? "halted" : pct > 80 ? "warn" : "ok";
  return `
    <div class="fg-gauge" title="FiscalGate: $${spent.toFixed(2)} of $${budget.toFixed(2)} cap">
      <div class="fg-fill ${fillClass}" style="width: ${pct.toFixed(1)}%"></div>
      <span class="fg-label">$${spent.toFixed(2)} <span class="fg-cap">/ $${budget.toFixed(2)}</span></span>
    </div>
  `;
}

function article12Badge(missionId: string, status: string): string {
  // Only completed/sealed missions can export. Show always for visibility, disable on incomplete.
  const complete = ["succeeded", "completed", "ok", "halted-budget", "failed"].includes(status);
  return `
    <a class="badge a12 ${complete ? "" : "muted"}"
       href="${complete ? API_BASE + "/api/v1/missions/" + missionId + "/article12" : "#"}"
       download="article12-${missionId}.json"
       ${complete ? "" : 'aria-disabled="true" tabindex="-1" onclick="return false"'}
       title="${complete ? "Download EU AI Act Article 12 audit bundle (Merkle-rooted)" : "Bundle exports after mission seals"}">
      <span class="dot"></span>
      <span>Article 12</span>
      ${complete ? '<span class="dl">↓</span>' : ""}
    </a>
  `;
}

// ─── Charter Gallery ──────────────────────────────────────────────────────────

async function renderCharters() {
  const { CHARTER_TEMPLATES, templatesByCategory } = await import("./charterTemplates.js");
  const view = document.getElementById("view");
  if (!view) return;
  const groups = templatesByCategory();
  const categoryLabel: Record<string, string> = { growth: "Growth", engineering: "Engineering", compliance: "Compliance", research: "Research", ops: "Ops" };
  const cat = (k: string) => categoryLabel[k] ?? k;

  view.innerHTML = `
    <div class="stack">
      <header>
        <p class="card-label">Charter Gallery · ${CHARTER_TEMPLATES.length} prebuilt missions</p>
        <p class="card-hint">One-click runs. Each charter is a signed YAML mission with a fiscal cap. Pick one and Praetor executes — no setup.</p>
      </header>
      ${Object.entries(groups).map(([k, items]) => `
        <section class="charter-section">
          <h3 class="charter-section-title">${cat(k)}</h3>
          <div class="charter-grid">
            ${items.map((t) => `
              <article class="charter-card" data-template-id="${t.id}">
                <header>
                  <h4>${escapeHtml(t.title)}</h4>
                  <span class="charter-cost">~$${t.estCostUsd.toFixed(2)}</span>
                </header>
                <p class="charter-desc">${escapeHtml(t.description)}</p>
                <p class="charter-tools">${t.tools.map((tt) => `<code>${escapeHtml(tt)}</code>`).join(" ")}</p>
                <footer>
                  <span class="charter-time">~${t.estDurationSec}s</span>
                  <button class="btn-primary btn-charter-run" data-template-id="${t.id}">Run charter</button>
                </footer>
              </article>
            `).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;

  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".btn-charter-run"))) {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const tplId = (event.currentTarget as HTMLElement).dataset.templateId;
      const tpl = CHARTER_TEMPLATES.find((t) => t.id === tplId);
      if (!tpl) return;
      btn.disabled = true;
      btn.textContent = "Launching…";
      try {
        const res = await authedFetch("/api/v1/missions", { method: "POST", body: JSON.stringify({ goal: tpl.goal, budgetUsd: Math.max(tpl.estCostUsd * 3, 0.5) }) });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error ?? res.statusText);
        currentRoute = "audit";
        selectedMissionId = j.missionId;
        render();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Run charter";
        alert(`Charter failed to launch: ${(err as Error).message}`);
      }
    });
  }
}

// ─── Chat (the conversation surface that was missing) ───────────────────────

function renderChat() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `
    <div class="chat-split">
      <div class="chat-shell">
        <div class="chat-toolbar">
          <label class="agent-picker-label" for="agentPicker">Agent</label>
          <select id="agentPicker" class="agent-picker">
            <option value="native">native</option>
            <option value="coding">coding</option>
            <option value="research">research</option>
            <option value="world-gen">world-gen</option>
          </select>
          <button class="btn-secondary activity-toggle" id="activityToggle" type="button">Activity</button>
        </div>
        <div id="agentToolsSummary" class="agent-tools-summary"></div>
        <div class="chat-stream" id="chatStream">${renderChatMessages()}</div>
        <form id="chatForm" class="chat-form">
          <textarea id="chatInput" class="chat-input" rows="2" placeholder="Tell Praetor what to do — e.g. 'Generate an SEO audit for example.com and email it to me'"></textarea>
          <button class="btn-primary" type="submit" id="chatSubmit">Run mission</button>
        </form>
        <p class="card-hint">Each prompt becomes a charter. Praetor streams logs back here as the mission executes.</p>
      </div>
      <aside class="activity-pane" id="activityPane">
        <header class="activity-pane-head">
          <span class="card-label">Live activity</span>
          <button class="btn-secondary activity-close" id="activityClose" type="button" aria-label="Close activity">×</button>
        </header>
        <div class="activity-list" id="activityList"></div>
      </aside>
    </div>
  `;
  const stream = document.getElementById("chatStream");
  if (stream) stream.scrollTop = stream.scrollHeight;
  const form = document.getElementById("chatForm") as HTMLFormElement | null;
  const input = document.getElementById("chatInput") as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById("chatSubmit") as HTMLButtonElement | null;
  const agentPicker = document.getElementById("agentPicker") as HTMLSelectElement | null;
  if (agentPicker) {
    agentPicker.value = selectedAgent;
    agentPicker.addEventListener("change", () => {
      selectedAgent = (agentPicker.value as AgentChoice);
      void renderAgentToolsSummary();
    });
  }
  void renderAgentToolsSummary();

  // Activity panel mount + slide-out toggle for narrow viewports.
  const activityHost = document.getElementById("activityList");
  if (activityHost) {
    activityPanel = new ActivityPanel(activityHost);
  }
  const pane = document.getElementById("activityPane");
  document.getElementById("activityToggle")?.addEventListener("click", () => {
    pane?.classList.toggle("activity-open");
  });
  document.getElementById("activityClose")?.addEventListener("click", () => {
    pane?.classList.remove("activity-open");
  });

  // If a mission is already selected, hydrate panel + open SSE.
  if (selectedMissionId) attachActivity(selectedMissionId);

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input?.value.trim() ?? "";
    if (!text) return;
    if (submitBtn) submitBtn.disabled = true;
    if (input) input.value = "";
    try {
      // If a mission is in-flight, treat the input as a follow-up message
      // (the "talk back" surface). Otherwise spawn a new mission.
      if (activityMissionId && isMissionLive(activityMissionId)) {
        await sendChatMessage(activityMissionId, text);
      } else {
        chatLog.push({ id: cryptoId(), role: "user", content: text });
        refreshChat();
        const res = await authedFetch("/api/v1/missions", {
          method: "POST",
          body: JSON.stringify({ goal: text, agent: selectedAgent }),
        });
        const payload = await res.json();
        if (!res.ok || !payload.missionId) {
          chatLog.push({ id: cryptoId(), role: "system", content: `Failed to start: ${payload.error ?? res.statusText}` });
        } else {
          const placeholder: ChatMessage = {
            id: cryptoId(),
            role: "praetor",
            content: "Mission queued. Streaming logs…",
            missionId: payload.missionId,
            status: "queued",
          };
          chatLog.push(placeholder);
          watchMission(placeholder.id, payload.missionId);
          attachActivity(payload.missionId);
        }
      }
    } catch (err) {
      chatLog.push({ id: cryptoId(), role: "system", content: `Network error: ${(err as Error).message}` });
    }
    refreshChat();
    refreshComposerState();
    if (submitBtn) submitBtn.disabled = false;
  });
  refreshComposerState();
}

/**
 * Send a follow-up message to an already-running mission. Persists on the
 * server as a chat.user activity event; the SSE stream echoes it back into
 * the activity panel so we don't duplicate it locally here.
 */
async function sendChatMessage(missionId: string, text: string): Promise<void> {
  const res = await authedFetch(`/api/v1/missions/${encodeURIComponent(missionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, role: "user" }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    chatLog.push({
      id: cryptoId(),
      role: "system",
      content: `Failed to send message: ${(payload as { error?: string }).error ?? res.statusText}`,
    });
  }
}

/** True iff the most recent mission with this id is queued or running. */
function isMissionLive(missionId: string): boolean {
  const msg = [...chatLog].reverse().find((m) => m.missionId === missionId);
  if (!msg) return false;
  return msg.status === "queued" || msg.status === "running";
}

/** Toggle the composer between "Run mission" and "Send message" modes. */
function refreshComposerState(): void {
  const submit = document.getElementById("chatSubmit") as HTMLButtonElement | null;
  const input = document.getElementById("chatInput") as HTMLTextAreaElement | null;
  if (!submit) return;
  const live = !!(activityMissionId && isMissionLive(activityMissionId));
  submit.textContent = live ? "Send message" : "Run mission";
  if (input) {
    input.placeholder = live
      ? "Talk back to the running mission — it will be queued for the agent loop"
      : "Tell Praetor what to do — e.g. 'Generate an SEO audit for example.com and email it to me'";
  }
}

/** Subscribe the activity panel to a mission: hydrate from history then open SSE. */
function attachActivity(missionId: string): void {
  if (!session || !activityPanel) return;
  window.localStorage.setItem("praetor.artifactToken", session.access_token);
  if (activityMissionId === missionId && activityStream) return;
  // Tear down previous stream if mission changed.
  activityStream?.close();
  activityStream = null;
  activityMissionId = missionId;
  activityPanel.reset();

  // Backfill last 50 events via the standard mission endpoint? The backend
  // backlog is sent by the SSE route on connect, so we just open the stream.
  activityStream = openActivityStream({
    apiBase: API_BASE,
    token: session.access_token,
    missionId,
    onEvent: (e) => activityPanel?.push(e as ActivityEvent),
  });
}

function renderChatMessages(): string {
  if (chatLog.length === 0) {
    return `<div class="chat-empty">
      <h2>Start a mission</h2>
      <p>Describe a goal. Praetor will write a charter, run it through the fiscal gate, and stream every step back.</p>
      <ul class="chat-suggestions">
        <li>"Scrape mnemopay.com and write a competitor GEO profile"</li>
        <li>"Generate an OpenGraph image for 'Praetor — Mission Runtime'"</li>
        <li>"Build a Godot 4.4 retro pong project with sprite sheets"</li>
      </ul>
    </div>`;
  }
  return chatLog.map((m) => {
    const body = m.role === "praetor"
      ? praetorRenderMarkdown(m.content)
      : escapeHtml(m.content);
    const status = m.status ? `<span class="status-pill ${statusClass(m.status)}">${m.status}</span>` : "";
    const link = m.missionId ? `<button class="link-btn" data-mission-id="${m.missionId}" data-msg-id="${m.id}">Open in Audit ↗</button>` : "";
    return `<div class="chat-msg chat-${m.role}">
      <div class="chat-msg-header"><span class="role-tag">${m.role}</span>${status}${link}</div>
      <div class="chat-msg-body">${body}</div>
    </div>`;
  }).join("");
}

function refreshChat() {
  const stream = document.getElementById("chatStream");
  if (!stream) return;
  stream.innerHTML = renderChatMessages();
  stream.scrollTop = stream.scrollHeight;
  for (const btn of Array.from(stream.querySelectorAll<HTMLButtonElement>(".link-btn"))) {
    btn.addEventListener("click", () => {
      selectedMissionId = btn.dataset.missionId ?? null;
      currentRoute = "audit";
      render();
    });
  }
}

function watchMission(messageId: string, missionId: string) {
  const tick = async () => {
    try {
      const res = await authedFetch(`/api/v1/missions/${missionId}`);
      const payload = await res.json();
      if (!payload.ok) return;
      const msg = chatLog.find((m) => m.id === messageId);
      if (!msg) return stopMissionPoller(missionId);
      msg.status = payload.mission.status;
      const logs = (payload.logs ?? []) as string[];
      const tail = logs.slice(-25).join("\n").trim();
      msg.content = tail
        ? "```\n" + tail + "\n```"
        : "Mission queued. Waiting for first output…";
      refreshChat();
      refreshComposerState();
      if (payload.mission.status === "completed" || payload.mission.status === "failed") {
        stopMissionPoller(missionId);
      }
    } catch {
      // network blips: ignore, the next tick may succeed
    }
  };
  void tick();
  const handle = window.setInterval(tick, 2500);
  pollers.set(missionId, handle);
}

function stopMissionPoller(missionId: string) {
  const handle = pollers.get(missionId);
  if (handle !== undefined) {
    window.clearInterval(handle);
    pollers.delete(missionId);
  }
}

function stopAllPollers() {
  for (const handle of pollers.values()) window.clearInterval(handle);
  pollers.clear();
}

// ─── Missions ─────────────────────────────────────────────────────────────────

async function renderMissions() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `<p class="card-hint">Loading missions…</p>`;
  try {
    const res = await authedFetch("/api/v1/missions");
    const payload = await res.json();
    if (!res.ok) {
      view.innerHTML = `<p class="card-hint error">Failed to load missions: ${payload.error ?? res.statusText}</p>`;
      return;
    }
    const missions = (payload.missions ?? []) as Mission[];
    view.innerHTML = `
      <div class="stack">
        <form id="missionForm" class="chat-form inline">
          <input id="goalInput" class="chat-input" placeholder="Define a mission goal…" />
          <button class="btn-primary" type="submit">Create mission</button>
        </form>
        ${missions.length === 0 ? `<p class="card-hint">No missions yet. Try the Chat tab to start one.</p>` : ""}
        <div class="cards">
          ${missions.map((m) => `
            <div class="card mission-row" data-mission-id="${m.id}">
              <div class="mission-row-head">
                <span class="status-pill ${statusClass(m.status)}">${m.status}</span>
                ${article12Badge(m.id, m.status)}
              </div>
              <p class="card-value">${escapeHtml(m.goal)}</p>
              ${m.budget ? fiscalGateGauge(m) : ""}
              <p class="card-hint">${m.id} · ${new Date(m.created_at).toLocaleString()}</p>
              <div class="mission-row-actions">
                <button class="btn-secondary mission-open-theater" data-mission-id="${m.id}" type="button">Open in Theater ↗</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    const form = document.getElementById("missionForm") as HTMLFormElement | null;
    const goalInput = document.getElementById("goalInput") as HTMLInputElement | null;
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const goal = goalInput?.value.trim() ?? "";
      if (!goal) return;
      await authedFetch("/api/v1/missions", { method: "POST", body: JSON.stringify({ goal }) });
      await renderMissions();
    });
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".mission-open-theater"))) {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedMissionId = btn.dataset.missionId ?? null;
        currentRoute = "theater";
        render();
      });
    }
    for (const row of Array.from(document.querySelectorAll<HTMLElement>(".mission-row"))) {
      row.addEventListener("click", () => {
        selectedMissionId = row.dataset.missionId ?? null;
        currentRoute = "audit";
        render();
      });
    }
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

// ─── Audit ────────────────────────────────────────────────────────────────────

async function renderAudit() {
  const view = document.getElementById("view");
  if (!view) return;
  if (!selectedMissionId) {
    view.innerHTML = `<p class="card-hint">Select a mission from Missions to inspect logs, or run one from Chat.</p>`;
    return;
  }
  view.innerHTML = `<p class="card-hint">Loading mission…</p>`;
  try {
    const res = await authedFetch(`/api/v1/missions/${selectedMissionId}`);
    const payload = await res.json();
    if (!payload.ok) {
      view.innerHTML = `<p class="card-hint error">${escapeHtml(payload.error ?? "Unable to fetch mission")}</p>`;
      return;
    }
    const logs = (payload.logs ?? []) as string[];
    view.innerHTML = `
      <div class="stack">
        <header class="audit-header">
          <div class="audit-header-left">
            <p class="card-label">Mission</p>
            <p class="card-value">${escapeHtml(payload.mission.goal)}</p>
            <p class="card-hint">${selectedMissionId}</p>
          </div>
          <div class="audit-header-right">
            <span class="status-pill ${statusClass(payload.mission.status)}">${payload.mission.status}</span>
            ${article12Badge(selectedMissionId!, payload.mission.status)}
            <button class="btn-secondary audit-open-theater" type="button">Open in Theater ↗</button>
          </div>
        </header>
        ${payload.mission.budget ? fiscalGateGauge(payload.mission) : ""}
        <pre class="ledger">${escapeHtml(logs.join("\n") || "(no log lines yet)")}</pre>
      </div>
    `;
    document.querySelector<HTMLButtonElement>(".audit-open-theater")?.addEventListener("click", () => {
      currentRoute = "theater";
      render();
    });
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

// ─── Billing ──────────────────────────────────────────────────────────────────

async function renderBilling() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `<p class="card-hint">Loading billing...</p>`;
  try {
    const [billingRes, keysRes] = await Promise.all([
      authedFetch("/api/v1/billing"),
      authedFetch("/api/v1/keys"),
    ]);
    const payload = (await billingRes.json()) as BillingPayload;
    const keyPayload = await keysRes.json();
    if (!billingRes.ok || !payload.ok) {
      view.innerHTML = `<p class="card-hint error">Failed to load billing: ${escapeHtml((payload as any).error ?? billingRes.statusText)}</p>`;
      return;
    }
    const keys = (keyPayload.keys ?? []) as ApiKey[];
    const missionCap = payload.limits.missionCapPerMonth;
    const missionUsage = missionCap ? Math.min(100, (payload.currentMonth.missions / missionCap) * 100) : 100;
    const spendUsage = payload.limits.llmSpendCapUsd > 0
      ? Math.min(100, (payload.currentMonth.llmSpendUsd / payload.limits.llmSpendCapUsd) * 100)
      : 0;
    view.innerHTML = `
      <div class="billing-shell">
        <section class="billing-head">
          <div>
            <p class="card-label">Billing and access</p>
            <h2>${payload.tier.toUpperCase()} plan</h2>
            <p class="card-hint">${missionCap === null ? "Unlimited missions" : `${missionCap} missions per month`} · $${payload.limits.llmSpendCapUsd}/mo LLM wallet · ${payload.limits.seatsIncluded} seat${payload.limits.seatsIncluded === 1 ? "" : "s"}</p>
          </div>
          <button class="btn-primary checkout-btn" data-lookup-key="${escapeHtml(payload.pricing.pro.monthly.lookupKey)}">Upgrade to Pro</button>
        </section>

        <section class="cards">
          ${planCard("Free", "$0", "5 missions/mo", ["$1 LLM cap", "Public charters", "No Article 12 audit"], payload.tier === "free")}
          ${planCard("Pro", "$29", "100 missions/mo", ["$25 LLM cap", "Private charters", "EU AI Act audit bundles"], payload.tier === "pro", payload.pricing.pro.monthly.lookupKey, payload.pricing.pro.yearly.lookupKey)}
          ${planCard("Team", "$99", "Unlimited missions", ["$100 LLM cap", "5 seats", "Marketplace publish"], payload.tier === "team", payload.pricing.team.monthly.lookupKey, payload.pricing.team.yearly.lookupKey)}
          ${planCard("Enterprise", "Custom", "Governance stack", ["SLA", "On-prem", "KYA and 7y retention"], payload.tier === "enterprise")}
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <p class="card-label">Current month</p>
              <p class="card-hint">These counters are the gates Praetor checks before running work.</p>
            </div>
          </div>
          ${usageBar("Missions", payload.currentMonth.missions, missionCap, missionUsage)}
          ${usageBar("LLM wallet", payload.currentMonth.llmSpendUsd, payload.limits.llmSpendCapUsd, spendUsage, "$")}
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <p class="card-label">API keys</p>
              <p class="card-hint">Use these with the SDK, CLI, and worker integrations. Plaintext appears once.</p>
            </div>
            <form id="keyForm" class="key-form">
              <input id="keyName" class="field" placeholder="ci-prod" maxlength="64" />
              <button class="btn-primary" type="submit">Create key</button>
            </form>
          </div>
          <div id="newKeyReveal"></div>
          <div class="key-list">
            ${keys.length ? keys.map(renderApiKeyRow).join("") : `<p class="card-hint">No API keys yet.</p>`}
          </div>
        </section>
      </div>
    `;
    wireBillingHandlers();
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

function planCard(
  name: string,
  price: string,
  headline: string,
  features: string[],
  active: boolean,
  monthlyLookup?: string,
  yearlyLookup?: string,
): string {
  const action = monthlyLookup
    ? `<div class="plan-actions">
        <button class="btn-primary checkout-btn" data-lookup-key="${escapeHtml(monthlyLookup)}">${active ? "Current monthly" : "Choose monthly"}</button>
        ${yearlyLookup ? `<button class="btn-secondary checkout-btn" data-lookup-key="${escapeHtml(yearlyLookup)}">Yearly</button>` : ""}
      </div>`
    : name === "Enterprise"
      ? `<a class="btn-secondary" href="mailto:jeremiah@getbizsuite.com">Contact sales</a>`
      : `<span class="status-pill ${active ? "ok" : ""}">${active ? "Current plan" : "Starter"}</span>`;
  return `
    <article class="card plan-card ${active ? "active-plan" : ""}">
      <p class="card-label">${active ? "Current" : "Plan"}</p>
      <div class="plan-price"><strong>${escapeHtml(price)}</strong>${price.startsWith("$") ? "<span>/mo</span>" : ""}</div>
      <p class="card-value compact">${escapeHtml(name)}</p>
      <p class="card-hint">${escapeHtml(headline)}</p>
      <ul>${features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
      ${action}
    </article>
  `;
}

function renderApiKeyRow(key: ApiKey): string {
  const created = key.createdAt ? new Date(key.createdAt).toLocaleString() : "unknown";
  const revoked = Boolean(key.revokedAt);
  return `
    <div class="api-key-row ${revoked ? "revoked" : ""}">
      <div>
        <strong>${escapeHtml(key.name)}</strong>
        <span>${escapeHtml(key.keyPrefix)}... · created ${escapeHtml(created)}</span>
      </div>
      <button class="btn-secondary revoke-key" data-key-id="${escapeHtml(key.id)}" ${revoked ? "disabled" : ""}>${revoked ? "Revoked" : "Revoke"}</button>
    </div>
  `;
}

function wireBillingHandlers() {
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".checkout-btn"))) {
    btn.addEventListener("click", async () => {
      const lookupKey = btn.dataset.lookupKey;
      if (!lookupKey) return;
      btn.disabled = true;
      const original = btn.textContent ?? "Checkout";
      btn.textContent = "Opening Stripe...";
      try {
        const res = await authedFetch("/api/v1/checkout/session", {
          method: "POST",
          body: JSON.stringify({
            priceLookupKey: lookupKey,
            successUrl: `${window.location.origin}/billing?status=success&session={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${window.location.origin}/billing?status=cancel`,
          }),
        });
        const payload = await res.json();
        if (!res.ok || !payload.ok || !payload.url) throw new Error(payload.error ?? res.statusText);
        window.location.href = payload.url;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = original;
        alert(`Checkout failed: ${(err as Error).message}`);
      }
    });
  }

  const form = document.getElementById("keyForm") as HTMLFormElement | null;
  const nameInput = document.getElementById("keyName") as HTMLInputElement | null;
  const reveal = document.getElementById("newKeyReveal");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput?.value.trim() || "default";
    try {
      const res = await authedFetch("/api/v1/keys", { method: "POST", body: JSON.stringify({ name }) });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error(payload.error ?? res.statusText);
      if (nameInput) nameInput.value = "";
      await renderBilling();
      const refreshedReveal = document.getElementById("newKeyReveal");
      if (refreshedReveal) {
        refreshedReveal.innerHTML = `
          <div class="key-secret">
            <p class="card-label">New API key</p>
            <code>${escapeHtml(payload.secret)}</code>
            <p class="card-hint">${escapeHtml(payload.warning ?? "Save this key. It will not be shown again.")}</p>
          </div>
        `;
      }
    } catch (err) {
      alert(`Key creation failed: ${(err as Error).message}`);
    }
  });

  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".revoke-key"))) {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.keyId;
      if (!id) return;
      btn.disabled = true;
      try {
        await authedFetch(`/api/v1/keys/${encodeURIComponent(id)}/revoke`, { method: "POST" });
        await renderBilling();
      } catch (err) {
        btn.disabled = false;
        alert(`Revoke failed: ${(err as Error).message}`);
      }
    });
  }
}

// ─── World ───────────────────────────────────────────────────────────────
// Browses 3D models, gaussian-splat worlds, and SuperSplat-edited scenes
// produced by @kpanks/world-gen tools (generate_3d_model, generate_3d_world,
// publish_3d_scene). Embeds <model-viewer> for GLBs and Spark 2.0 for splats.

// Tools

async function renderTools() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `<p class="card-hint">Loading tool governance...</p>`;
  try {
    const res = await authedFetch("/api/v1/tools");
    const payload = await res.json();
    if (!res.ok || !payload.ok) {
      view.innerHTML = `<p class="card-hint error">Failed to load tools: ${escapeHtml(payload.error ?? res.statusText)}</p>`;
      return;
    }
    const tools = (payload.tools ?? []) as ToolCatalogItem[];
    const report = payload.report as ToolCatalogReport;
    view.innerHTML = `
      <div class="stack">
        <div class="tool-toolbar">
          <div>
            <p class="card-label">Tool governance</p>
            <p class="card-hint">Live registry metadata for origin, readiness, risk, approval gates, sandbox, and cost posture.</p>
          </div>
          <button class="btn-secondary" id="refreshTools">Refresh</button>
        </div>
        <div class="tool-summary">
          ${metricCard("Total", String(report.total))}
          ${metricCard("Native", String(report.byOrigin?.native ?? 0))}
          ${metricCard("Ready", String(report.byState?.ready ?? 0))}
          ${metricCard("Needs work", String((report.byState?.["needs-live-test"] ?? 0) + (report.byState?.["needs-native-rewrite"] ?? 0) + (report.byState?.stub ?? 0)))}
          ${metricCard("Missing metadata", String(report.missingMetadata?.length ?? 0))}
        </div>
        ${report.missingMetadata?.length ? `
          <div class="card tool-warning">
            <p class="card-label">Missing metadata</p>
            <p class="card-hint">${escapeHtml(report.missingMetadata.join(", "))}</p>
          </div>
        ` : ""}
        <div class="tool-grid">
          ${tools.map(renderToolCard).join("")}
        </div>
      </div>
    `;
    document.getElementById("refreshTools")?.addEventListener("click", () => void renderTools());
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

function metricCard(label: string, value: string): string {
  return `
    <div class="card tool-metric">
      <p class="card-label">${escapeHtml(label)}</p>
      <p class="card-value">${escapeHtml(value)}</p>
    </div>
  `;
}

function renderToolCard(tool: ToolCatalogItem): string {
  const meta = tool.metadata;
  const state = meta?.production ?? "missing";
  const origin = meta?.origin ?? "unknown";
  const risks = meta?.risk?.length ? meta.risk.join(", ") : "none";
  const roles = tool.allowedRoles.length ? tool.allowedRoles.join(", ") : "all roles";
  const cost = tool.costUsd > 0 ? `$${tool.costUsd.toFixed(4)}` : "free/local";
  return `
    <article class="card tool-card">
      <div>
        <p class="card-label">${escapeHtml(origin)} / ${escapeHtml(state)}</p>
        <p class="tool-name">${escapeHtml(tool.name)}</p>
        <p class="card-hint">${escapeHtml(tool.description)}</p>
      </div>
      <div class="tool-badges">
        <span class="tool-badge ${toolBadgeClass(state)}">${escapeHtml(state)}</span>
        <span class="tool-badge">${escapeHtml(meta?.sandbox ?? "unknown sandbox")}</span>
        <span class="tool-badge">${escapeHtml(meta?.approval ?? "unknown approval")}</span>
        <span class="tool-badge">${escapeHtml(cost)}</span>
      </div>
      <dl class="tool-facts">
        <div><dt>Capability</dt><dd>${escapeHtml(meta?.capability ?? "missing")}</dd></div>
        <div><dt>Risk</dt><dd>${escapeHtml(risks)}</dd></div>
        <div><dt>Roles</dt><dd>${escapeHtml(roles)}</dd></div>
        ${meta?.costEffective ? `<div><dt>Cost posture</dt><dd>cost effective</dd></div>` : ""}
      </dl>
      ${meta?.note ? `<p class="tool-note">${escapeHtml(meta.note)}</p>` : ""}
      ${tool.tags.length ? `<p class="tool-tags">${escapeHtml(tool.tags.join(" / "))}</p>` : ""}
    </article>
  `;
}

function toolBadgeClass(state: string): string {
  switch (state) {
    case "ready": return "ready";
    case "needs-live-test": return "warn";
    case "needs-native-rewrite":
    case "stub":
    case "missing":
      return "err";
    default:
      return "";
  }
}

async function renderWorld() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `<p class="card-hint">Loading scenes…</p>`;
  try {
    const res = await authedFetch("/api/v1/world-gen/scenes");
    const payload = await res.json();
    if (!res.ok) {
      view.innerHTML = `<p class="card-hint error">${escapeHtml(payload.error ?? "Unable to load scenes")}</p>`;
      return;
    }
    const scenes = (payload.scenes ?? []) as WorldScene[];
    view.innerHTML = `
      <div class="stack">
        <div class="world-toolbar">
          <div>
            <p class="card-label">World-gen scenes</p>
            <p class="card-hint">Run <code>generate_3d_model</code> / <code>generate_3d_world</code> in chat, then publish with <code>publish_3d_scene</code>.</p>
          </div>
          <button class="btn-secondary" id="refreshScenes">Refresh</button>
        </div>
        ${scenes.length === 0 ? `
          <div class="card">
            <p class="card-label">No scenes yet</p>
            <p class="card-hint">Try a chat prompt like “Generate a 3D model of a cyberpunk lantern, then publish it as scene <code>lantern-01</code>”.</p>
          </div>
        ` : `
          <div class="world-grid">
            ${scenes.map(renderSceneCard).join("")}
          </div>
        `}
      </div>
    `;
    document.getElementById("refreshScenes")?.addEventListener("click", () => void renderWorld());
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".scene-edit-btn"))) {
      btn.addEventListener("click", () => {
        const url = btn.dataset.url;
        if (!url) return;
        const supersplat = `https://playcanvas.com/supersplat/editor?load=${encodeURIComponent(url)}`;
        window.open(supersplat, "_blank", "noopener,noreferrer");
      });
    }
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

function renderSceneCard(scene: WorldScene): string {
  const kind = scene.splatUrl ? "world" : "model";
  const viewerSrc = `${API_BASE}${scene.viewerPath}`;
  const editLink = scene.splatUrl
    ? `<button class="btn-secondary scene-edit-btn" data-url="${escapeHtml(scene.splatUrl)}">Edit in SuperSplat ↗</button>`
    : "";
  const ts = scene.publishedAt ? new Date(scene.publishedAt).toLocaleString() : "unpublished";
  return `
    <div class="card scene-card">
      <p class="card-label">${escapeHtml(kind)} · ${ts}</p>
      <p class="card-value">${escapeHtml(scene.title || scene.id)}</p>
      <iframe class="scene-frame" src="${escapeHtml(viewerSrc)}" loading="lazy" allow="xr-spatial-tracking; fullscreen"></iframe>
      <div class="scene-actions">
        <a class="btn-secondary" href="${escapeHtml(viewerSrc)}" target="_blank" rel="noopener">Open viewer ↗</a>
        ${editLink}
      </div>
    </div>
  `;
}

// ─── Marketplace ──────────────────────────────────────────────────────────────

async function renderMarketplace() {
  const view = document.getElementById("view");
  if (!view) return;
  try {
    const res = await authedFetch("/api/v1/marketplace/plugins");
    const payload = await res.json();
    const plugins = (payload.plugins ?? []) as Plugin[];
    const installed = new Set<string>((payload.installed ?? []) as string[]);
    view.innerHTML = `
      <div class="cards">
        ${plugins.map((p) => {
          const isInstalled = installed.has(p.name);
          return `
            <div class="card">
              <p class="card-label">${escapeHtml(p.provider)} · v${escapeHtml(p.version)}</p>
              <p class="card-value">${escapeHtml(p.name)}</p>
              <p class="card-hint">${escapeHtml(p.description)}</p>
              <button class="btn-primary install-btn" data-plugin="${escapeHtml(p.name)}" ${isInstalled ? "disabled" : ""}>
                ${isInstalled ? "Installed" : "Install"}
              </button>
            </div>
          `;
        }).join("")}
      </div>
    `;
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".install-btn"))) {
      button.addEventListener("click", async () => {
        const pluginName = button.dataset.plugin;
        if (!pluginName) return;
        button.disabled = true;
        await authedFetch("/api/v1/marketplace/install", {
          method: "POST",
          body: JSON.stringify({ pluginName }),
        });
        await renderMarketplace();
      });
    }
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusClass(status: string): string {
  switch (status) {
    case "completed": return "ok";
    case "running": return "warn";
    case "queued": return "warn";
    case "failed": return "err";
    default: return "";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
