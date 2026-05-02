import { describe, it, expect } from "vitest";
import { ToolRegistry } from "@praetor/tools";
import { InMemoryKnowledgeBase } from "@praetor/knowledge";
import { LlmRouter, MockProvider } from "@praetor/router";
import { registerWebSearch, parseDuckHtml } from "./tools/web_search.js";
import { registerFetchUrl } from "./tools/fetch_url.js";
import { registerSynthesize } from "./tools/synthesize.js";
import { registerIngestKb } from "./tools/ingest_kb.js";

const researchCtx = { role: "research" };

describe("web_search — backend selection", () => {
  it("uses Brave when BRAVE_API_KEY is set in quality mode", async () => {
    const reg = new ToolRegistry();
    let calledHost = "";
    const fakeFetch: typeof fetch = async (input, _init) => {
      calledHost = new URL(input as string).host;
      const body = JSON.stringify({ web: { results: [{ title: "T", url: "https://example.com", description: "S" }] } });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    };
    registerWebSearch(reg, { env: { BRAVE_API_KEY: "k" } as any, fetchImpl: fakeFetch });
    const r = await reg.call<{ backend: string; hits: unknown[] }>("search_web", { query: "praetor" }, researchCtx);
    expect(r.backend).toBe("brave");
    expect(calledHost).toContain("brave.com");
    expect(r.hits.length).toBe(1);
  });

  it("falls back to DuckDuckGo when no Brave key is set", async () => {
    const reg = new ToolRegistry();
    const html = `<a class="result__a" href="https://example.com/a">Title A</a><a class="result__snippet">Snippet A</a>`;
    const fakeFetch: typeof fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    registerWebSearch(reg, { env: {} as any, fetchImpl: fakeFetch });
    const r = await reg.call<{ backend: string; hits: { title: string; url: string }[] }>("search_web", { query: "praetor" }, researchCtx);
    expect(r.backend).toBe("duckduckgo");
    expect(r.hits[0].title).toBe("Title A");
  });

  it("cost mode prefers DuckDuckGo even when Brave is configured", async () => {
    const reg = new ToolRegistry();
    let firstHost = "";
    const html = `<a class="result__a" href="https://example.com/a">A</a><a class="result__snippet">S</a>`;
    const fakeFetch: typeof fetch = async (input) => {
      const u = new URL(input as string);
      if (!firstHost) firstHost = u.host;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    };
    registerWebSearch(reg, { env: { RESEARCH_PREFER: "cost", BRAVE_API_KEY: "k" } as any, fetchImpl: fakeFetch });
    await reg.call("search_web", { query: "x" }, researchCtx);
    expect(firstHost).toContain("duckduckgo");
  });

  it("parseDuckHtml extracts titles, urls, snippets", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">First</a>
      <a class="result__snippet">Snippet one</a>
      <a class="result__a" href="https://example.com/b">Second</a>
      <a class="result__snippet">Snippet two</a>
    `;
    const hits = parseDuckHtml(html, 5);
    expect(hits.length).toBe(2);
    expect(hits[0].url).toBe("https://example.com/a");
    expect(hits[0].title).toBe("First");
    expect(hits[1].snippet).toBe("Snippet two");
  });
});

describe("synthesize — emits citations and uses the router", () => {
  it("invokes the router and returns a report referencing the sources", async () => {
    const router = new LlmRouter([
      { id: "mock/test", provider: "mock", contextTokens: 64_000, inputUsdPer1K: 0.1, outputUsdPer1K: 0.2, quality: "high", openWeight: true },
    ]);
    router.register(new MockProvider("mock"));
    const reg = new ToolRegistry();
    registerSynthesize(reg, { router });
    const r = await reg.call<{ report: string; model: string }>("synthesize", {
      goal: "Summarize",
      hits: [{ title: "Anchor", url: "https://a.example/x", snippet: "..." }],
    }, researchCtx);
    expect(typeof r.report).toBe("string");
    expect(r.model).toBe("mock/test");
  });
});

describe("ingest_kb — chunks and stores", () => {
  it("writes chunks into an in-memory KB", async () => {
    const kb = new InMemoryKnowledgeBase();
    const reg = new ToolRegistry();
    registerIngestKb(reg, { kb });
    const text = "Praetor is a mission runtime. ".repeat(80);
    const r = await reg.call<{ chunks: number }>("ingest_kb", {
      source: "https://example.com/p",
      title: "Praetor docs",
      text,
    }, researchCtx);
    expect(r.chunks).toBeGreaterThan(0);
    expect(await kb.size()).toBe(r.chunks);
    const hits = await kb.query("mission runtime", 3);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("fetch_url — wraps the scrape adapter", () => {
  it("registers without error", () => {
    const reg = new ToolRegistry();
    expect(() => registerFetchUrl(reg, {})).not.toThrow();
    expect(reg.has("fetch_url")).toBe(true);
  });
});
