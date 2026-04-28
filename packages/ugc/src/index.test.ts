import { describe, it, expect } from "vitest";
import { MockUgcRenderer, specFromGoal, DEFAULT_BACKENDS } from "./index.js";

describe("Praetor UGC pipeline", () => {
  it("produces a default spec from a goal string", () => {
    const spec = specFromGoal({ id: "demo", goal: "Praetor ships ads in eight seconds." });
    expect(spec.id).toBe("demo");
    expect(spec.script).toContain("eight seconds");
    expect(spec.durationSeconds).toBe(8);
  });

  it("default backends are all zero-cost", () => {
    expect(DEFAULT_BACKENDS).toEqual({ portrait: "reuse", motion: "kenburns", voice: "edge-tts" });
  });

  it("mock renderer reports zero cost on the default zero-cost path", async () => {
    const r = new MockUgcRenderer();
    const result = await r.render(specFromGoal({ id: "free", goal: "free ads" }));
    expect(result.costUsd).toBe(0);
    expect(result.outputPath).toBe("out/free.mp4");
  });

  it("mock renderer prices the paid path correctly", async () => {
    const r = new MockUgcRenderer();
    const result = await r.render(
      specFromGoal({ id: "paid", goal: "paid ads" }),
      { portrait: "nano-banana", motion: "seedance", voice: "elevenlabs" },
    );
    expect(result.costUsd).toBe(0.59);
  });

  it("voice clone path requires a reference audio source", async () => {
    const r = new MockUgcRenderer();
    await expect(
      r.render(specFromGoal({ id: "clone-fail", goal: "x" }), { voice: "omnivoice-clone" }),
    ).rejects.toThrow(/voiceClone/);
  });

  it("voice clone path renders when a reference is supplied", async () => {
    const r = new MockUgcRenderer();
    const result = await r.render(
      specFromGoal({ id: "clone-ok", goal: "x" }),
      { voice: "xtts-v2-clone", voiceClone: { referencePath: "/abs/path/to/me.wav" } },
    );
    expect(result.backends.voice).toBe("xtts-v2-clone");
    expect(result.backends.voiceClone?.referencePath).toBe("/abs/path/to/me.wav");
  });
});
