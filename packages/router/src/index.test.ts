import { describe, it, expect } from "vitest";
import { LlmRouter, MockProvider, DEFAULT_CATALOGUE } from "./index.js";

describe("LlmRouter.pick", () => {
  it("respects sovereign requirement (only open-weight)", () => {
    const r = new LlmRouter();
    const m = r.pick({ sovereign: true });
    expect(m.openWeight).toBe(true);
    expect(m.id).toMatch(/^xiaomi\//);
  });

  it("filters by minContextK", () => {
    const r = new LlmRouter();
    const m = r.pick({ minContextK: 500 });
    expect(m.contextTokens).toBeGreaterThanOrEqual(500 * 1024);
  });

  it("respects cost ceiling", () => {
    const r = new LlmRouter();
    const m = r.pick({ maxUsdPer1K: 1, quality: "balanced" });
    expect((m.inputUsdPer1K + m.outputUsdPer1K) / 2).toBeLessThanOrEqual(1);
  });

  it("biases preferred tags", () => {
    const r = new LlmRouter();
    const m = r.pick({ preferTags: ["long-context"], quality: "high" });
    expect(m.tags ?? []).toContain("long-context");
  });

  it("preferModel forces an exact match when present", () => {
    const r = new LlmRouter();
    const m = r.pick({ preferModel: "xiaomi/mimo-v2.5-pro" });
    expect(m.id).toBe("xiaomi/mimo-v2.5-pro");
  });

  it("throws when nothing matches", () => {
    const r = new LlmRouter();
    expect(() => r.pick({ sovereign: true, minContextK: 99999 })).toThrow(/no model satisfies/);
  });

  it("DEFAULT_CATALOGUE includes Xiaomi MiMo-V2.5-Pro (RESEARCH.md mandate)", () => {
    expect(DEFAULT_CATALOGUE.find((m) => m.id === "xiaomi/mimo-v2.5-pro")).toBeDefined();
  });
});

describe("LlmRouter.chat", () => {
  it("dispatches to the provider matching the chosen card", async () => {
    const r = new LlmRouter();
    r.register(new MockProvider("openrouter"));
    const res = await r.chat({ messages: [{ role: "user", content: "hi" }] }, { sovereign: true });
    expect(res.text).toMatch(/^mock\(xiaomi\//);
  });

  it("throws when chosen card's provider is missing", async () => {
    const r = new LlmRouter();
    await expect(r.chat({ messages: [{ role: "user", content: "hi" }] }, {})).rejects.toThrow(/provider .* not registered/);
  });
});
