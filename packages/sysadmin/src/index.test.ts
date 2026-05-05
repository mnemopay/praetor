import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SysadminModule } from "./index.js";

// Minimal Sandbox shape that matches the structural type used by SysadminModule.
function fakeSandbox(impl: Partial<{
  exec: (cmd: string, opts?: any) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}>) {
  return {
    exec: vi.fn(impl.exec ?? (async () => ({ stdout: "", stderr: "", exitCode: 0 }))),
    readFile: vi.fn(impl.readFile ?? (async () => "")),
    writeFile: vi.fn(impl.writeFile ?? (async () => {})),
  } as any;
}

describe("SysadminModule (sandbox path)", () => {
  it("runCommand routes through sandbox.exec when sandbox provided", async () => {
    const sandbox = fakeSandbox({
      exec: async () => ({ stdout: "hello", stderr: "", exitCode: 0 }),
    });
    const sys = new SysadminModule(sandbox);
    const r = await sys.runCommand("echo hello", "/tmp");
    expect(r.stdout).toBe("hello");
    expect(r.exitCode).toBe(0);
    expect(sandbox.exec).toHaveBeenCalledWith("echo hello", { cwd: "/tmp" });
  });

  it("readFile routes through sandbox.readFile when sandbox provided", async () => {
    const sandbox = fakeSandbox({
      readFile: async (p) => `content of ${p}`,
    });
    const sys = new SysadminModule(sandbox);
    const r = await sys.readFile("/x");
    expect(r.content).toBe("content of /x");
    expect(r.error).toBeUndefined();
    expect(sandbox.readFile).toHaveBeenCalledWith("/x");
  });

  it("readFile surfaces errors as { error } not throws", async () => {
    const sandbox = fakeSandbox({
      readFile: async () => {
        throw new Error("denied");
      },
    });
    const sys = new SysadminModule(sandbox);
    const r = await sys.readFile("/secret");
    expect(r.content).toBe("");
    expect(r.error).toBe("denied");
  });

  it("writeFile routes through sandbox.writeFile and reports success", async () => {
    const sandbox = fakeSandbox({});
    const sys = new SysadminModule(sandbox);
    const r = await sys.writeFile("/x", "data");
    expect(r.success).toBe(true);
    expect(sandbox.writeFile).toHaveBeenCalledWith("/x", "data");
  });

  it("writeFile surfaces errors as { success:false, error } not throws", async () => {
    const sandbox = fakeSandbox({
      writeFile: async () => {
        throw new Error("read-only fs");
      },
    });
    const sys = new SysadminModule(sandbox);
    const r = await sys.writeFile("/x", "data");
    expect(r.success).toBe(false);
    expect(r.error).toBe("read-only fs");
  });

  it("listDir parses ls -lA output through the sandbox", async () => {
    const lsOut = [
      "total 4",
      "drwxr-xr-x 2 user user 4096 Jan 1 00:00 docs",
      "-rw-r--r-- 1 user user  120 Jan 1 00:00 readme.md",
    ].join("\n");
    const sandbox = fakeSandbox({
      exec: async () => ({ stdout: lsOut, stderr: "", exitCode: 0 }),
    });
    const sys = new SysadminModule(sandbox);
    const r = await sys.listDir("/proj");
    expect(r.error).toBeUndefined();
    expect(r.items).toEqual([
      { name: "docs", isDir: true },
      { name: "readme.md", isDir: false },
    ]);
  });

  it("listDir surfaces non-zero exit as error", async () => {
    const sandbox = fakeSandbox({
      exec: async () => ({ stdout: "", stderr: "no such directory", exitCode: 2 }),
    });
    const sys = new SysadminModule(sandbox);
    const r = await sys.listDir("/missing");
    expect(r.items).toEqual([]);
    expect(r.error).toContain("no such directory");
  });
});

describe("SysadminModule (local-native fallback)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "praetor-sysadmin-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("readFile falls back to fs/promises and reads real content", async () => {
    const path = join(tmp, "hello.txt");
    writeFileSync(path, "from disk");
    const sys = new SysadminModule();
    const r = await sys.readFile(path);
    expect(r.content).toBe("from disk");
    expect(r.error).toBeUndefined();
  });

  it("readFile returns error for missing file (no throw)", async () => {
    const sys = new SysadminModule();
    const r = await sys.readFile(join(tmp, "no-such-file.txt"));
    expect(r.content).toBe("");
    expect(r.error).toBeDefined();
  });

  it("writeFile + readFile round-trip with no sandbox", async () => {
    const sys = new SysadminModule();
    const path = join(tmp, "round.txt");
    const w = await sys.writeFile(path, "rt-data");
    expect(w.success).toBe(true);
    const r = await sys.readFile(path);
    expect(r.content).toBe("rt-data");
  });

  it("listDir lists names + isDir flag with no sandbox", async () => {
    writeFileSync(join(tmp, "a.txt"), "a");
    const sys = new SysadminModule();
    const r = await sys.listDir(tmp);
    expect(r.error).toBeUndefined();
    const names = r.items.map((i) => i.name).sort();
    expect(names).toContain("a.txt");
  });
});
