import { describe, it, expect, vi } from "vitest";
import { InMemoryActivityBus, type ActivityEvent } from "@kpanks/core";
import { PraetorBrowser, MockBrowserAdapter, PlaywrightAdapter, type BrowserSnapshot, type ElementRef } from "./index.js";
import { compressAccessibilityTree } from "./adapters/playwright.js";

describe("PraetorBrowser — runtime", () => {
  it("delegates navigate/click/fill to the attached adapter and records audit events", async () => {
    const adapter = new MockBrowserAdapter({ pages: { "https://example.com": { url: "https://example.com", title: "Example", a11y: "- heading: Example" } } });
    const audited: { type: string; data: Record<string, unknown> }[] = [];
    const browser = new PraetorBrowser({ adapter, auditSink: { record: (type, data) => audited.push({ type, data }) } });

    await browser.navigate("https://example.com");
    await browser.click("button.submit");
    await browser.fill("input#email", "smoke@praetor.dev");
    await browser.press("Enter");

    expect(adapter.calls.map((c) => c.method)).toEqual(["navigate", "click", "fill", "press"]);
    expect(audited.map((a) => a.type)).toEqual([
      "browser.navigate", "browser.click", "browser.fill", "browser.press",
    ]);
  });

  it("snapshot returns the adapter's compressed a11y view", async () => {
    const adapter = new MockBrowserAdapter({
      pages: {
        "https://example.com": {
          url: "https://example.com",
          title: "Example",
          a11y: "- heading: Welcome\n- link: Sign in",
          elements: [{ selector: "[role=link]", label: "Sign in" }],
        },
      },
    });
    const browser = new PraetorBrowser({ adapter });
    await browser.navigate("https://example.com");
    const snap: BrowserSnapshot = await browser.snapshot();
    expect(snap.title).toBe("Example");
    expect(snap.a11y).toContain("Sign in");
    expect(snap.elements[0].label).toBe("Sign in");
  });

  it("publishes tool.start + tool.end activity events with stitched eventIds", async () => {
    const adapter = new MockBrowserAdapter();
    const bus = new InMemoryActivityBus();
    const events: ActivityEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const browser = new PraetorBrowser({ adapter, bus, missionId: "m-1" });
    await browser.navigate("https://example.com");
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("tool.start");
    expect(events[1].kind).toBe("tool.end");
    if (events[0].kind === "tool.start" && events[1].kind === "tool.end") {
      expect(events[0].toolName).toBe("browser_navigate");
      expect(events[0].eventId).toBe(events[1].eventId);
      expect(events[1].ok).toBe(true);
    }
  });

  it("emits tool.end with ok=false when the adapter throws", async () => {
    const adapter = new MockBrowserAdapter({ shouldFail: { click: true } });
    const bus = new InMemoryActivityBus();
    const events: ActivityEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const browser = new PraetorBrowser({ adapter, bus, missionId: "m-2" });
    await expect(browser.click("button")).rejects.toThrow(/simulated click failure/);
    const end = events.find((e) => e.kind === "tool.end");
    if (end?.kind === "tool.end") {
      expect(end.ok).toBe(false);
      expect(end.result).toEqual({ error: "MockBrowserAdapter: simulated click failure" });
    }
  });

  it("throws a clear error when no adapter is attached", async () => {
    const browser = new PraetorBrowser();
    await expect(browser.navigate("https://example.com")).rejects.toThrow(/no adapter attached/);
  });

  it("attachAdapter() works post-construction; close() releases the adapter", async () => {
    const adapter = new MockBrowserAdapter();
    const browser = new PraetorBrowser();
    expect(browser.isAttached()).toBe(false);
    browser.attachAdapter(adapter);
    expect(browser.isAttached()).toBe(true);
    await browser.navigate("https://example.com");
    await browser.close();
    expect(adapter.isClosed()).toBe(true);
    expect(browser.isAttached()).toBe(false);
  });

  it("ElementRef-based click passes through the selector and labels are surfaced in audit", async () => {
    const adapter = new MockBrowserAdapter();
    const audited: Record<string, unknown>[] = [];
    const browser = new PraetorBrowser({ adapter, auditSink: { record: (_type, data) => audited.push(data) } });
    const ref: ElementRef = { selector: "[role=button][name=\"Sign in\"]", label: "Sign in" };
    await browser.click(ref);
    expect(adapter.calls[0].args[0]).toEqual(ref);
    const event = audited.find((d) => typeof d.target === "string" && d.target.includes("Sign in"));
    expect(event).toBeTruthy();
  });

  it("evaluate() returns the adapter's stub result", async () => {
    const adapter = new MockBrowserAdapter({ evaluateResult: { count: 42 } });
    const browser = new PraetorBrowser({ adapter });
    const r = await browser.evaluate<{ count: number }>("() => ({count: document.querySelectorAll('a').length})");
    expect(r).toEqual({ count: 42 });
  });

  it("screenshot returns a PNG buffer (signature byte check)", async () => {
    const adapter = new MockBrowserAdapter();
    const browser = new PraetorBrowser({ adapter });
    const buf = await browser.screenshot();
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe("PlaywrightAdapter — lazy load + injection", () => {
  it("uses an injected page handle and produces a sensible snapshot", async () => {
    const fakePage = {
      goto: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      keyboard: { press: vi.fn(async () => undefined) },
      url: () => "https://praetor.dev",
      title: async () => "Praetor",
      content: async () => "<html><body><h1>Praetor</h1></body></html>",
      accessibility: {
        snapshot: async () => ({
          role: "WebArea",
          name: "Praetor",
          children: [
            { role: "heading", name: "Welcome to Praetor" },
            { role: "link", name: "Sign in" },
            { role: "textbox", name: "Email" },
          ],
        }),
      },
      screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xab]),
      evaluate: async <T>(_fn: unknown, _args?: unknown) => 7 as unknown as T,
    };
    const adapter = new PlaywrightAdapter({ __injectPage: fakePage });
    await adapter.navigate("https://praetor.dev");
    expect(fakePage.goto).toHaveBeenCalledWith("https://praetor.dev", { waitUntil: "load", timeout: undefined });

    const snap = await adapter.snapshot({ html: true });
    expect(snap.url).toBe("https://praetor.dev");
    expect(snap.title).toBe("Praetor");
    expect(snap.a11y).toContain("Sign in");
    expect(snap.elements.some((e) => e.label === "Sign in")).toBe(true);
    expect(snap.elements.some((e) => e.label === "Email")).toBe(true);
    expect(snap.html).toContain("<h1>Praetor</h1>");

    await adapter.click("button.submit");
    expect(fakePage.click).toHaveBeenCalledWith("button.submit", { button: "left", timeout: undefined });

    const evalRes = await adapter.evaluate<number>("() => document.querySelectorAll('a').length");
    expect(evalRes).toBe(7);
  });

  it("throws a helpful error when playwright-core is not installed (no inject + no peer)", async () => {
    const adapter = new PlaywrightAdapter();
    await expect(adapter.navigate("https://example.com")).rejects.toThrow(/playwright-core' is not installed/);
  });
});

describe("compressAccessibilityTree", () => {
  it("emits an indented outline + actionable element refs", () => {
    const tree = {
      role: "WebArea",
      name: "Test",
      children: [
        { role: "heading", name: "Title" },
        {
          role: "navigation",
          children: [
            { role: "link", name: "Home" },
            { role: "link", name: "About" },
          ],
        },
        { role: "button", name: "Submit" },
      ],
    };
    const { a11y, elements } = compressAccessibilityTree(tree);
    expect(a11y).toMatch(/heading: Title/);
    expect(a11y).toMatch(/link: Home/);
    expect(a11y).toMatch(/button: Submit/);
    expect(elements.map((e) => e.label).sort()).toEqual(["About", "Home", "Submit"]);
  });

  it("returns empty result for null/undefined trees", () => {
    expect(compressAccessibilityTree(null)).toEqual({ a11y: "", elements: [] });
    expect(compressAccessibilityTree(undefined)).toEqual({ a11y: "", elements: [] });
  });
});
