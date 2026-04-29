import { describe, it, expect } from "vitest";
import { MockSandbox, MockSandboxFactory, SandboxDispatcher, E2bSandboxFactory, type E2bClient } from "./index.js";

describe("MockSandbox", () => {
  it("exec returns deterministic output", async () => {
    const s = new MockSandbox("test");
    const r = await s.exec("echo hi");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("echo hi");
  });
  it("write+read round-trip", async () => {
    const s = new MockSandbox();
    await s.writeFile("/x", "hello");
    expect(await s.readFile("/x")).toBe("hello");
    await expect(s.readFile("/missing")).rejects.toThrow(/not found/);
  });
});

describe("SandboxDispatcher", () => {
  it("returns mock sandbox by default", async () => {
    const d = new SandboxDispatcher({ mock: new MockSandboxFactory() });
    const s = await d.create("mock");
    expect(s.id).toMatch(/^mock-/);
  });

  it("throws for e2b without factory", async () => {
    const d = new SandboxDispatcher({});
    await expect(d.create("e2b")).rejects.toThrow(/no E2bSandboxFactory/);
  });

  it("uses e2b factory when configured", async () => {
    const fakeClient: E2bClient = {
      async spawn() { return "e2b-fake-id"; },
      async exec() { return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 5 }; },
      async writeFile() { /* */ },
      async readFile() { return "stub"; },
      async kill() { /* */ },
    };
    const d = new SandboxDispatcher({ e2b: new E2bSandboxFactory(fakeClient) });
    const s = await d.create("e2b");
    expect(s.id).toBe("e2b-fake-id");
    const out = await s.exec("ls");
    expect(out.stdout).toBe("ok");
    await s.close();
  });
});
