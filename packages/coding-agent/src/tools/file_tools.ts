import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ToolRegistry, type ToolDefinition } from "@praetor/tools";
import { applyUnifiedDiff } from "./unified_diff.js";

/**
 * File tools — read_file, write_file, edit_file, list_files, grep_codebase.
 * Every path is resolved against `repoRoot` and rejected if it escapes.
 *
 * Free-tier: these tools never call a paid API, so they are tagged
 * `["coding", "free"]` and gated by the `coding` role.
 */

export interface FileToolsOptions {
  repoRoot: string;
}

export function registerFileTools(reg: ToolRegistry, opts: FileToolsOptions): void {
  const root = resolve(opts.repoRoot);

  function safe(rel: string): string {
    if (typeof rel !== "string" || !rel) throw new Error("path required");
    const target = resolve(join(root, rel));
    if (target !== root && !target.startsWith(root + "/") && !target.startsWith(root + "\\")) {
      throw new Error(`path '${rel}' resolves outside the repo root`);
    }
    return target;
  }

  const tags = ["coding", "free"] as const;
  const allowedRoles = ["coding"] as const;

  reg.register<{ path: string }, { content: string; bytes: number; path: string }>(
    {
      name: "read_file",
      description: "Read a UTF-8 file, relative to the repo root.",
      schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "repo_file_read", risk: ["filesystem"], approval: "never", sandbox: "repo", production: "ready", costEffective: true },
    },
    async ({ path }) => {
      const abs = safe(path);
      const content = await fs.readFile(abs, "utf8");
      return { content, bytes: Buffer.byteLength(content, "utf8"), path: relative(root, abs) };
    },
  );

  reg.register<{ path: string; content: string }, { path: string; bytes: number }>(
    {
      name: "write_file",
      description: "Write a UTF-8 file, relative to the repo root. Creates parent directories.",
      schema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "repo_file_write", risk: ["filesystem"], approval: "on-side-effect", sandbox: "repo", production: "needs-live-test", costEffective: true },
    },
    async ({ path, content }) => {
      const abs = safe(path);
      await fs.mkdir(resolve(abs, ".."), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return { path: relative(root, abs), bytes: Buffer.byteLength(content, "utf8") };
    },
  );

  reg.register<{ path: string; patch: string }, { path: string; success: boolean; rollbackId: string; diffPreview: string }>(
    {
      name: "edit_file",
      description: "Apply a unified diff patch to a file. Original file is saved to `.praetor/rollbacks`.",
      schema: {
        type: "object",
        properties: { path: { type: "string" }, patch: { type: "string" } },
        required: ["path", "patch"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "repo_file_edit", risk: ["filesystem"], approval: "on-side-effect", sandbox: "repo", production: "ready", costEffective: true, note: "Patch-first editing with rollback bundle generation." },
    },
    async ({ path, patch }) => {
      const abs = safe(path);
      const before = await fs.readFile(abs, "utf8");

      const after = applyUnifiedDiff(before, patch);
      if (after === null) {
        throw new Error("Failed to apply patch. Check format or context lines. Prefer apply_edit (oldString/newString) when context may have drifted.");
      }

      // Rollback bundle
      const rollbackId = `rollback_${Date.now()}`;
      const rollbackPath = resolve(join(root, ".praetor", "rollbacks", `${rollbackId}.orig`));
      await fs.mkdir(resolve(rollbackPath, ".."), { recursive: true });
      await fs.writeFile(rollbackPath, before, "utf8");

      await fs.writeFile(abs, after, "utf8");

      return { path: relative(root, abs), success: true, rollbackId, diffPreview: patch };
    },
  );

  reg.register<
    { path: string; oldString: string; newString: string; expectedOccurrences?: number },
    { path: string; replaced: number; rollbackId: string }
  >(
    {
      name: "apply_edit",
      description:
        "Drift-tolerant edit: replace `oldString` with `newString` in the file. Fails if `oldString` is not found, or if it appears more times than `expectedOccurrences` (default 1). Original saved to .praetor/rollbacks. Prefer this over edit_file when context lines may have shifted.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldString: { type: "string" },
          newString: { type: "string" },
          expectedOccurrences: { type: "integer", description: "Required match count. Default 1; pass N to replace all when there are N." },
        },
        required: ["path", "oldString", "newString"],
      },
      tags, allowedRoles,
      metadata: {
        origin: "native",
        capability: "repo_file_apply_edit",
        risk: ["filesystem"],
        approval: "on-side-effect",
        sandbox: "repo",
        production: "ready",
        costEffective: true,
        note: "Praetor-native string-replace edit; drift-tolerant alternative to unified diff.",
      },
    },
    async ({ path, oldString, newString, expectedOccurrences }) => {
      if (oldString.length === 0) {
        throw new Error("apply_edit: oldString must be non-empty");
      }
      if (oldString === newString) {
        throw new Error("apply_edit: oldString equals newString — nothing to do");
      }
      const abs = safe(path);
      const before = await fs.readFile(abs, "utf8");

      const required = typeof expectedOccurrences === "number" ? expectedOccurrences : 1;
      const found = countOccurrences(before, oldString);
      if (found === 0) {
        throw new Error(`apply_edit: oldString not found in ${relative(root, abs)}`);
      }
      if (found !== required) {
        throw new Error(
          `apply_edit: found ${found} occurrences of oldString in ${relative(root, abs)}, expected ${required}. Pass expectedOccurrences=${found} to replace them all, or supply more context to make oldString unique.`,
        );
      }

      const after = before.split(oldString).join(newString);

      const rollbackId = `apply_edit_${Date.now()}`;
      const rollbackPath = resolve(join(root, ".praetor", "rollbacks", `${rollbackId}.orig`));
      await fs.mkdir(resolve(rollbackPath, ".."), { recursive: true });
      await fs.writeFile(rollbackPath, before, "utf8");

      await fs.writeFile(abs, after, "utf8");

      return { path: relative(root, abs), replaced: found, rollbackId };
    },
  );

  reg.register<{ dir?: string }, { entries: string[] }>(
    {
      name: "list_files",
      description: "List files (one level deep) in a directory inside the repo root.",
      schema: { type: "object", properties: { dir: { type: "string" } }, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "repo_file_list", risk: ["filesystem"], approval: "never", sandbox: "repo", production: "ready", costEffective: true },
    },
    async ({ dir }) => {
      const abs = dir ? safe(dir) : root;
      const entries = await fs.readdir(abs, { withFileTypes: true });
      return {
        entries: entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort(),
      };
    },
  );

  reg.register<{ pattern: string; dir?: string; maxResults?: number }, { matches: { path: string; line: number; text: string }[] }>(
    {
      name: "grep_codebase",
      description: "Search the repo for a regex. Returns at most maxResults matches (default 100).",
      schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          dir: { type: "string" },
          maxResults: { type: "integer" },
        },
        required: ["pattern"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "repo_code_search", risk: ["filesystem"], approval: "never", sandbox: "repo", production: "ready", costEffective: true },
    },
    async ({ pattern, dir, maxResults }) => {
      const abs = dir ? safe(dir) : root;
      const cap = typeof maxResults === "number" ? maxResults : 100;
      const re = new RegExp(pattern);
      const matches: { path: string; line: number; text: string }[] = [];
      await walk(abs, async (file) => {
        if (matches.length >= cap) return;
        // Skip obvious binary/large dirs.
        const rel = relative(root, file);
        if (rel.split("/").some((p) => p === "node_modules" || p === ".git" || p === "dist")) return;
        try {
          const txt = await fs.readFile(file, "utf8");
          const lines = txt.split(/\r?\n/);
          for (let i = 0; i < lines.length && matches.length < cap; i++) {
            if (re.test(lines[i])) {
              matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, 240) });
            }
          }
        } catch {
          // Binary or unreadable — ignore.
        }
      });
      return { matches };
    },
  );
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

async function walk(dir: string, fn: (path: string) => Promise<void>): Promise<void> {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      await walk(p, fn);
    } else if (e.isFile()) {
      await fn(p);
    }
  }
}



export const FILE_TOOL_NAMES: readonly string[] = [
  "read_file", "write_file", "edit_file", "apply_edit", "list_files", "grep_codebase",
] as const;

export type FileToolDef = ToolDefinition;
