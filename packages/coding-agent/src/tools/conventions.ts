/**
 * load_conventions — read project-level coding conventions and feed them
 * back to the agent. Closes the gap with Claude Code (CLAUDE.md), Cursor
 * (.cursorrules), Aider (.aider.conf.yml + CONVENTIONS.md), and AGENTS.md.
 *
 * Returns the concatenated text of the first existing of each known
 * convention file, with file paths as section headers so the LLM can cite
 * "per CLAUDE.md" / "per AGENTS.md" reliably.
 */

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { ToolRegistry } from "@kpanks/tools";

export interface ConventionsToolOptions {
  repoRoot: string;
  /** Per-file byte cap; protects context from a runaway README. Default 32KB. */
  maxBytesPerFile?: number;
  /** Total byte cap across all files. Default 128KB. */
  totalBytes?: number;
  /** Override the default discovery list. */
  files?: readonly string[];
}

const DEFAULT_FILES: readonly string[] = [
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".cursor/rules.md",
  "CONVENTIONS.md",
  ".aider.conf.yml",
  "PRAETOR.md",
  "CONTRIBUTING.md",
];

export function registerConventionsTool(reg: ToolRegistry, opts: ConventionsToolOptions): void {
  const root = resolve(opts.repoRoot);
  const perFile = opts.maxBytesPerFile ?? 32 * 1024;
  const total = opts.totalBytes ?? 128 * 1024;
  const files = opts.files ?? DEFAULT_FILES;

  const tags = ["coding", "free", "context"] as const;
  const allowedRoles = ["coding"] as const;

  reg.register<Record<string, unknown>, { sections: { path: string; bytes: number; truncated: boolean; text: string }[]; checked: string[]; missing: string[] }>(
    {
      name: "load_conventions",
      description:
        "Read project conventions (CLAUDE.md, AGENTS.md, .cursorrules, CONVENTIONS.md, etc.) and return them. Call once at the start of a coding mission to inherit the repo's house rules.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
      metadata: {
        origin: "native",
        capability: "repo_conventions",
        risk: ["filesystem"],
        approval: "never",
        sandbox: "repo",
        production: "ready",
        costEffective: true,
      },
    },
    async () => {
      const sections: { path: string; bytes: number; truncated: boolean; text: string }[] = [];
      const checked: string[] = [];
      const missing: string[] = [];
      let cumulative = 0;
      for (const rel of files) {
        checked.push(rel);
        const abs = resolve(join(root, rel));
        if (!abs.startsWith(root)) continue;
        let body: string;
        try {
          body = await fs.readFile(abs, "utf8");
        } catch {
          missing.push(rel);
          continue;
        }
        const buf = Buffer.from(body, "utf8");
        const truncated = buf.length > perFile;
        const sliced = truncated ? buf.subarray(0, perFile).toString("utf8") : body;
        const remaining = total - cumulative;
        if (remaining <= 0) break;
        const text = sliced.length > remaining ? sliced.slice(0, remaining) : sliced;
        cumulative += Buffer.byteLength(text, "utf8");
        sections.push({
          path: rel,
          bytes: Buffer.byteLength(text, "utf8"),
          truncated: truncated || sliced.length > remaining,
          text,
        });
      }
      return { sections, checked, missing };
    },
  );
}

export const CONVENTIONS_TOOL_NAMES: readonly string[] = ["load_conventions"] as const;
