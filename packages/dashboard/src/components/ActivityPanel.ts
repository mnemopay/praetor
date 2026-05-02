/**
 * ActivityPanel — renders the live event timeline. One row per event.
 * Tool events show pending state until the matching tool.end arrives.
 *
 * The panel keeps its own internal state and renders into a host element.
 */

export type ActivityEvent =
  | { kind: "milestone"; missionId: string; text: string; ts: string }
  | { kind: "tool.start"; missionId: string; eventId: string; toolName: string; args: unknown; ts: string }
  | { kind: "tool.progress"; missionId: string; eventId: string; pct?: number; status: string; ts: string }
  | { kind: "tool.end"; missionId: string; eventId: string; ok: boolean; result?: unknown; costUsd?: number; ts: string }
  | { kind: "artifact.partial"; missionId: string; artifactId: string; format: "text" | "glb" | "splat" | "image"; chunk: string; ts: string }
  | { kind: "artifact.done"; missionId: string; artifactId: string; format?: "text" | "glb" | "splat" | "image"; url: string; ts: string };

interface ToolRow {
  eventId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  ok?: boolean;
  result?: unknown;
  costUsd?: number;
  pct?: number;
  status?: string;
}

interface ArtifactRow {
  artifactId: string;
  format: "text" | "glb" | "splat" | "image";
  url?: string;
  partials: string[];
  doneAt?: string;
}

export class ActivityPanel {
  private host: HTMLElement;
  private milestones: { ts: string; text: string }[] = [];
  private tools = new Map<string, ToolRow>();
  private toolOrder: string[] = [];
  private artifacts = new Map<string, ArtifactRow>();
  private artifactOrder: string[] = [];

  constructor(host: HTMLElement) {
    this.host = host;
    this.render();
  }

  /** Wipe all rows. Call when switching to a new mission. */
  reset(): void {
    this.milestones = [];
    this.tools.clear();
    this.toolOrder = [];
    this.artifacts.clear();
    this.artifactOrder = [];
    this.render();
  }

  /** Bulk-merge backlog events on initial load. */
  hydrate(events: ActivityEvent[]): void {
    for (const e of events) this.ingestSilently(e);
    this.render();
  }

  /** Single live event from the SSE stream. */
  push(e: ActivityEvent): void {
    this.ingestSilently(e);
    this.render();
  }

  private ingestSilently(e: ActivityEvent): void {
    switch (e.kind) {
      case "milestone":
        this.milestones.push({ ts: e.ts, text: e.text });
        break;
      case "tool.start":
        if (!this.tools.has(e.eventId)) this.toolOrder.push(e.eventId);
        this.tools.set(e.eventId, {
          eventId: e.eventId,
          toolName: e.toolName,
          startedAt: e.ts,
        });
        break;
      case "tool.progress": {
        const t = this.tools.get(e.eventId);
        if (t) {
          t.pct = e.pct;
          t.status = e.status;
        }
        break;
      }
      case "tool.end": {
        const t = this.tools.get(e.eventId);
        if (t) {
          t.endedAt = e.ts;
          t.ok = e.ok;
          t.result = e.result;
          t.costUsd = e.costUsd;
        }
        break;
      }
      case "artifact.partial": {
        if (!this.artifacts.has(e.artifactId)) {
          this.artifactOrder.push(e.artifactId);
          this.artifacts.set(e.artifactId, { artifactId: e.artifactId, format: e.format, partials: [] });
        }
        this.artifacts.get(e.artifactId)!.partials.push(e.chunk);
        break;
      }
      case "artifact.done": {
        if (!this.artifacts.has(e.artifactId)) {
          this.artifactOrder.push(e.artifactId);
          this.artifacts.set(e.artifactId, { artifactId: e.artifactId, format: e.format ?? "text", partials: [] });
        }
        const a = this.artifacts.get(e.artifactId)!;
        if (e.format) a.format = e.format;
        a.url = e.url;
        a.doneAt = e.ts;
        break;
      }
    }
  }

  private render(): void {
    if (!this.host) return;
    const rows: string[] = [];
    for (const ev of this.milestones) {
      rows.push(`<div class="activity-row activity-milestone">
        <span class="activity-time">${shortTime(ev.ts)}</span>
        <span class="activity-text">${escapeHtml(ev.text)}</span>
      </div>`);
    }
    for (const id of this.toolOrder) {
      const t = this.tools.get(id);
      if (!t) continue;
      const pill = t.endedAt
        ? (t.ok ? `<span class="status-pill ok">done</span>` : `<span class="status-pill err">failed</span>`)
        : `<span class="status-pill warn">running…</span>`;
      const cost = typeof t.costUsd === "number" ? ` · $${t.costUsd.toFixed(3)}` : "";
      const status = t.status ? ` · ${escapeHtml(t.status)}` : "";
      const pct = typeof t.pct === "number" ? ` · ${Math.round(t.pct)}%` : "";
      rows.push(`<div class="activity-row activity-tool">
        <div class="activity-row-head">
          <span class="activity-time">${shortTime(t.startedAt)}</span>
          <span class="activity-tool-name">${escapeHtml(t.toolName)}</span>
          ${pill}
        </div>
        <div class="activity-row-body">${escapeHtml(`${status}${pct}${cost}`)}</div>
      </div>`);
    }
    for (const id of this.artifactOrder) {
      const a = this.artifacts.get(id);
      if (!a) continue;
      let preview = "";
      const url = artifactUrl(a.url);
      if (url && (a.format === "glb")) {
        preview = `<a class="btn-secondary" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open GLB</a>`;
      } else if (url && a.format === "splat") {
        preview = `<a class="btn-secondary" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open splat</a>`;
      } else if (url && a.format === "image") {
        preview = `<img class="activity-artifact-img" src="${escapeAttr(url)}" alt="${escapeAttr(a.artifactId)}" />`;
      } else if (url && a.format === "text") {
        preview = `<a class="btn-secondary" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open artifact</a>`;
      } else if (a.partials.length > 0 || a.url) {
        const text = a.partials.join("");
        preview = `<pre class="activity-artifact-text">${escapeHtml(text)}</pre>`;
      }
      rows.push(`<div class="activity-row activity-artifact">
        <div class="activity-row-head">
          <span class="activity-time">${shortTime(a.doneAt ?? "")}</span>
          <span class="activity-tool-name">artifact · ${escapeHtml(a.format)}</span>
          ${a.url ? `<span class="status-pill ok">done</span>` : `<span class="status-pill warn">streaming…</span>`}
        </div>
        <div class="activity-row-body">${preview}</div>
      </div>`);
    }

    if (rows.length === 0) {
      this.host.innerHTML = `<p class="card-hint">No activity yet. Start a mission and tool calls will appear here.</p>`;
      return;
    }
    this.host.innerHTML = rows.join("");
    this.host.scrollTop = this.host.scrollHeight;
  }
}

function shortTime(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function artifactUrl(url?: string): string {
  if (!url) return "";
  if (!url.startsWith("/api/v1/artifacts")) return url;
  try {
    const token = window.localStorage.getItem("praetor.artifactToken");
    if (!token) return url;
    const next = new URL(url, window.location.origin);
    next.searchParams.set("token", token);
    return `${next.pathname}${next.search}`;
  } catch {
    return url;
  }
}
