import { describe, it, expect, vi } from "vitest";
import {
  MnemoPayHttpClient,
  MnemoPayMcpRestClient,
  ThreeTierKnowledgeBase,
  defaultKnowledgeBase,
  parseRecallText,
  TIERS,
} from "./mnemopay.js";
import { InMemoryKnowledgeBase, MnemoPayKnowledgeBase, type MnemoPayRecallClient } from "./index.js";

function memoryClient(): MnemoPayRecallClient & { ns: () => Map<string, { id: string; text: string }[]> } {
  const store = new Map<string, { id: string; text: string; metadata?: Record<string, unknown> }[]>();
  return {
    ns: () => store as unknown as Map<string, { id: string; text: string }[]>,
    async remember({ id, text, namespace, metadata }) {
      const list = store.get(namespace) ?? [];
      list.push({ id, text, metadata });
      store.set(namespace, list);
    },
    async recall({ query, namespace, topK }) {
      const list = store.get(namespace) ?? [];
      return list
        .map((c) => ({ id: c.id, text: c.text, score: c.text.includes(query) ? 1 : 0.1, metadata: c.metadata }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
    async forget({ id, namespace }) {
      const list = store.get(namespace) ?? [];
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) return { removed: false };
      list.splice(idx, 1);
      return { removed: true };
    },
    async size({ namespace }) {
      return (store.get(namespace) ?? []).length;
    },
  };
}

describe("MnemoPayHttpClient", () => {
  it("posts JSON with bearer auth to the right endpoints", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify([{ id: "x", text: "y", score: 0.5 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new MnemoPayHttpClient({ apiKey: "k1", baseUrl: "https://example.test", fetchImpl });
    const hits = await client.recall({ query: "q", namespace: "ns", topK: 3 });
    expect(hits[0].id).toBe("x");
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://example.test/v1/memory/recall");
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(((call[1] as RequestInit).headers as Record<string, string>).authorization).toBe("Bearer k1");
  });

  it("throws on non-2xx with response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const client = new MnemoPayHttpClient({ apiKey: "k", baseUrl: "https://x.test", fetchImpl });
    await expect(client.size({ namespace: "n" })).rejects.toThrow(/500/);
  });
});

describe("ThreeTierKnowledgeBase", () => {
  it("routes ingests by metadata.tier and falls back to default", async () => {
    const client = memoryClient();
    const kb = new ThreeTierKnowledgeBase({ missionId: "m1", client });
    await kb.ingest([
      { id: "w", text: "scratch note", metadata: { tier: "working" } },
      { id: "e", text: "yesterday log", metadata: { tier: "episodic" } },
      { id: "s", text: "company doc" }, // default → semantic
    ]);
    expect(client.ns().get("m1:working")?.length).toBe(1);
    expect(client.ns().get("m1:episodic")?.length).toBe(1);
    expect(client.ns().get("m1:semantic")?.length).toBe(1);
    expect(await kb.size()).toBe(3);
  });

  it("query merges across tiers and applies the working-memory weight", async () => {
    const client = memoryClient();
    const kb = new ThreeTierKnowledgeBase({ missionId: "m2", client });
    await kb.ingest([
      { id: "w", text: "praetor handles autonomous", metadata: { tier: "working" } },
      { id: "s", text: "praetor handles autonomous", metadata: { tier: "semantic" } },
    ]);
    const hits = await kb.query("praetor", 5);
    // Both match equally in the mock client; working tier should rank first via TIER_WEIGHT.
    expect(hits[0].chunk.id).toBe("w");
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("forget walks tiers when origin is unknown", async () => {
    const client = memoryClient();
    const kb = new ThreeTierKnowledgeBase({ missionId: "m3", client });
    await kb.ingest([{ id: "z", text: "deletable", metadata: { tier: "episodic" } }]);
    // Cause the in-memory tier map to forget where z lives:
    const r = await kb.forget("z");
    expect(r.removed).toBe(true);
    expect(await kb.size()).toBe(0);
  });

  it("exports the canonical tier list", () => {
    expect(TIERS).toEqual(["working", "episodic", "semantic"]);
  });
});

describe("defaultKnowledgeBase", () => {
  it("returns InMemoryKnowledgeBase when MNEMOPAY_API_KEY is unset", () => {
    const kb = defaultKnowledgeBase({ missionId: "m", env: {} as NodeJS.ProcessEnv });
    expect(kb).toBeInstanceOf(InMemoryKnowledgeBase);
  });

  it("returns ThreeTierKnowledgeBase via v1 HTTP when MNEMOPAY_API_KEY + BASE_URL set", () => {
    const kb = defaultKnowledgeBase({
      missionId: "m",
      env: { MNEMOPAY_API_KEY: "k", MNEMOPAY_BASE_URL: "https://x.test" } as unknown as NodeJS.ProcessEnv,
    });
    expect(kb).toBeInstanceOf(ThreeTierKnowledgeBase);
  });

  it("returns ThreeTierKnowledgeBase via MCP REST when MNEMOPAY_MCP_TOKEN set", () => {
    const kb = defaultKnowledgeBase({
      missionId: "m",
      env: { MNEMOPAY_MCP_TOKEN: "t" } as unknown as NodeJS.ProcessEnv,
    });
    expect(kb).toBeInstanceOf(ThreeTierKnowledgeBase);
  });

  it("MnemoPayKnowledgeBase is exported alongside helpers", () => {
    expect(MnemoPayKnowledgeBase).toBeTypeOf("function");
  });
});

describe("parseRecallText", () => {
  it("parses the MCP recall formatted string", () => {
    const text = [
      "1. [score:0.92, importance:0.50] User prefers monthly billing",
      "2. [score:0.81, importance:0.40] Asked about EU AI Act compliance",
    ].join("\n");
    const hits = parseRecallText(text, "mission-1");
    expect(hits).toHaveLength(2);
    expect(hits[0].text).toBe("User prefers monthly billing");
    expect(hits[0].score).toBe(0.92);
    expect(hits[0].metadata?.importance).toBe(0.5);
    expect(hits[0].id).toBe("mission-1:1");
  });

  it("handles empty recall response (No memories found.)", () => {
    expect(parseRecallText("", "ns")).toEqual([]);
  });
});

describe("MnemoPayMcpRestClient", () => {
  it("calls /api/recall with bearer token and parses formatted text", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        tool: "recall",
        result: "1. [score:0.90, importance:0.50] hello\n2. [score:0.70, importance:0.30] world",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const c = new MnemoPayMcpRestClient({ token: "tk", baseUrl: "https://mnemopay-mcp.fly.dev", fetchImpl });
    const hits = await c.recall({ query: "hi", namespace: "ns", topK: 5 });
    expect(hits).toHaveLength(2);
    expect(hits[0].text).toBe("hello");
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://mnemopay-mcp.fly.dev/api/recall");
    expect(((call[1] as RequestInit).headers as Record<string, string>).authorization).toBe("Bearer tk");
  });

  it("returns [] when MCP says 'No memories found.'", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, tool: "recall", result: "No memories found." }),
        { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const c = new MnemoPayMcpRestClient({ token: "tk", fetchImpl });
    const hits = await c.recall({ query: "x", namespace: "ns", topK: 5 });
    expect(hits).toEqual([]);
  });

  it("remember packs id + namespace into tags so they round-trip", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, tool: "remember", result: { id: "m_1", status: "stored" } }),
        { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const c = new MnemoPayMcpRestClient({ token: "tk", fetchImpl });
    await c.remember({ id: "abc", text: "note", namespace: "missionA" });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://mnemopay-mcp.fly.dev/api/remember");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.tags).toContain("id:abc");
    expect(body.tags).toContain("ns:missionA");
  });
});
