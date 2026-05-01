import "./style.css";
import { createClient, type Session } from "@supabase/supabase-js";
import { marked } from "marked";
import DOMPurify from "dompurify";

type Route = "chat" | "missions" | "audit" | "billing" | "marketplace";
type Mission = { id: string; status: string; goal: string; created_at: string };
type Plugin = { name: string; version: string; provider: string; description: string };
type ChatMessage = { id: string; role: "user" | "praetor" | "system"; content: string; missionId?: string; status?: string };

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("dashboard: #app container not found");

const supabase = SUPABASE_CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let session: Session | null = null;
let currentRoute: Route = "chat";
let selectedMissionId: string | null = null;
let chatLog: ChatMessage[] = [];
const pollers = new Map<string, number>();

void bootstrap();

async function bootstrap() {
  if (!SUPABASE_CONFIGURED) {
    renderConfigError();
    return;
  }
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  session = data.session;
  render();
  supabase.auth.onAuthStateChange((_evt, s) => {
    session = s;
    if (!session) {
      selectedMissionId = null;
      chatLog = [];
      stopAllPollers();
    }
    render();
  });
}

function renderConfigError() {
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div>
          <h1>Praetor SaaS</h1>
          <p class="subtitle">Configuration required</p>
        </div>
      </header>
      <section class="glass-panel">
        <p class="card-hint">Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>packages/dashboard/.env</code> and restart the dev server.</p>
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
          <button id="signOutBtn" class="btn-secondary">Sign out</button>
        </div>
      </header>
      <nav class="tabs">
        ${tabButton("chat", "Chat")}
        ${tabButton("missions", "Missions")}
        ${tabButton("audit", "Audit")}
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
  switch (currentRoute) {
    case "chat": return renderChat();
    case "missions": return renderMissions();
    case "audit": return renderAudit();
    case "billing": return renderBilling();
    case "marketplace": return renderMarketplace();
  }
}

// ─── Chat (the conversation surface that was missing) ───────────────────────

function renderChat() {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `
    <div class="chat-shell">
      <div class="chat-stream" id="chatStream">${renderChatMessages()}</div>
      <form id="chatForm" class="chat-form">
        <textarea id="chatInput" class="chat-input" rows="2" placeholder="Tell Praetor what to do — e.g. 'Generate an SEO audit for example.com and email it to me'"></textarea>
        <button class="btn-primary" type="submit" id="chatSubmit">Run mission</button>
      </form>
      <p class="card-hint">Each prompt becomes a charter. Praetor streams logs back here as the mission executes.</p>
    </div>
  `;
  const stream = document.getElementById("chatStream");
  if (stream) stream.scrollTop = stream.scrollHeight;
  const form = document.getElementById("chatForm") as HTMLFormElement | null;
  const input = document.getElementById("chatInput") as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById("chatSubmit") as HTMLButtonElement | null;
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const goal = input?.value.trim() ?? "";
    if (!goal) return;
    if (submitBtn) submitBtn.disabled = true;
    chatLog.push({ id: cryptoId(), role: "user", content: goal });
    if (input) input.value = "";
    refreshChat();
    try {
      const res = await authedFetch("/api/v1/missions", {
        method: "POST",
        body: JSON.stringify({ goal }),
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
      }
    } catch (err) {
      chatLog.push({ id: cryptoId(), role: "system", content: `Network error: ${(err as Error).message}` });
    }
    refreshChat();
    if (submitBtn) submitBtn.disabled = false;
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
      ? DOMPurify.sanitize(marked.parse(m.content, { async: false }) as string)
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
              <p class="card-label"><span class="status-pill ${statusClass(m.status)}">${m.status}</span></p>
              <p class="card-value">${escapeHtml(m.goal)}</p>
              <p class="card-hint">${m.id} · ${new Date(m.created_at).toLocaleString()}</p>
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
          <div>
            <p class="card-label">Mission</p>
            <p class="card-value">${escapeHtml(payload.mission.goal)}</p>
            <p class="card-hint">${selectedMissionId}</p>
          </div>
          <span class="status-pill ${statusClass(payload.mission.status)}">${payload.mission.status}</span>
        </header>
        <pre class="ledger">${escapeHtml(logs.join("\n") || "(no log lines yet)")}</pre>
      </div>
    `;
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
}

// ─── Billing ──────────────────────────────────────────────────────────────────

async function renderBilling() {
  const view = document.getElementById("view");
  if (!view) return;
  try {
    const res = await authedFetch("/api/v1/billing");
    const payload = await res.json();
    view.innerHTML = `
      <div class="cards">
        <div class="card">
          <p class="card-label">Threshold USD</p>
          <p class="card-value">$${Number(payload.thresholdUsd ?? 0).toFixed(2)}</p>
          <p class="card-hint">Default mission budget</p>
        </div>
        <div class="card">
          <p class="card-label">Current spend USD</p>
          <p class="card-value">$${Number(payload.currentSpendUsd ?? 0).toFixed(2)}</p>
          <p class="card-hint">Settled via MnemoPay</p>
        </div>
      </div>
    `;
  } catch (err) {
    view.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml((err as Error).message)}</p>`;
  }
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
