/**
 * MockBrowserAdapter — deterministic test backend. Simulates page state
 * via a small in-memory model so PraetorBrowser tests can exercise the
 * full surface without a Chromium binary.
 */

import type {
  BrowserAdapter,
  BrowserBackend,
  BrowserSnapshot,
  ElementRef,
} from "../index.js";

export interface MockBrowserPage {
  url: string;
  title: string;
  a11y: string;
  html?: string;
  elements?: ElementRef[];
}

export interface MockBrowserAdapterOptions {
  /** Map of URL → page state. The mock returns the matching entry on navigate. */
  pages?: Record<string, MockBrowserPage>;
  /** Throw on click/fill/press for failure-path tests. */
  shouldFail?: { click?: boolean; fill?: boolean; press?: boolean; navigate?: boolean };
  /** Override the screenshot bytes. Defaults to a tiny PNG signature. */
  screenshotBytes?: Buffer;
  /** Override evaluate result. */
  evaluateResult?: unknown;
}

const DEFAULT_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class MockBrowserAdapter implements BrowserAdapter {
  readonly backend: BrowserBackend = "mock";
  readonly displayName = "Mock browser (test)";
  /** Recorded calls — tests assert against this. */
  readonly calls: { method: string; args: unknown[] }[] = [];
  private current: MockBrowserPage = {
    url: "about:blank",
    title: "blank",
    a11y: "",
    elements: [],
  };
  private closed = false;

  constructor(private readonly opts: MockBrowserAdapterOptions = {}) {}

  async navigate(url: string, opts?: unknown): Promise<void> {
    this.calls.push({ method: "navigate", args: [url, opts] });
    if (this.opts.shouldFail?.navigate) throw new Error("MockBrowserAdapter: simulated navigate failure");
    const next = this.opts.pages?.[url];
    this.current = next ?? { url, title: `Page ${url}`, a11y: "", elements: [] };
    this.current.url = url;
  }

  async click(target: string | ElementRef, opts?: unknown): Promise<void> {
    this.calls.push({ method: "click", args: [target, opts] });
    if (this.opts.shouldFail?.click) throw new Error("MockBrowserAdapter: simulated click failure");
  }

  async fill(target: string | ElementRef, value: string, opts?: unknown): Promise<void> {
    this.calls.push({ method: "fill", args: [target, value, opts] });
    if (this.opts.shouldFail?.fill) throw new Error("MockBrowserAdapter: simulated fill failure");
  }

  async press(keys: string, opts?: unknown): Promise<void> {
    this.calls.push({ method: "press", args: [keys, opts] });
    if (this.opts.shouldFail?.press) throw new Error("MockBrowserAdapter: simulated press failure");
  }

  async snapshot(opts?: { html?: boolean }): Promise<BrowserSnapshot> {
    this.calls.push({ method: "snapshot", args: [opts] });
    return {
      url: this.current.url,
      title: this.current.title,
      a11y: this.current.a11y,
      html: opts?.html ? (this.current.html ?? `<html><body>${this.current.title}</body></html>`) : undefined,
      elements: this.current.elements ?? [],
      ts: new Date().toISOString(),
    };
  }

  async screenshot(opts?: unknown): Promise<Buffer> {
    this.calls.push({ method: "screenshot", args: [opts] });
    return this.opts.screenshotBytes ?? DEFAULT_PNG;
  }

  async evaluate<T>(fn: string | ((...args: unknown[]) => unknown), args?: unknown[]): Promise<T> {
    this.calls.push({ method: "evaluate", args: [String(fn).slice(0, 80), args] });
    return (this.opts.evaluateResult as T) ?? (undefined as unknown as T);
  }

  async close(): Promise<void> {
    this.calls.push({ method: "close", args: [] });
    this.closed = true;
  }

  /** Test-only — true after close() ran. */
  isClosed(): boolean {
    return this.closed;
  }
}
