import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "@praetor/tools";
import { registerFileTools } from "./tools/file_tools.js";
import { registerTestTools } from "./tools/test_tools.js";

const codingCtx = { role: "coding" };

describe("file tools — path containment", () => {
  let dir: string;
  let reg: ToolRegistry;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "coding-agent-"));
    writeFileSync(join(dir, "hello.txt"), "hi", "utf8");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "x.ts"), "export const x = 1;\n", "utf8");
    reg = new ToolRegistry();
    registerFileTools(reg, { repoRoot: dir });
  });

  it("read_file returns the content of an in-root file", async () => {
    const r = await reg.call<{ content: string }>("read_file", { path: "hello.txt" }, codingCtx);
    expect(r.content).toBe("hi");
  });

  it("read_file rejects paths that escape the repo root", async () => {
    await expect(reg.call("read_file", { path: "../etc/passwd" }, codingCtx)).rejects.toThrow(/outside the repo root/);
  });

  it("write_file creates parent directories", async () => {
    await reg.call("write_file", { path: "deep/nested/file.txt", content: "ok" }, codingCtx);
    expect(readFileSync(join(dir, "deep", "nested", "file.txt"), "utf8")).toBe("ok");
  });

  it("edit_file replaces every literal occurrence", async () => {
    writeFileSync(join(dir, "n.txt"), "foo bar foo", "utf8");
    const r = await reg.call<{ replacements: number }>("edit_file", { path: "n.txt", find: "foo", replace: "qux" }, codingCtx);
    expect(r.replacements).toBe(2);
    expect(readFileSync(join(dir, "n.txt"), "utf8")).toBe("qux bar qux");
  });

  it("grep_codebase finds matches across files", async () => {
    const r = await reg.call<{ matches: { path: string; line: number; text: string }[] }>("grep_codebase", { pattern: "export const" }, codingCtx);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.some((m) => m.path.endsWith("x.ts"))).toBe(true);
  });

  it("list_files reports root entries", async () => {
    const r = await reg.call<{ entries: string[] }>("list_files", {}, codingCtx);
    expect(r.entries).toContain("hello.txt");
    expect(r.entries).toContain("sub/");
  });
});

describe("test tools — run_command timeout", () => {
  let dir: string;
  let reg: ToolRegistry;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "coding-agent-exec-"));
    reg = new ToolRegistry();
    registerTestTools(reg, { repoRoot: dir, timeoutMs: 2000 });
  });

  it("run_command times out and reports timedOut=true", async () => {
    // Use node instead of `sleep` so the test is cross-platform (sleep doesn't exist on Windows).
    const r = await reg.call<{ timedOut: boolean }>("run_command", {
      command: "node",
      args: ["-e", "setTimeout(() => {}, 5000)"],
    }, codingCtx);
    expect(r.timedOut).toBe(true);
  });

  it("run_command captures stdout for a quick command", async () => {
    const r = await reg.call<{ stdout: string; exitCode: number }>("run_command", { command: "node", args: ["-e", "process.stdout.write('ok')"] }, codingCtx);
    expect(r.stdout).toContain("ok");
    expect(r.exitCode).toBe(0);
  });

  it("run_tests reports a clear message when no framework is detected", async () => {
    const r = await reg.call<{ exitCode: number; stderr: string; command: string }>("run_tests", {}, codingCtx);
    expect(r.command).toContain("none detected");
    expect(r.stderr).toContain("no test framework detected");
  });
});

describe("file tools — write/read/edit cycle through registry", () => {
  it("supports an end-to-end edit-then-verify cycle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coding-cycle-"));
    const reg = new ToolRegistry();
    registerFileTools(reg, { repoRoot: dir });
    await reg.call("write_file", { path: "src/lib.ts", content: "export const greet = (n: string) => `hi ${n}`;\n" }, codingCtx);
    expect(existsSync(join(dir, "src", "lib.ts"))).toBe(true);
    const before = await reg.call<{ content: string }>("read_file", { path: "src/lib.ts" }, codingCtx);
    expect(before.content).toContain("hi");
    await reg.call("edit_file", { path: "src/lib.ts", find: "hi", replace: "hello" }, codingCtx);
    const after = await reg.call<{ content: string }>("read_file", { path: "src/lib.ts" }, codingCtx);
    expect(after.content).toContain("hello");
    expect(after.content).not.toContain("hi ");
  });
});
