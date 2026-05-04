import { describe, it, expect } from "vitest";
import {
  MockSandbox,
  MockSandboxFactory,
  SandboxDispatcher,
  E2bSandboxFactory,
  LocalSandboxFactory,
  DockerSandboxFactory,
  type E2bClient,
} from "./index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("dispatches kind=local to LocalSandboxFactory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "praetor-disp-local-"));
    const d = new SandboxDispatcher({ local: new LocalSandboxFactory({ cwd: dir }) });
    const s = await d.create("local");
    expect(s.id.startsWith("local-")).toBe(true);
  });

  it("throws for kind=local without a configured factory", async () => {
    const d = new SandboxDispatcher({});
    await expect(d.create("local")).rejects.toThrow(/no LocalSandboxFactory/);
  });

  it("throws for kind=docker without a configured factory", async () => {
    const d = new SandboxDispatcher({});
    await expect(d.create("docker")).rejects.toThrow(/no DockerSandboxFactory/);
  });

  it("auto picks docker when DockerSandboxFactory.isAvailable() is true", async () => {
    const fakeSpawn: NonNullable<ConstructorParameters<typeof DockerSandboxFactory>[0]>["__spawn"] = async (args) => {
      if (args[0] === "run") return { exitCode: 0, stdout: "fake-cid\n", stderr: "" };
      if (args[0] === "exec") return { exitCode: 0, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const docker = new DockerSandboxFactory({ __spawn: fakeSpawn });
    const d = new SandboxDispatcher({
      mock: new MockSandboxFactory(),
      docker,
      isDockerAvailable: async () => true,
    });
    const s = await d.create("auto");
    expect(s.id.startsWith("fake-cid")).toBe(true);
  });

  it("auto falls back to mock when docker is unavailable", async () => {
    const d = new SandboxDispatcher({
      mock: new MockSandboxFactory(),
      isDockerAvailable: async () => false,
    });
    const s = await d.create("auto");
    expect(s.id.startsWith("mock-")).toBe(true);
  });

  it("rejects unknown kind values", async () => {
    const d = new SandboxDispatcher({});
    await expect(d.create("zzz" as unknown as "mock")).rejects.toThrow(/unknown kind/);
  });
});
