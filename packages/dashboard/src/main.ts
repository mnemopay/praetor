import "./style.css";
import { createClient, type Session } from "@supabase/supabase-js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ActivityPanel, type ActivityEvent } from "./components/ActivityPanel.js";
import { openActivityStream, type ActivityStreamHandle } from "./eventStream.js";

type Route = "chat" | "missions" | "audit" | "billing" | "marketplace" | "world";
type Mission = { id: string; status: string; goal: string; created_at: string };
type Plugin = { name: string; version: string; provider: string; description: string };
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
let activityPanel: ActivityPanel | null = null;
let activityStream: ActivityStreamHandle | null = null;
let activityMissionId: string | null = null;
let selectedAgent: AgentChoice = "native";

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
    case "world": return renderWorld();
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
    });
  }

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
    const goal = input?.value.trim() ?? "";
    if (!goal) return;
    if (submitBtn) submitBtn.disabled = true;
    chatLog.push({ id: cryptoId(), role: "user", content: goal });
    if (input) input.value = "";
    refreshChat();
    try {
      const res = await authedFetch("/api/v1/missions", {
        method: "POST",
        body: JSON.stringify({ goal, agent: selectedAgent }),
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
    } catch (err) {
      chatLog.push({ id: cryptoId(), role: "system", content: `Network error: ${(err as Error).message}` });
    }
    refreshChat();
    if (submitBtn) submitBtn.disabled = false;
  });
}

/** Subscribe the activity panel to a mission: hydrate from history then open SSE. */
function attachActivity(missionId: string): void {
  if (!session || !activityPanel) return;
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

// ─── World ───────────────────────────────────────────────────────────────
// Browses 3D models, gaussian-splat worlds, and SuperSplat-edited scenes
// produced by @praetor/world-gen tools (generate_3d_model, generate_3d_world,
// publish_3d_scene). Embeds <model-viewer> for GLBs and Spark 2.0 for splats.

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
