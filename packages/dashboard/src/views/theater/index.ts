/**
 * Live Mission Theater — top-level orchestrator.
 *
 * Renders three panes (ExecutionGraph + ToolCanvas + ThoughtsFeed) plus a
 * scrubber that scrubs all three synchronously. Two modes:
 *   - live: follow latest event via SSE (the existing /missions/:id/events stream)
 *   - replay: load full bundle from /api/v1/missions/:id/article12 and scrub freely
 *
 * Native DOM only. No 3rd-party deps.
 *
 * The "trajectory wow feature" — see project_session_2026_05_06_praetor_audit.md
 * resume points (5/6/2026) and feedback_pre_ship_review.md (validate value first).
 */

import { ExecutionGraph } from "./ExecutionGraph.js";
import { ToolCanvas } from "./ToolCanvas.js";
import { ThoughtsFeed } from "./ThoughtsFeed.js";
import { Scrubber } from "./Scrubber.js";
import {
  buildTimeline,
  eventIndexAt,
  type Mission,
  type RawEvent,
  type TimelineSnapshot,
} from "./timeline.js";
import { openActivityStream, type ActivityStreamHandle } from "../../eventStream.js";

export interface TheaterDeps {
  apiBase: string;
  token: string;
  missionId: string;
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export class Theater {
  private host: HTMLElement;
  private deps: TheaterDeps;
  private snapshot: TimelineSnapshot = {
    mission: null,
    events: [],
    startedAt: Date.now(),
    endedAt: Date.now(),
    durationMs: 0,
  };
  private rawEvents: RawEvent[] = [];
  private cursorIdx = -1;
  private mode: "live" | "replay" = "live";
  private graph: ExecutionGraph | null = null;
  private canvas: ToolCanvas | null = null;
  private feed: ThoughtsFeed | null = null;
  private scrubber: Scrubber | null = null;
  private stream: ActivityStreamHandle | null = null;
  private destroyed = false;

  constructor(host: HTMLElement, deps: TheaterDeps) {
    this.host = host;
    this.deps = deps;
  }

  async start(): Promise<void> {
    this.host.innerHTML = `
      <div class="theater-shell">
        <header class="theater-head" id="theaterHead">
          <p class="card-hint">Loading mission…</p>
        </header>
        <div class="theater-grid">
          <section class="theater-pane theater-graph">
            <header><span class="card-label">Execution graph</span></header>
            <div class="theater-pane-body" id="theaterGraph"></div>
          </section>
          <section class="theater-pane theater-canvas">
            <header><span class="card-label">Tool canvas</span></header>
            <div class="theater-pane-body" id="theaterCanvas"></div>
          </section>
          <section class="theater-pane theater-feed">
            <header><span class="card-label">Thoughts feed</span></header>
            <div class="theater-pane-body" id="theaterFeed"></div>
          </section>
        </div>
        <footer class="theater-scrubber" id="theaterScrubber"></footer>
      </div>
    `;
    const graphHost = this.host.querySelector<HTMLElement>("#theaterGraph");
    const canvasHost = this.host.querySelector<HTMLElement>("#theaterCanvas");
    const feedHost = this.host.querySelector<HTMLElement>("#theaterFeed");
    const scrubberHost = this.host.querySelector<HTMLElement>("#theaterScrubber");
    if (!graphHost || !canvasHost || !feedHost || !scrubberHost) return;

    this.graph = new ExecutionGraph(graphHost, {
      onSelect: (idx) => this.jumpTo(idx),
    });
    this.canvas = new ToolCanvas(canvasHost, this.deps.apiBase, this.deps.token);
    this.feed = new ThoughtsFeed(feedHost, {
      onSelect: (idx) => this.jumpTo(idx),
    });
    this.scrubber = new Scrubber(scrubberHost, {
      onCursor: (idx) => this.jumpTo(idx),
      onMode: (m) => {
        this.mode = m;
      },
    });

    // Hydrate from Article 12 bundle (full timeline + mission), then open SSE
    // for live tail. The bundle endpoint already aggregates the events from
    // the structured log lines (kind=praetor-activity).
    await this.hydrate();
    this.openLiveTail();
  }

  destroy(): void {
    this.destroyed = true;
    this.scrubber?.destroy();
    this.stream?.close();
    this.stream = null;
  }

  private async hydrate(): Promise<void> {
    try {
      const res = await this.deps.authedFetch(
        `/api/v1/missions/${encodeURIComponent(this.deps.missionId)}/article12`,
      );
      if (!res.ok) {
        const head = this.host.querySelector<HTMLElement>("#theaterHead");
        if (head)
          head.innerHTML = `<p class="card-hint error">Unable to load mission (${res.status}).</p>`;
        return;
      }
      const bundle = (await res.json()) as {
        mission: Mission;
        events: RawEvent[];
      };
      this.rawEvents = Array.isArray(bundle.events) ? bundle.events : [];
      this.snapshot = buildTimeline(this.rawEvents, bundle.mission ?? null);
      // Default cursor to last event (live tail position).
      this.cursorIdx = Math.max(-1, this.snapshot.events.length - 1);
      this.renderHeader();
      this.pushAll();
    } catch (err) {
      const head = this.host.querySelector<HTMLElement>("#theaterHead");
      if (head)
        head.innerHTML = `<p class="card-hint error">Network error: ${escapeHtml(
          (err as Error).message,
        )}</p>`;
    }
  }

  private openLiveTail(): void {
    this.stream = openActivityStream({
      apiBase: this.deps.apiBase,
      token: this.deps.token,
      missionId: this.deps.missionId,
      onEvent: (e) => {
        if (this.destroyed) return;
        this.rawEvents.push(e as RawEvent);
        this.snapshot = buildTimeline(this.rawEvents, this.snapshot.mission);
        if (this.mode === "live") {
          this.cursorIdx = this.snapshot.events.length - 1;
        }
        this.renderHeader();
        this.pushAll();
      },
    });
  }

  private jumpTo(idx: number): void {
    const total = this.snapshot.events.length;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, idx));
    this.cursorIdx = clamped;
    // If user scrubbed off the tail, drop into replay mode.
    if (clamped < total - 1 && this.mode === "live") {
      this.mode = "replay";
    }
    this.pushAll();
  }

  private pushAll(): void {
    this.graph?.update(this.snapshot, this.cursorIdx);
    this.canvas?.update(this.snapshot, this.cursorIdx);
    this.feed?.update(this.snapshot, this.cursorIdx);
    this.scrubber?.update(this.snapshot, this.cursorIdx);
  }

  private renderHeader(): void {
    const head = this.host.querySelector<HTMLElement>("#theaterHead");
    if (!head) return;
    const m = this.snapshot.mission;
    if (!m) {
      head.innerHTML = `<p class="card-hint">No mission.</p>`;
      return;
    }
    const status = m.status ?? "unknown";
    const goal = m.goal ?? "";
    head.innerHTML = `
      <div class="theater-head-row">
        <div>
          <p class="card-label">Mission · ${escapeHtml(status)}</p>
          <p class="card-value">${escapeHtml(goal)}</p>
          <p class="card-hint">${escapeHtml(m.id)}</p>
        </div>
        <div class="theater-head-actions">
          <a class="btn-secondary" href="${this.deps.apiBase}/api/v1/missions/${encodeURIComponent(m.id)}/article12?token=${encodeURIComponent(this.deps.token)}" download="article12-${m.id}.json">Download Article 12</a>
        </div>
      </div>
    `;
  }
}

/** Public entry — main.ts calls this when the theater route is selected. */
export async function renderTheater(
  view: HTMLElement,
  deps: TheaterDeps,
): Promise<Theater> {
  const t = new Theater(view, deps);
  await t.start();
  return t;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}
