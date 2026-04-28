import { describe, it, expect } from "vitest";
import { InMemoryKnowledgeBase, chunkText, MnemoPayKnowledgeBase } from "./index.js";

describe("Praetor knowledge pack", () => {
  it("ingests and retrieves the most similar chunk", async () => {
    const kb = new InMemoryKnowledgeBase();
    await kb.ingest([
      { id: "a", text: "Praetor is a mission runtime for autonomous agents." },
      { id: "b", text: "MnemoPay is a payments and memory SDK for AI agents." },
      { id: "c", text: "Pasta carbonara is best with guanciale and pecorino." },
    ]);
    const hits = await kb.query("what runs autonomous agents", 2);
    expect(hits[0].chunk.id).toBe("a");
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits.map((h) => h.chunk.id)).not.toContain("c");
  });

  it("forget() removes a chunk and decrements size", async () => {
    const kb = new InMemoryKnowledgeBase();
    await kb.ingest([{ id: "x", text: "foo" }, { id: "y", text: "bar" }]);
    expect(await kb.size()).toBe(2);
    expect(await kb.forget("x")).toEqual({ removed: true });
    expect(await kb.size()).toBe(1);
    expect(await kb.forget("missing")).toEqual({ removed: false });
  });

  it("chunkText splits long input on paragraph boundaries", () => {
    const long =
      "First paragraph about agents. ".repeat(60) +
      "\n\n" +
      "Second paragraph about payments. ".repeat(60);
    const out = chunkText(long, 600, 60);
    expect(out.length).toBeGreaterThan(1);
    out.forEach((c) => expect(c.length).toBeLessThanOrEqual(700));
  });

  it("MnemoPayKnowledgeBase delegates to the recall client", async () => {
    const log: string[] = [];
    const client = {
      remember: async (a: { id: string }) => { log.push(`r:${a.id}`); },
      recall: async () => [{ id: "1", text: "hi", score: 0.9 }],
      forget: async (a: { id: string }) => { log.push(`f:${a.id}`); return { removed: true }; },
      size: async () => 1,
    };
    const kb = new MnemoPayKnowledgeBase(client, "ns");
    await kb.ingest([{ id: "1", text: "hello" }]);
    const hits = await kb.query("?");
    expect(hits[0].chunk.id).toBe("1");
    expect(await kb.forget("1")).toEqual({ removed: true });
    expect(log).toEqual(["r:1", "f:1"]);
  });
});
