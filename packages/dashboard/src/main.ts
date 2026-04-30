import "./style.css";
import { createClient, type Session } from "@supabase/supabase-js";

type Route = "missions" | "audit" | "billing" | "marketplace";
type Mission = { id: string; status: string; goal: string; created_at: string };
type Plugin = { name: string; version: string; provider: string; description: string };

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8788";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("dashboard: #app container not found");

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let session: Session | null = null;
let currentRoute: Route = "missions";
let selectedMissionId: string | null = null;

void bootstrap();

async function bootstrap() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  render();
  supabase.auth.onAuthStateChange((_evt, s) => {
    session = s;
    if (!session) {
      selectedMissionId = null;
    }
    render();
  });
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
          <h1>Praetor SaaS</h1>
          <p class="subtitle">Mission control, audit logs, billing, marketplace</p>
        </div>
        <button id="signOutBtn" class="btn-primary">Sign out</button>
      </header>
      <nav class="tabs">
        ${tabButton("missions", "Missions")}
        ${tabButton("audit", "Audit Logs")}
        ${tabButton("billing", "Billing")}
        ${tabButton("marketplace", "Marketplace")}
      </nav>
      <section class="glass-panel" id="view"></section>
    </main>
  `;
  wireAuthedHandlers();
  void renderRoute();
}

function renderLogin() {
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div>
          <h1>Praetor SaaS</h1>
          <p class="subtitle">Sign in to manage your tenant missions</p>
        </div>
      </header>
      <section class="glass-panel">
        <form id="loginForm" class="stack">
          <label>Email</label>
          <input id="emailInput" class="chat-input field" type="email" required placeholder="you@company.com" />
          <label>Password</label>
          <input id="passwordInput" class="chat-input field" type="password" required placeholder="••••••••" />
          <button class="btn-primary" type="submit">Sign in</button>
          <p id="loginError" class="card-hint"></p>
        </form>
      </section>
    </main>
  `;

  const form = document.getElementById("loginForm") as HTMLFormElement | null;
  const emailInput = document.getElementById("emailInput") as HTMLInputElement | null;
  const passwordInput = document.getElementById("passwordInput") as HTMLInputElement | null;
  const loginError = document.getElementById("loginError") as HTMLParagraphElement | null;
  if (!form || !emailInput || !passwordInput || !loginError) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (error) loginError.textContent = error.message;
  });
}

function tabButton(route: Route, label: string): string {
  const activeClass = currentRoute === route ? "tab-btn active-tab" : "tab-btn";
  return `<button class="${activeClass}" data-route="${route}">${label}</button>`;
}

function wireAuthedHandlers() {
  const signOutBtn = document.getElementById("signOutBtn");
  signOutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-btn"));
  for (const btn of tabButtons) {
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

async function renderRoute() {
  switch (currentRoute) {
    case "missions":
      await renderMissions();
      return;
    case "audit":
      await renderAudit();
      return;
    case "billing":
      await renderBilling();
      return;
    case "marketplace":
      await renderMarketplace();
      return;
  }
}

async function renderMissions() {
  const view = document.getElementById("view");
  if (!view) return;
  const res = await authedFetch("/api/v1/missions");
  const payload = await res.json();
  const missions = (payload.missions ?? []) as Mission[];
  view.innerHTML = `
    <div class="stack">
      <form id="missionForm" class="chat-form">
        <input id="goalInput" class="chat-input" placeholder="Define a mission goal..." />
        <button class="btn-primary" type="submit">Create Mission</button>
      </form>
      <div class="cards">
        ${missions
          .map(
            (m) => `
          <div class="card mission-row" data-mission-id="${m.id}">
            <p class="card-label">${m.status.toUpperCase()}</p>
            <p class="card-value">${m.id.slice(0, 8)}</p>
            <p class="card-hint">${m.goal}</p>
          </div>
        `,
          )
          .join("")}
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
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".mission-row"));
  rows.forEach((row) =>
    row.addEventListener("click", () => {
      selectedMissionId = row.dataset.missionId ?? null;
      currentRoute = "audit";
      render();
    }),
  );
}

async function renderAudit() {
  const view = document.getElementById("view");
  if (!view) return;
  if (!selectedMissionId) {
    view.innerHTML = `<p class="card-hint">Select a mission from Missions to inspect logs.</p>`;
    return;
  }
  const res = await authedFetch(`/api/v1/missions/${selectedMissionId}`);
  const payload = await res.json();
  if (!payload.ok) {
    view.innerHTML = `<p class="card-hint">${payload.error ?? "Unable to fetch mission logs."}</p>`;
    return;
  }
  view.innerHTML = `
    <div class="stack">
      <p class="card-label">Mission ${selectedMissionId}</p>
      <p class="card-hint">Status: ${payload.mission.status}</p>
      <pre class="mission-status">${(payload.logs ?? []).join("\n")}</pre>
    </div>
  `;
}

async function renderBilling() {
  const view = document.getElementById("view");
  if (!view) return;
  const res = await authedFetch("/api/v1/billing");
  const payload = await res.json();
  view.innerHTML = `
    <div class="cards">
      <div class="card">
        <p class="card-label">Threshold USD</p>
        <p class="card-value">${Number(payload.thresholdUsd ?? 0).toFixed(2)}</p>
      </div>
      <div class="card">
        <p class="card-label">Current Spend USD</p>
        <p class="card-value">${Number(payload.currentSpendUsd ?? 0).toFixed(2)}</p>
      </div>
    </div>
  `;
}

async function renderMarketplace() {
  const view = document.getElementById("view");
  if (!view) return;
  const res = await authedFetch("/api/v1/marketplace/plugins");
  const payload = await res.json();
  const plugins = (payload.plugins ?? []) as Plugin[];
  const installed = new Set<string>((payload.installed ?? []) as string[]);
  view.innerHTML = `
    <div class="cards">
      ${plugins
        .map((plugin) => {
          const isInstalled = installed.has(plugin.name);
          return `
            <div class="card">
              <p class="card-label">${plugin.provider} · ${plugin.version}</p>
              <p class="card-value">${plugin.name}</p>
              <p class="card-hint">${plugin.description}</p>
              <button class="btn-primary install-btn" data-plugin="${plugin.name}" ${isInstalled ? "disabled" : ""}>
                ${isInstalled ? "Installed" : "Install"}
              </button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".install-btn"));
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      const pluginName = button.dataset.plugin;
      if (!pluginName) return;
      await authedFetch("/api/v1/marketplace/install", {
        method: "POST",
        body: JSON.stringify({ pluginName }),
      });
      await renderMarketplace();
    });
  }
}
