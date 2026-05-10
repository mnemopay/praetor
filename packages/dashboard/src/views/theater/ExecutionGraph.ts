/**
 * ExecutionGraph — vertical timeline of mission events as an SVG tree.
 *
 * Layout: Y is time (top = mission start, bottom = now/end). X is a swim-lane
 * by tool family (browser/scrape/voice/vision/native/etc). Each tool event is
 * a rounded rect; running = warn, ok = green, fail = red, future (past cursor)
 * = grey. Milestones are full-width tick marks. Chat events are right-rail dots.
 *
 * Native SVG. No layout libs. No deps.
 */

import type { TheaterEvent, TimelineSnapshot } from "./timeline.js";

export interface ExecutionGraphCallbacks {
  onSelect: (idx: number) => void;
}

const LANE_WIDTH = 180;
const LANE_GAP = 8;
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 24;
const PADDING = 12;

function laneFor(toolName: string): string {
  const t = toolName.toLowerCase();
  if (t.startsWith("browser") || t.includes("playwright") || t.includes("scrape"))
    return "browse";
  if (t.includes("voice") || t.includes("tts") || t.includes("elevenlabs"))
    return "voice";
  if (t.includes("vision") || t.includes("image") || t.includes("vqa"))
    return "vision";
  if (t.includes("3d") || t.includes("model") || t.includes("splat") || t.includes("world"))
    return "world";
  if (t.includes("write_file") || t.includes("read_file") || t.includes("sandbox"))
    return "code";
  if (t.includes("send_email") || t.includes("resend") || t.includes("maileroo"))
    return "comms";
  return "native";
}

const LANE_ORDER = ["native", "code", "browse", "vision", "world", "voice", "comms"];

export class ExecutionGraph {
  private host: HTMLElement;
  private callbacks: ExecutionGraphCallbacks;
  private snapshot: TimelineSnapshot | null = null;
  private cursorIdx = -1;

  constructor(host: HTMLElement, callbacks: ExecutionGraphCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
  }

  update(snapshot: TimelineSnapshot, cursorIdx: number): void {
    this.snapshot = snapshot;
    this.cursorIdx = cursorIdx;
    this.render();
  }

