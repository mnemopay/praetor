/**
 * ThoughtsFeed — chronological reasoning stream for a mission.
 *
 * Emits a single line per event in plain DOM. Auto-scrolls to keep the
 * cursor in view. Click any row to jump the cursor.
 *
 * Native DOM. No deps.
 */

import type { TimelineSnapshot } from "./timeline.js";

export interface ThoughtsFeedCallbacks {
  onSelect: (idx: number) => void;
}

export class ThoughtsFeed {
  private host: HTMLElement;
  private callbacks: ThoughtsFeedCallbacks;

  constructor(host: HTMLElement, callbacks: ThoughtsFeedCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
  }

  update(snapshot: TimelineSnapshot, cursorIdx: number): void {
    const events = snapshot.events;
    if (events.length === 0) {
      this.host.innerHTML = `<p class="card-hint">No reasoning yet.</p>`;
      return;
    }
    const rows: string[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const isCurrent = i === cursorIdx;
      const isPast = i <= cursorIdx;
      const ts = shortTime(e.ts);
      let label = "";
      let body = "";
      let cls = "thoughts-row";
      switch (e.kind) {
        case "milestone":
          cls += " milestone";
          label = "milestone";
          body = e.text;
          break;
        case "tool":
          cls += " tool";
          label = e.toolName;
          body = e.endedAt
            ? e.ok
              ? "ok"
              : "failed"
            : `running${typeof e.pct === "number" ? ` · ${Math.round(e.pct)}%` : ""}`;
          break;
        case "artifact":
          cls += " artifact";
          label = `artifact · ${e.format}`;
          body = e.url ? "done" : "streaming";
          break;
        case "chat":
          cls += ` chat ${e.role}`;
          label = e.role;
          body = e.text;
          break;
      }
      cls += isCurrent ? " current" : isPast ? " past" : " future";
      rows.push(
        `<button class="${cls}" data-idx="${i}" type="button">` +
          `<span class="thoughts-time">${escapeHtml(ts)}</span>` +
          `<span class="thoughts-label">${escapeHtml(label)}</span>` +
          `<span class="thoughts-body">${escapeHtml(truncate(body, 200))}</span>` +
          `</button>`,
      );
    }
    this.host.innerHTML = rows.join("");
    for (const btn of Array.from(this.host.querySelectorAll<HTMLButtonElement>("[data-idx]"))) {
      const idx = Number(btn.getAttribute("data-idx"));
      btn.addEventListener("click", () => this.callbacks.onSelect(idx));
    }
    // Auto-scroll cursor into view.
    const current = this.host.querySelector<HTMLElement>(".thoughts-row.current");
    if (current) {
      current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      this.host.scrollTop = this.host.scrollHeight;
    }
  }
}

function shortTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false });
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
