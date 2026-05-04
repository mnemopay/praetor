/**
 * Repo-map + symbol search tools — Praetor's answer to Aider's repo_map and
 * Cursor/Claude Code's "find symbol" / "go to definition" surfaces.
 *
 * `repo_map` walks the repo and emits a token-efficient outline:
 *   <path> (<lang>)
 *     - <kind> <name>          — for top-level symbols (export function/class/etc)
 *
 * `find_symbol` returns every file:line where a top-level symbol with the
 * requested name is declared. Same regex pass as repo_map, scoped by name.
 *
 * Native: no tree-sitter, no LSP, no third-party parser. A small set of
 * per-language regexes is enough for "where is X declared" — which is what
 * the LLM actually needs for context. When this proves insufficient, swap
 * in tree-sitter (which itself is a native primitive).
 */

import { promises as fs } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { ToolRegistry } from "@praetor/tools";

export interface RepoMapToolsOptions {
  repoRoot: string;
  /** Defaults to a curated set; override to add/remove. */
  exts?: readonly string[];
  /** Directories to skip in addition to the always-skipped node_modules / .git / dist / build. */
  extraSkip?: readonly string[];
  /** Hard cap on files surveyed in one repo_map call. */
  maxFiles?: number;
}

export type SymbolKind = "function" | "class" | "interface" | "type" | "const" | "enum";

export interface Symbol {
  name: string;
  kind: SymbolKind;
  line: number;
}

const DEFAULT_EXTS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"];
const ALWAYS_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache", "coverage", ".praetor"]);

export function registerRepoMapTools(reg: ToolRegistry, opts: RepoMapToolsOptions): void {
  const root = resolve(opts.repoRoot);
  const exts = new Set(opts.exts ?? DEFAULT_EXTS);
  const extraSkip = new Set(opts.extraSkip ?? []);
  const maxFiles = opts.maxFiles ?? 800;

  const tags = ["coding", "free", "context"] as const;
  const allowedRoles = ["coding"] as const;

  reg.register<{ dir?: string; pattern?: string; maxFiles?: number }, { files: { path: string; lang: string; symbols: Symbol[] }[]; truncated: boolean; total: number }>(
    {
      name: "repo_map",
      description:
        "Token-efficient outline of the repo: each file paired with its top-level exported symbols. Cheap to call before reading specific files.",
      schema: {
        type: "object",
        properties: {
          dir: { type: "string", description: "Subdirectory to scope the map to (relative to repo root)." },
          pattern: { type: "string", description: "Optional regex; only files whose path matches are included." },
          maxFiles: { type: "integer", description: "Override the default file cap." },
        },
        required: [],
      },
      tags, allowedRoles,
      metadata: {
        origin: "native",
        capability: "repo_outline",
        risk: ["filesystem"],
        approval: "never",
        sandbox: "repo",
        production: "ready",
        costEffective: true,
        note: "Praetor-native repo outline — regex symbol extraction, no parser dependency.",
      },
    },
    async ({ dir, pattern, maxFiles: localMax }) => {
      const cap = typeof localMax === "number" ? localMax : maxFiles;
      const start = dir ? safe(root, dir) : root;
      const re = pattern ? new RegExp(pattern) : null;
      const files: { path: string; lang: string; symbols: Symbol[] }[] = [];
      let total = 0;
      let truncated = false;
      await walk(start, root, extraSkip, async (file) => {
        total += 1;
        if (files.length >= cap) {
          truncated = true;
          return;
        }
        if (!exts.has(extname(file).toLowerCase())) return;
        const rel = relative(root, file).split("\\").join("/");
        if (re && !re.test(rel)) return;
        try {
          const text = await fs.readFile(file, "utf8");
          const lang = langForExt(extname(file));
          const symbols = extractSymbols(text, lang);
          files.push({ path: rel, lang, symbols });
        } catch {
          // unreadable -> skip
        }
      });
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { files, truncated, total };
    },
  );

  reg.register<{ name: string; kind?: SymbolKind; dir?: string }, { matches: { path: string; line: number; kind: SymbolKind; name: string }[] }>(
    {
      name: "find_symbol",
      description:
        "Find every file:line where a top-level symbol named `name` is declared. Optional `kind` narrows to function/class/interface/type/const/enum.",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["function", "class", "interface", "type", "const", "enum"] },
          dir: { type: "string" },
        },
        required: ["name"],
      },
      tags, allowedRoles,
      metadata: {
        origin: "native",
        capability: "symbol_search",
        risk: ["filesystem"],
        approval: "never",
        sandbox: "repo",
        production: "ready",
        costEffective: true,
      },
    },
    async ({ name, kind, dir }) => {
      const start = dir ? safe(root, dir) : root;
      const matches: { path: string; line: number; kind: SymbolKind; name: string }[] = [];
      await walk(start, root, extraSkip, async (file) => {
        if (!exts.has(extname(file).toLowerCase())) return;
        try {
          const text = await fs.readFile(file, "utf8");
          const lang = langForExt(extname(file));
          for (const sym of extractSymbols(text, lang)) {
            if (sym.name !== name) continue;
            if (kind && sym.kind !== kind) continue;
            matches.push({
              path: relative(root, file).split("\\").join("/"),
              line: sym.line,
              kind: sym.kind,
              name: sym.name,
            });
          }
        } catch { /* skip */ }
      });
      return { matches };
    },
  );
}

