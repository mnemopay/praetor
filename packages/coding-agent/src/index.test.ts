import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "@kpanks/tools";
import { InMemoryActivityBus, type ActivityEvent } from "@kpanks/core";
import { registerFileTools } from "./tools/file_tools.js";
import { registerTestTools } from "./tools/test_tools.js";
import { registerRepoMapTools, extractSymbols } from "./tools/repo_map.js";
import { registerConventionsTool } from "./tools/conventions.js";
import { createActivityToolContext } from "./activity_context.js";
import { createPatch } from "diff";

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

  it("edit_file applies a unified diff patch", async () => {
    writeFileSync(join(dir, "n.txt"), "foo bar foo\n", "utf8");
    const patch = createPatch("n.txt", "foo bar foo\n", "qux bar qux\n");
    const r = await reg.call<{ success: boolean; rollbackId: string }>("edit_file", { path: "n.txt", patch }, codingCtx);
    expect(r.success).toBe(true);
    expect(readFileSync(join(dir, "n.txt"), "utf8")).toBe("qux bar qux\n");
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
    const patch = createPatch("src/lib.ts", "export const greet = (n: string) => `hi ${n}`;\n", "export const greet = (n: string) => `hello ${n}`;\n");
    await reg.call("edit_file", { path: "src/lib.ts", patch }, codingCtx);
    const after = await reg.call<{ content: string }>("read_file", { path: "src/lib.ts" }, codingCtx);
    expect(after.content).toContain("hello");
    expect(after.content).not.toContain("hi ");
  });
});

describe("apply_edit — drift-tolerant string replace", () => {
  let dir: string;
  let reg: ToolRegistry;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apply-edit-"));
    reg = new ToolRegistry();
    registerFileTools(reg, { repoRoot: dir });
  });

  it("replaces a unique oldString and creates a rollback bundle", async () => {
    writeFileSync(join(dir, "f.ts"), "export const x = 1;\nexport const y = 2;\n", "utf8");
    const r = await reg.call<{ replaced: number; rollbackId: string }>(
      "apply_edit",
      { path: "f.ts", oldString: "export const x = 1;", newString: "export const x = 99;" },
      codingCtx,
    );
    expect(r.replaced).toBe(1);
    expect(readFileSync(join(dir, "f.ts"), "utf8")).toBe("export const x = 99;\nexport const y = 2;\n");
    const rollback = readFileSync(join(dir, ".praetor", "rollbacks", `${r.rollbackId}.orig`), "utf8");
    expect(rollback).toBe("export const x = 1;\nexport const y = 2;\n");
  });

  it("fails with a useful message when oldString is not unique and expectedOccurrences is 1", async () => {
    writeFileSync(join(dir, "f.ts"), "foo\nfoo\nfoo\n", "utf8");
    await expect(
      reg.call("apply_edit", { path: "f.ts", oldString: "foo", newString: "bar" }, codingCtx),
    ).rejects.toThrow(/found 3 occurrences.*expected 1/);
  });

  it("replaces all when expectedOccurrences matches the actual count", async () => {
    writeFileSync(join(dir, "f.ts"), "foo\nfoo\nfoo\n", "utf8");
    const r = await reg.call<{ replaced: number }>(
      "apply_edit",
      { path: "f.ts", oldString: "foo", newString: "bar", expectedOccurrences: 3 },
      codingCtx,
    );
    expect(r.replaced).toBe(3);
    expect(readFileSync(join(dir, "f.ts"), "utf8")).toBe("bar\nbar\nbar\n");
  });

  it("rejects empty oldString and noop edits", async () => {
    writeFileSync(join(dir, "f.ts"), "x\n", "utf8");
    await expect(reg.call("apply_edit", { path: "f.ts", oldString: "", newString: "y" }, codingCtx)).rejects.toThrow(/non-empty/);
    await expect(reg.call("apply_edit", { path: "f.ts", oldString: "x", newString: "x" }, codingCtx)).rejects.toThrow(/nothing to do/);
  });

  it("rejects oldString that does not exist", async () => {
    writeFileSync(join(dir, "f.ts"), "x\n", "utf8");
    await expect(
      reg.call("apply_edit", { path: "f.ts", oldString: "missing", newString: "y" }, codingCtx),
    ).rejects.toThrow(/not found/);
  });
});

describe("repo_map + find_symbol", () => {
  let dir: string;
  let reg: ToolRegistry;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repo-map-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src", "a.ts"),
      "export function alpha() {}\nexport class Beta {}\nexport interface IGamma { x: number }\nexport type Delta = string;\nexport const epsilon = 1;\n",
      "utf8",
    );
    writeFileSync(join(dir, "src", "b.py"), "def zeta():\n    pass\nclass Eta:\n    pass\n", "utf8");
    reg = new ToolRegistry();
    registerRepoMapTools(reg, { repoRoot: dir });
  });

  it("repo_map enumerates files with their top-level symbols", async () => {
    const r = await reg.call<{ files: { path: string; lang: string; symbols: { name: string; kind: string }[] }[]; total: number }>("repo_map", {}, codingCtx);
    const a = r.files.find((f) => f.path === "src/a.ts");
    expect(a?.lang).toBe("typescript");
    const names = a?.symbols.map((s) => s.name).sort();
    expect(names).toEqual(["Beta", "Delta", "IGamma", "alpha", "epsilon"]);
    const b = r.files.find((f) => f.path === "src/b.py");
    expect(b?.symbols.map((s) => s.name).sort()).toEqual(["Eta", "zeta"]);
  });

  it("find_symbol returns matching declarations across files", async () => {
    const r = await reg.call<{ matches: { path: string; line: number; kind: string; name: string }[] }>(
      "find_symbol",
      { name: "alpha" },
      codingCtx,
    );
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].path).toBe("src/a.ts");
    expect(r.matches[0].kind).toBe("function");
  });

  it("extractSymbols handles plain TS without `export`", () => {
    const syms = extractSymbols("function foo() {}\nclass Bar {}\n", "typescript");
    expect(syms.map((s) => s.name).sort()).toEqual(["Bar", "foo"]);
  });
});

