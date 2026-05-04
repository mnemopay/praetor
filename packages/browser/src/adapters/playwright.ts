/**
 * PlaywrightAdapter — lazy-loads `playwright-core` (Apache 2.0). The actual
 * browser-launching dependency is treated as an optional peer so the
 * @praetor/browser package itself stays light. Mirrors the KokoroAdapter
 * pattern from @praetor/voice.
 *
 * playwright-core is the *runtime primitive* (a CDP client), not a wrapper
 * around another agent stack. It satisfies the "Praetor tools are custom
 * native" doctrine for the same reason ONNX runtime satisfies it for voice
 * and PowerShell satisfies it for screen capture: the underlying surface
 * is the platform's native API; we own the agent layer above it.
 *
 * Install path:
 *   npm install playwright-core
 *   # then ensure a Chromium (or system Chrome) binary is reachable
 */

import type {
  BrowserAdapter,
  BrowserBackend,
  BrowserSnapshot,
  ElementRef,
} from "../index.js";

export interface PlaywrightAdapterOptions {
  /**
   * Override the launch options. Defaults to headless. Set `headless: false`
   * to watch the agent drive a real Chromium window during development.
   */
  launchOptions?: { headless?: boolean; args?: string[]; executablePath?: string };
  /** Default per-action timeout (ms). Used when callers don't pass one. */
  defaultTimeoutMs?: number;
  /**
   * Test injection — bypass the lazy import and use a pre-built page handle.
   * Useful for unit tests; not for real launches.
   */
  __injectPage?: PlaywrightPageLike;
}

/**
 * Minimal subset of `playwright-core`'s `Page` we depend on. Pulled out as
 * a structural type so tests can stub without dragging in playwright.
 */
