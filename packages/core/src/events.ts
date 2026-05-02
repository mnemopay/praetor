/**
 * Activity events — the live timeline the dashboard renders alongside the
 * mission chat. Emitted by tools as they run; persisted by the API for
 * reconnect.
 */

export type ArtifactFormat = "text" | "glb" | "splat" | "image";

export type ActivityEvent =
  | { kind: "milestone"; missionId: string; text: string; ts: string }
  | { kind: "tool.start"; missionId: string; eventId: string; toolName: string; args: unknown; ts: string }
  | { kind: "tool.progress"; missionId: string; eventId: string; pct?: number; status: string; ts: string }
  | { kind: "tool.end"; missionId: string; eventId: string; ok: boolean; result?: unknown; costUsd?: number; ts: string }
  | { kind: "artifact.partial"; missionId: string; artifactId: string; format: ArtifactFormat; chunk: string; ts: string }
  | { kind: "artifact.done"; missionId: string; artifactId: string; format?: ArtifactFormat; url: string; ts: string };

export interface ActivityBus {
  publish(e: ActivityEvent): void;
  subscribe(fn: (e: ActivityEvent) => void): () => void;
}

/**
 * In-process pub/sub. Subscribers are called synchronously in publish
 * order; a thrown listener does not break the bus or other listeners.
 */
export class InMemoryActivityBus implements ActivityBus {
  private listeners: Array<(e: ActivityEvent) => void> = [];

  publish(e: ActivityEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* listener errors do not poison the bus */ }
    }
  }

  subscribe(fn: (e: ActivityEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}

/** Helper for tools to mint a stable event id when emitting tool.start/progress/end. */
export function newActivityEventId(): string {
  // crypto.randomUUID is fine for an in-memory id; we don't need a UUID
  // here, just a per-process unique key.
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