describe("load_conventions", () => {
  it("returns the first matching convention file with the path as a header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conventions-"));
    writeFileSync(join(dir, "CLAUDE.md"), "Read every file fully before editing.\n", "utf8");
    writeFileSync(join(dir, "AGENTS.md"), "Use apply_edit, not edit_file.\n", "utf8");
    const reg = new ToolRegistry();
    registerConventionsTool(reg, { repoRoot: dir });
    const r = await reg.call<{ sections: { path: string; text: string }[]; missing: string[] }>(
      "load_conventions",
      {},
      codingCtx,
    );
    expect(r.sections.map((s) => s.path).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    const claude = r.sections.find((s) => s.path === "CLAUDE.md");
    expect(claude?.text).toContain("Read every file fully");
  });

  it("reports missing files instead of throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conventions-empty-"));
    const reg = new ToolRegistry();
    registerConventionsTool(reg, { repoRoot: dir });
    const r = await reg.call<{ sections: unknown[]; missing: string[] }>("load_conventions", {}, codingCtx);
    expect(r.sections).toEqual([]);
    expect(r.missing.length).toBeGreaterThan(0);
  });
});

describe("expanded run_command allowlist", () => {
  it("accepts python and bun by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "allowlist-"));
    const reg = new ToolRegistry();
    registerTestTools(reg, { repoRoot: dir, timeoutMs: 2000 });
    // We don't actually need python/bun installed — the allowlist check happens
    // before spawn. The ENOENT from spawn turns into exitCode -1, NOT a thrown
    // "blocked by Praetor security policies" error. So success here means the
    // command name was accepted; the spawn outcome is incidental.
    const r = await reg.call<{ exitCode: number; stderr: string }>(
      "run_command",
      { command: "python", args: ["--version"] },
      codingCtx,
    );
    expect(r.stderr.toLowerCase()).not.toContain("blocked by praetor");
  });

  it("still rejects commands outside the allowlist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "allowlist-deny-"));
    const reg = new ToolRegistry();
    registerTestTools(reg, { repoRoot: dir, timeoutMs: 2000 });
    await expect(
      reg.call("run_command", { command: "rm", args: ["-rf", "/"] }, codingCtx),
    ).rejects.toThrow(/blocked by Praetor security policies/);
  });

  it("extraAllow appends to the default allowlist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "allowlist-extra-"));
    const reg = new ToolRegistry();
    registerTestTools(reg, { repoRoot: dir, timeoutMs: 2000, extraAllow: ["myCustomTool"] });
    const r = await reg.call<{ stderr: string }>(
      "run_command",
      { command: "myCustomTool", args: [] },
      codingCtx,
    );
    expect(r.stderr.toLowerCase()).not.toContain("blocked by praetor");
  });
});

describe("createActivityToolContext bridges audit → activity bus", () => {
  it("emits tool.start + tool.end events with stitched eventIds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "activity-"));
    writeFileSync(join(dir, "a.txt"), "hi", "utf8");
    const reg = new ToolRegistry();
    registerFileTools(reg, { repoRoot: dir });

    const events: ActivityEvent[] = [];
    const bus = new InMemoryActivityBus();
    bus.subscribe((e) => events.push(e));

    const ctx = createActivityToolContext({ missionId: "m-1", bus, wrap: { role: "coding" } });
    await reg.call("read_file", { path: "a.txt" }, ctx);

    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("tool.start");
    expect(events[1].kind).toBe("tool.end");
    if (events[0].kind === "tool.start" && events[1].kind === "tool.end") {
      expect(events[0].toolName).toBe("read_file");
      expect(events[0].missionId).toBe("m-1");
      expect(events[0].eventId).toBe(events[1].eventId);
      expect(events[1].ok).toBe(true);
    }
  });

  it("emits tool.end with ok=false when the tool throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "activity-err-"));
    const reg = new ToolRegistry();
    registerFileTools(reg, { repoRoot: dir });

    const events: ActivityEvent[] = [];
    const bus = new InMemoryActivityBus();
    bus.subscribe((e) => events.push(e));

    const ctx = createActivityToolContext({ missionId: "m-2", bus, wrap: { role: "coding" } });
    await expect(reg.call("read_file", { path: "missing.txt" }, ctx)).rejects.toThrow();

    expect(events).toHaveLength(2);
    if (events[1].kind === "tool.end") {
      expect(events[1].ok).toBe(false);
    }
  });
});