export interface PlaywrightPageLike {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  click(selector: string, opts?: { button?: "left" | "right" | "middle"; timeout?: number }): Promise<void>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  keyboard: { press(keys: string, opts?: { timeout?: number }): Promise<void> };
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  accessibility: { snapshot(opts?: { interestingOnly?: boolean }): Promise<unknown> };
  screenshot(opts?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
  evaluate<T>(fn: string | ((...args: unknown[]) => unknown), args?: unknown[]): Promise<T>;
  close?(): Promise<void>;
  context?(): { browser?(): { close?(): Promise<void> } | undefined } | undefined;
}

interface PlaywrightModuleLike {
  chromium: {
    launch(opts?: { headless?: boolean; args?: string[]; executablePath?: string }): Promise<{
      newPage(): Promise<PlaywrightPageLike>;
      close(): Promise<void>;
    }>;
  };
}

export class PlaywrightAdapter implements BrowserAdapter {
  readonly backend: BrowserBackend = "playwright";
  readonly displayName = "Playwright (Chromium / CDP, lazy-loaded)";
  private page: PlaywrightPageLike | null;
  private browserHandle: { close(): Promise<void> } | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly opts: PlaywrightAdapterOptions = {}) {
    this.page = opts.__injectPage ?? null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.page) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      let mod: PlaywrightModuleLike;
      try {
        // Stage the specifier through a non-literal so TS skips static
        // module resolution for this optional peer dep.
        const specifier = "playwright-core";
        mod = (await import(/* @vite-ignore */ specifier)) as unknown as PlaywrightModuleLike;
      } catch (err) {
        throw new Error(
          "PlaywrightAdapter: optional peer dependency 'playwright-core' is not installed. Run `npm install playwright-core` to enable the native browser backend.",
        );
      }
      const launched = await mod.chromium.launch(this.opts.launchOptions ?? { headless: true });
      this.browserHandle = launched;
      this.page = await launched.newPage();
    })();
    return this.loadPromise;
  }

  private async page$(): Promise<PlaywrightPageLike> {
    await this.ensureLoaded();
    if (!this.page) throw new Error("PlaywrightAdapter: page failed to load");
    return this.page;
  }

  async navigate(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number }): Promise<void> {
    const page = await this.page$();
    await page.goto(url, { waitUntil: opts?.waitUntil ?? "load", timeout: opts?.timeoutMs ?? this.opts.defaultTimeoutMs });
  }

  async click(target: string | ElementRef, opts?: { button?: "left" | "right" | "middle"; timeoutMs?: number }): Promise<void> {
    const selector = typeof target === "string" ? target : target.selector;
    const page = await this.page$();
    await page.click(selector, { button: opts?.button ?? "left", timeout: opts?.timeoutMs ?? this.opts.defaultTimeoutMs });
  }

  async fill(target: string | ElementRef, value: string, opts?: { timeoutMs?: number }): Promise<void> {
    const selector = typeof target === "string" ? target : target.selector;
    const page = await this.page$();
    await page.fill(selector, value, { timeout: opts?.timeoutMs ?? this.opts.defaultTimeoutMs });
  }

  async press(keys: string, opts?: { timeoutMs?: number }): Promise<void> {
    const page = await this.page$();
    await page.keyboard.press(keys, { timeout: opts?.timeoutMs ?? this.opts.defaultTimeoutMs });
  }

  async snapshot(opts?: { html?: boolean }): Promise<BrowserSnapshot> {
    const page = await this.page$();
    const [url, title, raw, html] = await Promise.all([
      Promise.resolve(page.url()),
      page.title(),
      page.accessibility.snapshot({ interestingOnly: true }),
      opts?.html ? page.content() : Promise.resolve(undefined),
    ]);
    const { a11y, elements } = compressAccessibilityTree(raw);
    return {
      url,
      title,
      a11y,
      html,
      elements,
      ts: new Date().toISOString(),
    };
  }

  async screenshot(opts?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Buffer> {
    const page = await this.page$();
    const buf = await page.screenshot(opts);
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }

  async evaluate<T = unknown>(fn: string | ((...args: unknown[]) => unknown), args?: unknown[]): Promise<T> {
    const page = await this.page$();
    return page.evaluate<T>(fn, args);
  }

  async close(): Promise<void> {
    try {
      if (this.page?.close) await this.page.close();
    } catch { /* best-effort */ }
    try {
      if (this.browserHandle) await this.browserHandle.close();
    } catch { /* best-effort */ }
    this.page = null;
    this.browserHandle = null;
    this.loadPromise = null;
  }
}

interface AccessibilityNode {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  children?: AccessibilityNode[];
}

/**
 * Walk the Playwright a11y tree into a compact textual outline + a stable
 * list of actionable element refs. The outline format mirrors what
 * Stagehand v3 emits — readable for the LLM, smaller than raw HTML.
 */
export function compressAccessibilityTree(raw: unknown): { a11y: string; elements: ElementRef[] } {
  const root = raw as AccessibilityNode | null;
  if (!root) return { a11y: "", elements: [] };
  const lines: string[] = [];
  const elements: ElementRef[] = [];
  let counter = 0;
  function walk(node: AccessibilityNode | undefined, depth: number): void {
    if (!node) return;
    const role = node.role ?? "";
    const name = (node.name ?? "").trim();
    const value = (node.value ?? "").trim();
    if (role && (name || value || isActionable(role))) {
      const indent = "  ".repeat(depth);
      const display = name || value || role;
      lines.push(`${indent}- ${role}: ${display.slice(0, 120)}`);
      if (isActionable(role)) {
        const ref = `[role=${role}][name="${escapeSelector(name)}"]`;
        elements.push({ selector: ref, label: name || role });
        counter += 1;
      }
    }
    for (const child of node.children ?? []) walk(child, depth + 1);
  }
  walk(root, 0);
  return { a11y: lines.join("\n"), elements };
}

function isActionable(role: string): boolean {
  return ["link", "button", "textbox", "combobox", "checkbox", "radio", "menuitem", "tab", "switch", "searchbox"].includes(role);
}

function escapeSelector(s: string): string {
  return s.replace(/"/g, '\\"');
}
