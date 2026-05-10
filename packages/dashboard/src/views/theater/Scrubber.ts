/**
 * Scrubber — replay control for a mission timeline.
 *
 * One range input over event count. Play/pause auto-advances by one event
 * per tick (default 600ms). Live mode follows the latest event.
 *
 * Native HTML range input + setInterval. No deps.
 */

import type { TimelineSnapshot } from "./timeline.js";
import { fmtDuration } from "./timeline.js";

export type ScrubberMode = "live" | "replay";

export interface ScrubberCallbacks {
  onCursor: (idx: number) => void;
  onMode: (mode: ScrubberMode) => void;
}

export class Scrubber {
  private host: HTMLElement;
  private callbacks: ScrubberCallbacks;
  private snapshot: TimelineSnapshot | null = null;
  private cursorIdx = 0;
  private mode: ScrubberMode = "live";
  private rate = 1; // 1× / 2× / 4× / 8×
  private timer: number | null = null;

  constructor(host: HTMLElement, callbacks: ScrubberCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
  }

  setMode(mode: ScrubberMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "live") this.stopPlayback();
    this.callbacks.onMode(mode);
    this.render();
  }

  update(snapshot: TimelineSnapshot, cursorIdx: number): void {
    this.snapshot = snapshot;
    this.cursorIdx = cursorIdx;
    this.render();
  }

  private render(): void {
    if (!this.snapshot) {
      this.host.innerHTML = "";
      return;
    }
    const total = this.snapshot.events.length;
    const max = Math.max(0, total - 1);
    const ts =
      this.cursorIdx >= 0 && this.cursorIdx < total
        ? Date.parse(this.snapshot.events[this.cursorIdx].ts) - this.snapshot.startedAt
        : 0;
    const playing = this.timer !== null;

    this.host.innerHTML = `
      <div class="theater-scrubber-row">
        <button class="theater-scrub-btn ${this.mode === "live" ? "active" : ""}" data-act="live" type="button" title="Follow live">● Live</button>
        <button class="theater-scrub-btn ${this.mode === "replay" ? "active" : ""}" data-act="replay" type="button" title="Replay mode">▶ Replay</button>
        <span class="theater-scrub-spacer"></span>
        <button class="theater-scrub-btn" data-act="first" type="button" title="First event">⏮</button>
        <button class="theater-scrub-btn" data-act="prev" type="button" title="Previous">⏪</button>
        <button class="theater-scrub-btn" data-act="play" type="button" title="${playing ? "Pause" : "Play"}">${playing ? "⏸" : "⏯"}</button>
        <button class="theater-scrub-btn" data-act="next" type="button" title="Next">⏩</button>
        <button class="theater-scrub-btn" data-act="last" type="button" title="Last event">⏭</button>
        <span class="theater-scrub-spacer"></span>
        <span class="theater-scrub-rate">
          <button class="theater-scrub-rate-btn ${this.rate === 1 ? "active" : ""}" data-rate="1" type="button">1×</button>
          <button class="theater-scrub-rate-btn ${this.rate === 2 ? "active" : ""}" data-rate="2" type="button">2×</button>
          <button class="theater-scrub-rate-btn ${this.rate === 4 ? "active" : ""}" data-rate="4" type="button">4×</button>
          <button class="theater-scrub-rate-btn ${this.rate === 8 ? "active" : ""}" data-rate="8" type="button">8×</button>
        </span>
      </div>
      <div class="theater-scrubber-row">
        <span class="theater-scrub-clock">${fmtDuration(ts)}</span>
        <input
          class="theater-scrub-range"
          type="range"
          min="0"
          max="${max}"
          step="1"
          value="${Math.max(0, this.cursorIdx)}"
          aria-label="Mission timeline scrubber"
        />
        <span class="theater-scrub-clock end">${fmtDuration(this.snapshot.durationMs)}</span>
      </div>
    `;

    const range = this.host.querySelector<HTMLInputElement>(".theater-scrub-range");
    range?.addEventListener("input", () => {
      const v = Number(range.value);
      this.setMode("replay");
      this.callbacks.onCursor(v);
    });
    for (const btn of Array.from(
      this.host.querySelectorAll<HTMLButtonElement>("[data-act]"),
    )) {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-act");
        switch (act) {
          case "live":
            this.setMode("live");
            this.callbacks.onCursor(max);
            break;
          case "replay":
            this.setMode("replay");
            break;
          case "first":
            this.setMode("replay");
            this.callbacks.onCursor(0);
            break;
          case "prev":
            this.setMode("replay");
            this.callbacks.onCursor(Math.max(0, this.cursorIdx - 1));
            break;
          case "next":
            this.setMode("replay");
            this.callbacks.onCursor(Math.min(max, this.cursorIdx + 1));
            break;
          case "last":
            this.setMode("replay");
            this.callbacks.onCursor(max);
            break;
          case "play":
            this.togglePlayback(max);
            break;
        }
      });
    }
    for (const btn of Array.from(
      this.host.querySelectorAll<HTMLButtonElement>("[data-rate]"),
    )) {
      btn.addEventListener("click", () => {
        const r = Number(btn.getAttribute("data-rate"));
        if (Number.isFinite(r) && r > 0) {
          this.rate = r;
          if (this.timer !== null) {
            this.stopPlayback();
            this.startPlayback(max);
          }
          this.render();
        }
      });
    }
  }

  private togglePlayback(max: number): void {
    if (this.timer !== null) this.stopPlayback();
    else this.startPlayback(max);
    this.render();
  }

  private startPlayback(max: number): void {
    this.setMode("replay");
    const baseTickMs = 600;
    const tickMs = Math.max(75, Math.round(baseTickMs / this.rate));
    this.timer = window.setInterval(() => {
      const next = this.cursorIdx + 1;
      if (next > max) {
        this.stopPlayback();
        this.render();
        return;
      }
      this.callbacks.onCursor(next);
    }, tickMs);
  }

  private stopPlayback(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.stopPlayback();
  }
}
