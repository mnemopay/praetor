import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ToolRegistry, type ToolDefinition } from "@praetor/tools";

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
    },
    async ({ path, content }) => {
      const abs = safe(path);
      await fs.mkdir(resolve(abs, ".."), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return { path: relative(root, abs), bytes: Buffer.byteLength(content, "utf8") };
    },
  );

  reg.register<{ path: string; find: string; replace: string }, { path: string; replacements: number }>(
    {
      name: "edit_file",
      description: "Replace every literal occurrence of `find` with `replace` in `path`.",
      schema: {
        type: "object",
        properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" } },
        required: ["path", "find", "replace"],
      },
      tags, allowedRoles,
    },
    async ({ path, find, replace }) => {
      const abs = safe(path);
      const before = await fs.readFile(abs, "utf8");
      const after = before.split(find).join(replace);
      const replacements = before.length === after.length && before === after
        ? 0
        : (before.length - after.length) / Math.max(1, find.length - replace.length || 1);
      // Count occurrences accurately:
      const occ = countOccurrences(before, find);
      await fs.writeFile(abs, after, "utf8");
      return { path: relative(root, abs), replacements: occ };
    },
  );

  reg.register<{ dir?: string }, { entries: string[] }>(
    {
      name: "list_files",
      description: "List files (one level deep) in a directory inside the repo root.",
      schema: { type: "object", properties: { dir: { type: "string" } }, required: [] },
      tags, allowedRoles,
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

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

export const FILE_TOOL_NAMES: readonly string[] = [
  "read_file", "write_file", "edit_file", "list_files", "grep_codebase",
] as const;

export type FileToolDef = ToolDefinition;
