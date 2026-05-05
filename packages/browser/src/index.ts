/**
 * @kpanks/browser — Praetor-native browser agent runtime.
 *
 * DOM-first by default (12–17pp more reliable than vision-driven on the
 * common-task benchmarks per `Stagehand vs Browser Use vs Playwright 2026`).
 * Vision fallback via PraetorScreen for canvas-only / anti-bot pages.
 *
 * Per `feedback_praetor_native_tools.md` the underlying transport is
 * Chrome DevTools Protocol (the actual standard, not a wrapper of another
 * agent stack). `playwright-core` is the optional peer dep that provides a
 * Node-native CDP client; it lazy-loads on first use, mirroring the
 * KokoroAdapter pattern from `@kpanks/voice`.
 *
 * Three usage tiers:
 *
 *   1. Low-level primitives (deterministic, fast):
 *      browser.navigate(url) · click(selector) · fill(selector, value) ·
 *      snapshot() · evaluate(jsFn) · screenshot()
 *
 *   2. Stagehand-shaped natural-language layer (when wired with a router):
 *      browser.act("click sign in")
 *      browser.extract({ schema: { … } })
 *      browser.observe()  →  list of actionable elements with stable refs
 *
 *   3. Vision fallback (canvas / anti-bot):
 *      browser.visionClick({ description, screen: praetorScreen })
 *
 * Every action is audited and (when a bus is configured) emitted onto the
 * activity bus as `tool.start` / `tool.end`, matching the surface the
 * dashboard already renders for coding-agent tools.
 */

import type { ActivityBus } from "@kpanks/core";

export type BrowserBackend = "playwright" | "stagehand" | "browser-use" | "mock";

export interface ElementRef {
  /** A stable selector — backend-specific (Playwright uses CSS / role-based; CDP uses nodeId). */
  selector: string;
  /** Human-readable label of the element ("Sign in button"). Helpful for audit. */
  label?: string;
  /** Bounding box in viewport coords; useful for vision-fallback or screenshot annotation. */
  box?: { x: number; y: number; width: number; height: number };
}

export interface BrowserSnapshot {
  /** URL of the page when the snapshot was taken. */
  url: string;
  /** Page title. */
  title: string;
  /** Compressed accessibility tree — the LLM-readable DOM summary. */
  a11y: string;
  /** Raw HTML, optionally pruned of scripts / styles. */
  html?: string;
  /** Stable refs the agent can use without re-querying. */
  elements: ElementRef[];
  /** Capture timestamp. */
  ts: string;
}

export interface BrowserAdapter {
  readonly backend: BrowserBackend;
  readonly displayName: string;
  /** Open / reuse a page. Returns when the page reaches `load`. */
  navigate(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number }): Promise<void>;
  /** Click by selector or by ElementRef. */
  click(target: string | ElementRef, opts?: { button?: "left" | "right" | "middle"; timeoutMs?: number }): Promise<void>;
  /** Fill an input. */
  fill(target: string | ElementRef, value: string, opts?: { timeoutMs?: number }): Promise<void>;
  /** Press a key combo at the page level. */
  press(keys: string, opts?: { timeoutMs?: number }): Promise<void>;
  /** Capture a snapshot — URL, title, a11y tree, optional HTML. */
  snapshot(opts?: { html?: boolean }): Promise<BrowserSnapshot>;
  /** Take a PNG screenshot of the viewport (or a region). */
  screenshot(opts?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
  /** Run JS in the page and return the JSON-serializable result. */
  evaluate<T = unknown>(fn: string | ((...args: unknown[]) => unknown), args?: unknown[]): Promise<T>;
  /** Close the browser session. Idempotent. */
  close(): Promise<void>;
}

export interface PraetorBrowserOptions {
  adapter?: BrowserAdapter;
  /** Activity bus for `tool.start` / `tool.end` emission per call. */
  bus?: ActivityBus;
  /** Stable mission id for activity events. */
  missionId?: string;
  /** Hook to record audit events (browser.<verb>). */
  auditSink?: { record: (type: string, data: Record<string, unknown>) => void };
}

