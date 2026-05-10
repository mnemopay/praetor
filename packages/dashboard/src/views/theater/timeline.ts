/**
 * Live Mission Theater — timeline state.
 *
 * Normalizes Praetor activity events (from /api/v1/missions/:id/article12 OR
 * the SSE stream) into a single chronological list with derived parent/child
 * relationships. The theater views (ExecutionGraph, ToolCanvas, ThoughtsFeed,
 * Scrubber) all read from this shared timeline.
 *
 * Native-only: no third-party deps. Pure data + a couple of pub/sub callbacks.
 */

export type TheaterEvent =
  | { id: string; ts: string; tIdx: number; kind: "milestone"; text: string }
  | {
      id: string;
      ts: string;
      tIdx: number;
      kind: "tool";
      eventId: string;
      toolName: string;
      args: unknown;
      // Filled in by paired tool.end:
      endedAt?: string;
      ok?: boolean;
      result?: unknown;
      costUsd?: number;
      // Filled in by tool.progress events:
      pct?: number;
      status?: string;
    }
  | {
      id: string;
      ts: string;
      tIdx: number;
      kind: "artifact";
      artifactId: string;
      format: "text" | "glb" | "splat" | "image";
      partials: string[];
      url?: string;
    }
  | {
      id: string;
      ts: string;
      tIdx: number;
      kind: "chat";
      messageId: string;
      role: "user" | "assistant";
      text: string;
    };

export interface RawEvent {
  kind: string;
  ts: string;
  [k: string]: unknown;
}

export interface Mission {
  id: string;
  goal: string;
  status: string;
  budget?: number;
  spent_usd?: number;
  created_at: string;
  updated_at?: string;
}

export interface TimelineSnapshot {
  mission: Mission | null;
  events: TheaterEvent[];
  startedAt: number; // ms epoch
  endedAt: number; // ms epoch (live = now, replay = last event)
  durationMs: number;
}

/**
 * Build a normalized event timeline from a stream of raw activity events.
 * Pairs tool.start/tool.end into a single tool entry. Aggregates artifact
 * partials. Sorts by ts ascending.
 */
export function buildTimeline(rawEvents: RawEvent[], mission: Mission | null): TimelineSnapshot {
  const tools = new Map<string, TheaterEvent>(); // by tool eventId
  const artifacts = new Map<string, TheaterEvent>(); // by artifactId
  const chats = new Map<string, TheaterEvent>(); // by messageId
  const events: TheaterEvent[] = [];

  let tIdx = 0;
  for (const r of rawEvents) {
    const ts = String(r.ts ?? new Date().toISOString());
    switch (r.kind) {
      case "milestone": {
        const e: TheaterEvent = {
          id: `m-${tIdx}-${ts}`,
          ts,
          tIdx,
          kind: "milestone",
          text: String(r.text ?? ""),
        };
        events.push(e);
        tIdx++;
        break;
      }
      case "tool.start": {
        const eventId = String(r.eventId ?? "");
        if (!eventId) break;
        if (tools.has(eventId)) break; // duplicate; ignore
        const e: TheaterEvent = {
          id: `t-${eventId}`,
          ts,
          tIdx,
          kind: "tool",
          eventId,
          toolName: String(r.toolName ?? "tool"),
          args: r.args,
        };
        tools.set(eventId, e);
        events.push(e);
        tIdx++;
        break;
      }
      case "tool.progress": {
        const eventId = String(r.eventId ?? "");
        const e = tools.get(eventId);
        if (!e || e.kind !== "tool") break;
        if (typeof r.pct === "number") e.pct = r.pct;
        if (typeof r.status === "string") e.status = r.status;
        break;
      }
      case "tool.end": {
        const eventId = String(r.eventId ?? "");
        const e = tools.get(eventId);
        if (!e || e.kind !== "tool") break;
        e.endedAt = ts;
        e.ok = r.ok === true;
        e.result = r.result;
        if (typeof r.costUsd === "number") e.costUsd = r.costUsd;
        break;
      }
      case "artifact.partial": {
        const artifactId = String(r.artifactId ?? "");
        if (!artifactId) break;
        let e = artifacts.get(artifactId);
        if (!e) {
          e = {
            id: `a-${artifactId}`,
            ts,
            tIdx,
            kind: "artifact",
            artifactId,
            format: (r.format as TheaterEvent extends { kind: "artifact" }
              ? TheaterEvent["format"]
              : never) ?? "text",
            partials: [],
          } as TheaterEvent;
          artifacts.set(artifactId, e);
          events.push(e);
          tIdx++;
        }
        if (e.kind === "artifact") {
          e.partials.push(String(r.chunk ?? ""));
        }
        break;
      }
      case "artifact.done": {
        const artifactId = String(r.artifactId ?? "");
        if (!artifactId) break;
        let e = artifacts.get(artifactId);
        if (!e) {
          e = {
            id: `a-${artifactId}`,
            ts,
            tIdx,
            kind: "artifact",
            artifactId,
            format: ((r.format as string) || "text") as
              | "text"
              | "glb"
              | "splat"
              | "image",
            partials: [],
          };
          artifacts.set(artifactId, e);
          events.push(e);
          tIdx++;
        }
        if (e.kind === "artifact") {
          if (typeof r.format === "string")
            e.format = r.format as "text" | "glb" | "splat" | "image";
          if (typeof r.url === "string") e.url = r.url;
        }
        break;
      }
      case "chat.user":
      case "chat.assistant": {
        const messageId = String(r.messageId ?? "");
        if (!messageId) break;
        const role = r.kind === "chat.user" ? "user" : "assistant";
        let e = chats.get(messageId);
        if (!e) {
          e = {
            id: `c-${messageId}`,
            ts,
            tIdx,
            kind: "chat",
            messageId,
            role,
            text: String(r.text ?? ""),
          };
          chats.set(messageId, e);
          events.push(e);
          tIdx++;
        } else if (e.kind === "chat") {
          // Allow assistant streaming to update text in place.
          e.text = String(r.text ?? e.text);
        }
        break;
      }
      default:
        break;
    }
  }

  // Stable sort by ts then tIdx (insertion order tiebreak).
  events.sort((a, b) => {
    const at = Date.parse(a.ts);
    const bt = Date.parse(b.ts);
    if (at !== bt) return at - bt;
    return a.tIdx - b.tIdx;
  });

  // Re-stamp tIdx in sorted order.
  events.forEach((e, i) => {
    e.tIdx = i;
  });

  const startedAt = events.length > 0 ? Date.parse(events[0].ts) : Date.now();
  const lastTs =
    events.length > 0 ? Date.parse(events[events.length - 1].ts) : startedAt;
  const endedAt = mission?.status === "running" || mission?.status === "queued"
    ? Math.max(lastTs, Date.now())
    : lastTs;
  const durationMs = Math.max(0, endedAt - startedAt);

  return { mission, events, startedAt, endedAt, durationMs };
}

/** Return the index of the last event whose ts <= cursorMs (offset from start). */
export function eventIndexAt(
  snap: TimelineSnapshot,
  cursorMs: number,
): number {
  if (snap.events.length === 0) return -1;
  const target = snap.startedAt + cursorMs;
  // Linear scan is fine — missions rarely exceed thousands of events.
  let lastIdx = -1;
  for (let i = 0; i < snap.events.length; i++) {
    const t = Date.parse(snap.events[i].ts);
    if (t <= target) lastIdx = i;
    else break;
  }
  return lastIdx;
}

/** Format a duration in ms as mm:ss (or h:mm:ss if >= 1h). */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
