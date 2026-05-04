import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSandbox, LocalSandboxFactory } from "./local.js";

describe("LocalSandbox", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "praetor-local-sandbox-"));
  });

  it("exec runs a command and captures stdout/exitCode", async () => {
    const sb = new LocalSandbox({ cwd: dir });
    const r = await sb.exec(process.platform === "win32" ? "echo hello" : "echo hello");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello");
    expect(typeof r.durationMs).toBe("number");
  });

  it("exec timeout kills the child and surfaces a timeout marker", async () => {
    const sb = new LocalSandbox({ cwd: dir, defaultTimeoutMs: 200 });
    // node -e '...' runs cross-platform. Sleep for 5s; we time out at 200ms.
    const r = await sb.exec(`node -e "setTimeout(() => {}, 5000)"`, { timeoutMs: 200 });
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/timed out/);
  });

  it("writeFile + readFile round-trips bytes inside cwd", async () => {
    const sb = new LocalSandbox({ cwd: dir });
    await sb.writeFile("nested/foo.txt", "praetor smoke");
    expect(existsSync(join(dir, "nested", "foo.txt"))).toBe(true);
    expect(readFileSync(join(dir, "nested", "foo.txt"), "utf8")).toBe("praetor smoke");
    const r = await sb.readFile("nested/foo.txt");
    expect(r).toBe("praetor smoke");
  });

  it("rejects paths that escape cwd by default", async () => {
    const sb = new LocalSandbox({ cwd: dir });
    await expect(sb.readFile("../../../etc/passwd")).rejects.toThrow(/outside cwd/);
  });

  it("allowEscape: true permits arbitrary paths (use carefully)", async () => {
    const sb = new LocalSandbox({ cwd: dir, allowEscape: true });
    // Read a file we just put on the host (not under cwd).
    const escapeDir = mkdtempSync(join(tmpdir(), "praetor-escape-"));
    const escapePath = join(escapeDir, "x.txt");
    await sb.writeFile(escapePath, "ok");
    const text = await sb.readFile(escapePath);
    expect(text).toBe("ok");
  });

  it("close() is idempotent and a no-op", async () => {
    const sb = new LocalSandbox({ cwd: dir });
    await sb.close();
    await sb.close();
  });

  it("LocalSandboxFactory.create returns a LocalSandbox bound to cwd", async () => {
    const factory = new LocalSandboxFactory({ cwd: dir });
    const sb = await factory.create();
    expect(sb).toBeInstanceOf(LocalSandbox);
    await sb.writeFile("from-factory.txt", "ok");
    expect(readFileSync(join(dir, "from-factory.txt"), "utf8")).toBe("ok");
  });
});