function safe(root: string, rel: string): string {
  const target = resolve(join(root, rel));
  if (target !== root && !target.startsWith(root + "/") && !target.startsWith(root + "\\")) {
    throw new Error(`path '${rel}' resolves outside the repo root`);
  }
  return target;
}

async function walk(
  dir: string,
  root: string,
  extraSkip: Set<string>,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (ALWAYS_SKIP.has(e.name) || extraSkip.has(e.name)) continue;
      await walk(join(dir, e.name), root, extraSkip, fn);
    } else if (e.isFile()) {
      await fn(join(dir, e.name));
    }
  }
}

function langForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".ts" || e === ".tsx" || e === ".mts" || e === ".cts") return "typescript";
  if (e === ".js" || e === ".jsx" || e === ".mjs" || e === ".cjs") return "javascript";
  if (e === ".py") return "python";
  if (e === ".go") return "go";
  if (e === ".rs") return "rust";
  return "unknown";
}

/**
 * Extract top-level declarations. Multi-language: every regex anchors at the
 * line start (with optional `export ` for TS/JS) and captures the name. Lines
 * inside string literals will produce noise; this is a context primitive, not
 * a compiler — the LLM tolerates a small false-positive rate.
 */
export function extractSymbols(source: string, lang: string): Symbol[] {
  const out: Symbol[] = [];
  const lines = source.split(/\r?\n/);
  if (lang === "typescript" || lang === "javascript") {
    const patterns: { re: RegExp; kind: SymbolKind }[] = [
      { re: /^\s*export\s+(?:async\s+)?function\s+(\w+)/, kind: "function" },
      { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function" },
      { re: /^\s*export\s+default\s+function\s+(\w+)/, kind: "function" },
      { re: /^\s*export\s+(?:abstract\s+)?class\s+(\w+)/, kind: "class" },
      { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: "class" },
      { re: /^\s*export\s+interface\s+(\w+)/, kind: "interface" },
      { re: /^\s*(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
      { re: /^\s*export\s+type\s+(\w+)/, kind: "type" },
      { re: /^\s*(?:export\s+)?type\s+(\w+)\s*=/, kind: "type" },
      { re: /^\s*export\s+enum\s+(\w+)/, kind: "enum" },
      { re: /^\s*(?:export\s+)?enum\s+(\w+)/, kind: "enum" },
      { re: /^\s*export\s+(?:const|let|var)\s+(\w+)/, kind: "const" },
    ];
    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        const m = p.re.exec(lines[i]);
        if (m) {
          out.push({ name: m[1], kind: p.kind, line: i + 1 });
          break; // one symbol per line is enough
        }
      }
    }
  } else if (lang === "python") {
    for (let i = 0; i < lines.length; i++) {
      let m = /^def\s+(\w+)\s*\(/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: "function", line: i + 1 });
      m = /^class\s+(\w+)\s*[(:]/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: "class", line: i + 1 });
    }
  } else if (lang === "go") {
    for (let i = 0; i < lines.length; i++) {
      let m = /^func\s+(?:\(.*?\)\s+)?(\w+)\s*\(/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: "function", line: i + 1 });
      m = /^type\s+(\w+)\s+(?:struct|interface)\b/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: m[0].includes("interface") ? "interface" : "type", line: i + 1 });
    }
  } else if (lang === "rust") {
    for (let i = 0; i < lines.length; i++) {
      let m = /^\s*(?:pub\s+)?fn\s+(\w+)/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: "function", line: i + 1 });
      m = /^\s*(?:pub\s+)?struct\s+(\w+)/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: "type", line: i + 1 });
      m = /^\s*(?:pub\s+)?trait\s+(\w+)/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: "interface", line: i + 1 });
      m = /^\s*(?:pub\s+)?enum\s+(\w+)/.exec(lines[i]);
      if (m) out.push({ name: m[1], kind: "enum", line: i + 1 });
    }
  }
  return out;
}

export const REPO_MAP_TOOL_NAMES: readonly string[] = ["repo_map", "find_symbol"] as const;
