/**
 * ToolCanvas — renders the OUTPUT of the currently-selected event.
 *
 * For artifact events: image, GLB (model-viewer iframe), splat (Spark embed),
 * or text preview. For tool events: structured args + result preview, plus
 * pct/status if running. For milestones: a big card with the milestone text.
 *
 * Native HTML/CSS only. No engine deps.
 */

import type { TheaterEvent, TimelineSnapshot } from "./timeline.js";

export class ToolCanvas {
  private host: HTMLElement;
  private apiBase: string;
  private token: string;

  constructor(host: HTMLElement, apiBase: string, token: string) {
    this.host = host;
    this.apiBase = apiBase;
    this.token = token;
  }

  update(snapshot: TimelineSnapshot, cursorIdx: number): void {
    if (cursorIdx < 0 || cursorIdx >= snapshot.events.length) {
      this.host.innerHTML = `<div class="theater-canvas-empty">
        <p class="card-hint">Scrub the timeline to inspect any moment.</p>
      </div>`;
      return;
    }
    const e = snapshot.events[cursorIdx];
    this.host.innerHTML = this.renderEvent(e);
  }

  private renderEvent(e: TheaterEvent): string {
    if (e.kind === "milestone") {
      return `<div class="theater-canvas-milestone">
        <p class="card-label">milestone</p>
        <p class="theater-canvas-milestone-text">${escapeHtml(e.text)}</p>
        <p class="card-hint">${escapeHtml(e.ts)}</p>
      </div>`;
    }
    if (e.kind === "tool") {
      const state = !e.endedAt
        ? `<span class="status-pill warn">running${typeof e.pct === "number" ? ` · ${Math.round(e.pct)}%` : ""}</span>`
        : e.ok
          ? `<span class="status-pill ok">ok</span>`
          : `<span class="status-pill err">failed</span>`;
      const cost =
        typeof e.costUsd === "number"
          ? `<span class="theater-canvas-cost">$${e.costUsd.toFixed(3)}</span>`
          : "";
      return `<div class="theater-canvas-tool">
        <header>
          <h3>${escapeHtml(e.toolName)}</h3>
          ${state}
          ${cost}
        </header>
        <section>
          <p class="card-label">args</p>
          <pre class="theater-canvas-pre">${escapeHtml(prettyJson(e.args))}</pre>
        </section>
        ${
          e.result !== undefined
            ? `<section>
            <p class="card-label">result</p>
            <pre class="theater-canvas-pre">${escapeHtml(prettyJson(e.result))}</pre>
          </section>`
            : ""
        }
        ${
          e.status
            ? `<p class="card-hint">status: ${escapeHtml(e.status)}</p>`
            : ""
        }
      </div>`;
    }
    if (e.kind === "chat") {
      return `<div class="theater-canvas-chat ${e.role}">
        <p class="card-label">${e.role}</p>
        <p class="theater-canvas-chat-text">${escapeHtml(e.text)}</p>
        <p class="card-hint">${escapeHtml(e.ts)}</p>
      </div>`;
    }
    if (e.kind === "artifact") {
      const url = this.resolveArtifactUrl(e.url);
      const fmt = e.format;
      const partials = e.partials.join("");

      if (url && fmt === "image") {
        return `<div class="theater-canvas-artifact">
          <p class="card-label">artifact · image</p>
          <img class="theater-canvas-img" src="${escapeAttr(url)}" alt="artifact" />
          <p class="card-hint">${escapeHtml(e.artifactId)}</p>
        </div>`;
      }
      if (url && fmt === "glb") {
        return `<div class="theater-canvas-artifact">
          <p class="card-label">artifact · GLB mesh</p>
          <model-viewer
            src="${escapeAttr(url)}"
            camera-controls
            auto-rotate
            class="theater-canvas-model"
            ar
            shadow-intensity="1"
            exposure="0.9"
          ></model-viewer>
          <p><a class="btn-secondary" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open GLB</a></p>
        </div>`;
      }
      if (url && fmt === "splat") {
        return `<div class="theater-canvas-artifact">
          <p class="card-label">artifact · gaussian splat</p>
          <iframe
            class="theater-canvas-splat"
            src="https://playcanvas.com/supersplat/viewer?load=${encodeURIComponent(url)}"
            allow="xr-spatial-tracking; fullscreen"
          ></iframe>
          <p><a class="btn-secondary" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open splat</a></p>
        </div>`;
      }
      // text artifact (live or done)
      return `<div class="theater-canvas-artifact">
        <p class="card-label">artifact · text${url ? "" : " (streaming…)"}</p>
        <pre class="theater-canvas-pre">${escapeHtml(partials || "(no content yet)")}</pre>
        ${url ? `<p><a class="btn-secondary" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open</a></p>` : ""}
      </div>`;
    }
    return `<p class="card-hint">unknown event</p>`;
  }

  /**
   * Server-relative artifact URLs need the auth token re-attached because
   * artifacts are fetched outside the bearer-header path.
   */
  private resolveArtifactUrl(url: string | undefined): string | null {
    if (!url) return null;
    if (!url.startsWith("/api/v1/artifacts")) return url;
    try {
      const next = new URL(this.apiBase + url, window.location.origin);
      next.searchParams.set("token", this.token);
      return next.toString();
    } catch {
      return url;
    }
  }
}

function prettyJson(v: unknown): string {
  if (v === undefined) return "(undefined)";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
