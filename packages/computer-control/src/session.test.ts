import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryActivityBus, type ActivityEvent } from "@praetor/core";
import { PraetorScreen } from "@praetor/vision";
import { PraetorComputerSession, noopInputAdapter, type ComputerInputAdapter } from "./session.js";
import { ToolRegistry } from "@praetor/tools";
import { registerComputerTools } from "./tools.js";

function makeFakeScreen(): { screen: PraetorScreen; pngBytes: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), "fake-screen-"));
  const tmpPath = join(dir, "frame.png");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xab, 0xcd]);
  const screen = new PraetorScreen({
    platform: "darwin",
    mktmp: () => tmpPath,
    spawnImpl: async (cmd, args) => {
      if (cmd === "screencapture") {
        writeFileSync(args[args.length - 1], png);
        return { code: 0, stderr: "" };
      }
      return { code: 1, stderr: "" };
    },
  });
  return { screen, pngBytes: png };
}

describe("PraetorComputerSession — screenshot + audit", () => {
  it("captures a screenshot, returns base64 PNG, and records the audit event", async () => {
    const events: { type: string; data: Record<string, unknown> }[] = [];
    const { screen } = makeFakeScreen();
    const session = new PraetorComputerSession({
      screen,
      auditSink: { record: (type, data) => events.push({ type, data }) },
    });
    const r = await session.screenshot();
    expect(r.base64.startsWith("data:image/png;base64,")).toBe(true);
    expect(r.backend).toBe("macos-screencapture");
    expect(events.map((e) => e.type)).toEqual(["computer.screenshot"]);
  });
});

describe("PraetorComputerSession — input adapter contract", () => {
  it("delegates click/type/scroll/hotkey to the adapter and audits each", async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const adapter: ComputerInputAdapter = {
      click: async (...a) => { calls.push({ method: "click", args: a }); },
      type: async (...a) => { calls.push({ method: "type", args: a }); },
      scroll: async (...a) => { calls.push({ method: "scroll", args: a }); },
      hotkey: async (...a) => { calls.push({ method: "hotkey", args: a }); },
    };
    const audited: string[] = [];
    const { screen } = makeFakeScreen();
    const session = new PraetorComputerSession({
      screen,
      input: adapter,
      auditSink: { record: (t) => audited.push(t) },
    });
    await session.click(10, 20);
    await session.type("hello");
    await session.scroll(3, "up");
    await session.hotkey(["control", "c"]);
    expect(calls.map((c) => c.method)).toEqual(["click", "type", "scroll", "hotkey"]);
    expect(audited).toEqual(["computer.click", "computer.type", "computer.scroll", "computer.hotkey"]);
  });

  it("throws a helpful error when input methods are called without an adapter", async () => {
    const { screen } = makeFakeScreen();
    const session = new PraetorComputerSession({ screen });
    await expect(session.click(0, 0)).rejects.toThrow(/requires an input adapter/);
    await expect(session.type("x")).rejects.toThrow(/requires an input adapter/);
  });

  it("noopInputAdapter satisfies the contract without mutating anything", async () => {
    const { screen } = makeFakeScreen();
    const session = new PraetorComputerSession({ screen, input: noopInputAdapter });
    await session.click(0, 0);
    await session.type("noop");
    await session.scroll(1);
    await session.hotkey(["enter"]);
    // No throws — passes.
  });
});

describe("PraetorComputerSession — startStreaming", () => {
  it("publishes artifact.partial frames to the activity bus and stops on stop()", async () => {
    const { screen } = makeFakeScreen();
    const bus = new InMemoryActivityBus();
    const events: ActivityEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const session = new PraetorComputerSession({ screen, bus });
    const handle = session.startStreaming({ missionId: "m-1", intervalMs: 30, artifactId: "screen-x" });
    // Wait long enough for at least 2 frames at 30ms interval.
    await new Promise((r) => setTimeout(r, 100));
    handle.stop();
    await handle.done;
    const frames = events.filter((e) => e.kind === "artifact.partial");
    expect(frames.length).toBeGreaterThanOrEqual(1);
    if (frames[0].kind === "artifact.partial") {
      expect(frames[0].artifactId).toBe("screen-x");
      expect(frames[0].format).toBe("image");
      expect(frames[0].chunk.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  it("rejects streaming without a bus or missionId", () => {
    const { screen } = makeFakeScreen();
    const session = new PraetorComputerSession({ screen });
    expect(() => session.startStreaming({ missionId: "m-1" })).toThrow(/cannot stream without `bus`/);
    const bus = new InMemoryActivityBus();
    const sessionWithBus = new PraetorComputerSession({ screen, bus });
    expect(() => sessionWithBus.startStreaming({})).toThrow(/missionId required/);
  });
});

describe("registerComputerTools", () => {
  it("registers screenshot tool by default; omits input tools when no adapter", () => {
    const reg = new ToolRegistry();
    const { screen } = makeFakeScreen();
    registerComputerTools(reg, { screen });
    expect(reg.has("computer_screenshot")).toBe(true);
    expect(reg.has("computer_click")).toBe(false);
    expect(reg.has("computer_type")).toBe(false);
  });

  it("registers all input tools when an adapter is supplied", () => {
    const reg = new ToolRegistry();
    const { screen } = makeFakeScreen();
    registerComputerTools(reg, { screen, input: noopInputAdapter });
    expect(reg.has("computer_click")).toBe(true);
    expect(reg.has("computer_type")).toBe(true);
    expect(reg.has("computer_scroll")).toBe(true);
    expect(reg.has("computer_hotkey")).toBe(true);
  });

  it("input tools route through the adapter when called via the registry", async () => {
    const calls: string[] = [];
    const adapter: ComputerInputAdapter = {
      click: async () => { calls.push("click"); },
      type: async () => { calls.push("type"); },
      scroll: async () => { calls.push("scroll"); },
      hotkey: async () => { calls.push("hotkey"); },
    };
    const reg = new ToolRegistry();
    const { screen } = makeFakeScreen();
    registerComputerTools(reg, { screen, input: adapter });
    await reg.call("computer_click", { x: 10, y: 20 }, { role: "native" });
    await reg.call("computer_type", { text: "hi" }, { role: "native" });
    expect(calls).toEqual(["click", "type"]);
  });
});