  private render(): void {
    if (!this.snapshot) {
      this.host.innerHTML = `<p class="card-hint">No mission selected.</p>`;
      return;
    }
    const { events, durationMs, startedAt } = this.snapshot;
    if (events.length === 0) {
      this.host.innerHTML = `<p class="card-hint">No events yet — mission may be queued.</p>`;
      return;
    }

    // Determine which lanes are populated.
    const usedLanes = new Set<string>(["native"]);
    for (const e of events) {
      if (e.kind === "tool") usedLanes.add(laneFor(e.toolName));
    }
    const lanes = LANE_ORDER.filter((l) => usedLanes.has(l));
    const width = lanes.length * (LANE_WIDTH + LANE_GAP) + PADDING * 2;
    const innerHeight = Math.max(events.length * ROW_HEIGHT + 32, 200);
    const height = HEADER_HEIGHT + innerHeight + PADDING * 2;

    const yFor = (e: TheaterEvent): number => {
      if (durationMs <= 0) return HEADER_HEIGHT + e.tIdx * ROW_HEIGHT + PADDING;
      const t = Date.parse(e.ts) - startedAt;
      const ratio = Math.max(0, Math.min(1, t / durationMs));
      return HEADER_HEIGHT + PADDING + ratio * (innerHeight - 16);
    };
    const xFor = (lane: string): number => {
      const i = Math.max(0, lanes.indexOf(lane));
      return PADDING + i * (LANE_WIDTH + LANE_GAP);
    };

    const parts: string[] = [];
    parts.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="exec-graph-svg" preserveAspectRatio="none">`);

    // Lane headers
    for (const l of lanes) {
      parts.push(
        `<text x="${xFor(l) + LANE_WIDTH / 2}" y="${HEADER_HEIGHT - 6}" class="exec-graph-lane-label" text-anchor="middle">${escapeText(l)}</text>`,
      );
      parts.push(
        `<line x1="${xFor(l)}" x2="${xFor(l) + LANE_WIDTH}" y1="${HEADER_HEIGHT}" y2="${HEADER_HEIGHT}" class="exec-graph-lane-rule" />`,
      );
    }

    // Events
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const y = yFor(e);
      const isPast = i <= this.cursorIdx;
      const isCurrent = i === this.cursorIdx;

      if (e.kind === "tool") {
        const lane = laneFor(e.toolName);
        const x = xFor(lane);
        const stateClass = !isPast
          ? "future"
          : e.endedAt
            ? e.ok
              ? "ok"
              : "err"
            : "running";
        const sel = isCurrent ? " current" : "";
        const cost =
          typeof e.costUsd === "number" ? ` · $${e.costUsd.toFixed(3)}` : "";
        parts.push(
          `<g class="exec-graph-tool ${stateClass}${sel}" data-idx="${i}" tabindex="0" role="button" aria-label="${escapeAttr(e.toolName)}">` +
            `<rect x="${x}" y="${y - ROW_HEIGHT / 2 + 4}" width="${LANE_WIDTH}" height="${ROW_HEIGHT - 8}" rx="6" />` +
            `<text x="${x + 8}" y="${y + 4}" class="exec-graph-tool-label">${escapeText(e.toolName)}${escapeText(cost)}</text>` +
            `</g>`,
        );
      } else if (e.kind === "milestone") {
        const sel = isCurrent ? " current" : "";
        parts.push(
          `<g class="exec-graph-milestone${isPast ? " past" : ""}${sel}" data-idx="${i}" tabindex="0" role="button" aria-label="milestone: ${escapeAttr(e.text)}">` +
            `<line x1="${PADDING}" x2="${width - PADDING}" y1="${y}" y2="${y}" />` +
            `<circle cx="${PADDING + 4}" cy="${y}" r="3" />` +
            `<text x="${PADDING + 14}" y="${y - 4}" class="exec-graph-milestone-label">${escapeText(truncate(e.text, 80))}</text>` +
            `</g>`,
        );
      } else if (e.kind === "artifact") {
        const x = xFor("native") + LANE_WIDTH - 16;
        const sel = isCurrent ? " current" : "";
        parts.push(
          `<g class="exec-graph-artifact${isPast ? " past" : ""}${sel}" data-idx="${i}" tabindex="0" role="button" aria-label="artifact: ${escapeAttr(e.format)}">` +
            `<polygon points="${x},${y - 5} ${x + 10},${y} ${x},${y + 5}" />` +
            `</g>`,
        );
      } else if (e.kind === "chat") {
        const x = width - PADDING - 6;
        const sel = isCurrent ? " current" : "";
        const role = e.role;
        parts.push(
          `<g class="exec-graph-chat ${role}${isPast ? " past" : ""}${sel}" data-idx="${i}" tabindex="0" role="button" aria-label="chat ${role}">` +
            `<circle cx="${x}" cy="${y}" r="4" />` +
            `</g>`,
        );
      }
    }

    // Cursor line
    if (this.cursorIdx >= 0 && this.cursorIdx < events.length) {
      const cursorY = yFor(events[this.cursorIdx]);
      parts.push(
        `<line x1="0" x2="${width}" y1="${cursorY}" y2="${cursorY}" class="exec-graph-cursor" />`,
      );
    }

    parts.push("</svg>");
    this.host.innerHTML = parts.join("");

    // Wire click handlers.
    for (const el of Array.from(
      this.host.querySelectorAll<SVGGElement>("[data-idx]"),
    )) {
      const idx = Number(el.getAttribute("data-idx"));
      if (!Number.isFinite(idx)) continue;
      el.addEventListener("click", () => this.callbacks.onSelect(idx));
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          this.callbacks.onSelect(idx);
        }
      });
    }
  }
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
