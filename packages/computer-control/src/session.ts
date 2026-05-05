/**
 * PraetorComputerSession — owns the session lifecycle for "let an agent
 * drive the host computer" scenarios. Handles screen capture, optional
 * input control via an adapter, audit, and live-streaming of frames so
 * an operator can see what the agent is doing.
 *
 * Shape:
 *   const session = new PraetorComputerSession({
 *     screen: new PraetorScreen(),         // native screenshot
 *     input: nutInputAdapter,              // optional, opt-in
 *     bus: activityBus,                     // optional — pumps stream frames
 *     auditSink: { record: ... },          // optional
 *   });
 *   await session.screenshot();
 *   await session.click(120, 200);
 *   const stop = session.startStreaming({ missionId, intervalMs: 500 });
 *   // ...later
 *   stop();
 *
 * Per `feedback_praetor_native_tools.md`, the session itself is native
 * Praetor code. Input control (click/type/scroll/hotkey) genuinely needs
 * OS-level hooks, so it sits behind a `ComputerInputAdapter` interface
 * that callers wire in. A `noopInputAdapter` is provided for environments
 * where input mutation is intentionally disabled (read-only sessions).
 */

import type { ActivityBus, ActivityEvent } from "@kpanks/core";
import { PraetorScreen, type PraetorScreenOptions, type ScreenFrame } from "@kpanks/vision";

export interface AuditSinkLite {
  record: (type: string, data: Record<string, unknown>) => void;
}

export interface ComputerInputAdapter {
  /** Move cursor to (x, y) and press the named button. */
  click(x: number, y: number, button: "left" | "right" | "middle"): Promise<void>;
  /** Type a string at the current focus. */
  type(text: string): Promise<void>;
  /** Scroll the active surface by `amount` ticks in `direction`. */
  scroll(amount: number, direction: "up" | "down"): Promise<void>;
  /** Press a chord (e.g. ["control", "c"]). Adapter normalizes key names. */
  hotkey(keys: string[]): Promise<void>;
}

export interface PraetorComputerSessionOptions {
  /** Inject a configured PraetorScreen, or pass options to construct one. */
  screen?: PraetorScreen | PraetorScreenOptions;
  /** Optional input adapter. If omitted, click/type/scroll/hotkey throw. */
  input?: ComputerInputAdapter;
  /** Audit hook — called on every action with `(type, data)`. */
  auditSink?: AuditSinkLite;
  /** Activity bus for live frame streaming. */
  bus?: ActivityBus;
  /** Stable mission id for streaming activity events. Required if you stream without passing missionId per call. */
  missionId?: string;
}

export interface StreamHandle {
  /** Stops the streaming loop. Idempotent. */
  stop: () => void;
  /** Resolves after the underlying loop exits. */
  done: Promise<void>;
}

export class PraetorComputerSession {
  private readonly screen: PraetorScreen;
  private readonly input: ComputerInputAdapter | null;
  private readonly auditSink?: AuditSinkLite;
  private readonly bus?: ActivityBus;
  private readonly missionId?: string;

  constructor(opts: PraetorComputerSessionOptions = {}) {
    this.screen = opts.screen instanceof PraetorScreen ? opts.screen : new PraetorScreen(opts.screen ?? {});
    this.input = opts.input ?? null;
    this.auditSink = opts.auditSink;
    this.bus = opts.bus;
    this.missionId = opts.missionId;
  }

  /** Capture one screenshot. Returns base64 PNG and image dimensions. */
  async screenshot(): Promise<{ base64: string; ts: string; backend: string }> {
    this.auditSink?.record("computer.screenshot", {});
    const frame = await this.screen.capture();
    return {
      base64: `data:image/png;base64,${frame.pngBuffer.toString("base64")}`,
      ts: frame.ts,
      backend: frame.backend,
    };
  }

  /** Returns the most recent frame as a raw Buffer, suitable for redaction or pixel ops. */
  async captureFrame(): Promise<ScreenFrame> {
    this.auditSink?.record("computer.screenshot", {});
    return this.screen.capture();
  }

  async click(x: number, y: number, button: "left" | "right" | "middle" = "left"): Promise<void> {
    this.auditSink?.record("computer.click", { x, y, button });
    this.requireInput("click");
    await this.input!.click(x, y, button);
  }

  async type(text: string): Promise<void> {
    this.auditSink?.record("computer.type", { length: text.length });
    this.requireInput("type");
    await this.input!.type(text);
  }

  async scroll(amount: number, direction: "up" | "down" = "down"): Promise<void> {
    this.auditSink?.record("computer.scroll", { amount, direction });
    this.requireInput("scroll");
    await this.input!.scroll(amount, direction);
  }

  async hotkey(keys: string[]): Promise<void> {
    this.auditSink?.record("computer.hotkey", { keys });
    this.requireInput("hotkey");
    await this.input!.hotkey(keys);
  }

  /**
   * Start a streaming loop that captures the screen every `intervalMs` and
   * pushes each frame onto the activity bus as `artifact.partial` events.
   * Returns a handle whose `stop()` ends the loop.
   *
   * Each frame's `chunk` is a base64-encoded PNG so the dashboard can
   * render it without follow-up fetches.
   */
  startStreaming(args: { missionId?: string; intervalMs?: number; artifactId?: string }): StreamHandle {
    if (!this.bus) throw new Error("PraetorComputerSession: cannot stream without `bus`");
    const missionId = args.missionId ?? this.missionId;
    if (!missionId) throw new Error("PraetorComputerSession: missionId required (constructor or startStreaming arg)");
    const intervalMs = args.intervalMs ?? 1000;
    const artifactId = args.artifactId ?? `screen-${Date.now().toString(36)}`;
    const ac = new AbortController();
    this.auditSink?.record("computer.stream.start", { missionId, intervalMs, artifactId });
    const done = (async () => {
      try {
        for await (const frame of this.screen.streamFrames({ intervalMs, signal: ac.signal })) {
          if (ac.signal.aborted) break;
          const event: ActivityEvent = {
            kind: "artifact.partial",
            missionId,
            artifactId,
            format: "image",
            chunk: `data:image/png;base64,${frame.pngBuffer.toString("base64")}`,
            ts: frame.ts,
          };
          this.bus!.publish(event);
        }
      } finally {
        this.auditSink?.record("computer.stream.stop", { missionId, artifactId });
      }
    })();
    return {
      stop: () => ac.abort(),
      done,
    };
  }

  private requireInput(action: string): void {
    if (!this.input) {
      throw new Error(
        `PraetorComputerSession: '${action}' requires an input adapter. Pass { input: <ComputerInputAdapter> } to the constructor — see noopInputAdapter, or attach a platform-specific adapter (nut.js, RobotJS, custom).`,
      );
    }
  }
}

/**
 * Default no-op input adapter. Records intent into the audit sink (if any),
 * does nothing else. Useful for read-only sessions or for tests that don't
 * want to actually mutate the host.
 */
export const noopInputAdapter: ComputerInputAdapter = {
  async click() { /* no-op */ },
  async type() { /* no-op */ },
  async scroll() { /* no-op */ },
  async hotkey() { /* no-op */ },
};