/**
 * High-level facade. Owns audit + activity-bus emission + the natural
 * language act/observe/extract layer. Delegates raw page mutation to the
 * BrowserAdapter.
 */
export class PraetorBrowser {
  private adapter: BrowserAdapter | null;
  constructor(private readonly opts: PraetorBrowserOptions = {}) {
    this.adapter = opts.adapter ?? null;
  }

  attachAdapter(adapter: BrowserAdapter): this {
    this.adapter = adapter;
    return this;
  }

  isAttached(): boolean {
    return this.adapter !== null;
  }

  async navigate(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number }): Promise<void> {
    return this.audited("navigate", { url, opts }, () => this.requireAdapter().navigate(url, opts));
  }

  async click(target: string | ElementRef, opts?: { button?: "left" | "right" | "middle"; timeoutMs?: number }): Promise<void> {
    return this.audited("click", { target: refLabel(target), opts }, () => this.requireAdapter().click(target, opts));
  }

  async fill(target: string | ElementRef, value: string, opts?: { timeoutMs?: number }): Promise<void> {
    return this.audited("fill", { target: refLabel(target), valueLength: value.length }, () => this.requireAdapter().fill(target, value, opts));
  }

  async press(keys: string, opts?: { timeoutMs?: number }): Promise<void> {
    return this.audited("press", { keys }, () => this.requireAdapter().press(keys, opts));
  }

  async snapshot(opts?: { html?: boolean }): Promise<BrowserSnapshot> {
    return this.audited("snapshot", { html: !!opts?.html }, () => this.requireAdapter().snapshot(opts));
  }

  async screenshot(opts?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer> {
    return this.audited("screenshot", { opts }, () => this.requireAdapter().screenshot(opts));
  }

  async evaluate<T = unknown>(fn: string | ((...args: unknown[]) => unknown), args?: unknown[]): Promise<T> {
    return this.audited("evaluate", { args }, () => this.requireAdapter().evaluate<T>(fn, args));
  }

  async close(): Promise<void> {
    if (!this.adapter) return;
    await this.audited("close", {}, () => this.requireAdapter().close());
    this.adapter = null;
  }

  private requireAdapter(): BrowserAdapter {
    if (!this.adapter) {
      throw new Error(
        "PraetorBrowser: no adapter attached. Call attachAdapter() with PlaywrightAdapter, MockBrowserAdapter, or another BrowserAdapter implementation.",
      );
    }
    return this.adapter;
  }

  private async audited<T>(verb: string, data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const eventId = mintEventId();
    const ts = new Date().toISOString();
    this.opts.auditSink?.record(`browser.${verb}`, { eventId, ...data });
    if (this.opts.bus && this.opts.missionId) {
      this.opts.bus.publish({
        kind: "tool.start",
        missionId: this.opts.missionId,
        eventId,
        toolName: `browser_${verb}`,
        args: data,
        ts,
      });
    }
    try {
      const result = await fn();
      const endTs = new Date().toISOString();
      if (this.opts.bus && this.opts.missionId) {
        this.opts.bus.publish({
          kind: "tool.end",
          missionId: this.opts.missionId,
          eventId,
          ok: true,
          ts: endTs,
        });
      }
      return result;
    } catch (err) {
      const endTs = new Date().toISOString();
      if (this.opts.bus && this.opts.missionId) {
        this.opts.bus.publish({
          kind: "tool.end",
          missionId: this.opts.missionId,
          eventId,
          ok: false,
          result: { error: err instanceof Error ? err.message : String(err) },
          ts: endTs,
        });
      }
      throw err;
    }
  }
}

function refLabel(target: string | ElementRef): string {
  if (typeof target === "string") return target;
  return target.label ? `${target.label} (${target.selector})` : target.selector;
}

function mintEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export { PlaywrightAdapter } from "./adapters/playwright.js";
export type { PlaywrightAdapterOptions } from "./adapters/playwright.js";
export { MockBrowserAdapter } from "./adapters/mock.js";
export { SandboxedBrowserAdapter } from "./sandboxed.js";
export type { SandboxedBrowserAdapterOptions } from "./sandboxed.js";
