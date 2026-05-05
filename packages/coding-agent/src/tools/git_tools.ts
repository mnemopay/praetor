import { ToolRegistry } from "@kpanks/tools";
import { PraetorGit } from "./praetor_git.js";

/**
 * Git tools — Praetor-native via PraetorGit (no simple-git dependency).
 *
 * No tool here pushes or rewrites history. The agent must ask the user
 * before any operation that touches a remote or rewrites commits.
 */

export interface GitToolsOptions {
  repoRoot: string;
}

export function registerGitTools(reg: ToolRegistry, opts: GitToolsOptions): void {
  const git = new PraetorGit(opts.repoRoot);
  const tags = ["coding", "free", "git"] as const;
  const allowedRoles = ["coding"] as const;
  const nativeNote = "PraetorGit native — spawns the git binary + parses porcelain v1.";

  reg.register<Record<string, unknown>, { not_added: string[]; modified: string[]; created: string[]; deleted: string[]; staged: string[] }>(
    {
      name: "git_status",
      description: "List uncommitted changes in the working tree.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "git_status", risk: ["filesystem"], approval: "never", sandbox: "repo", production: "needs-live-test", costEffective: true, note: nativeNote },
    },
    async () => git.status(),
  );

  reg.register<{ path?: string }, { diff: string }>(
    {
      name: "git_diff",
      description: "Show the unstaged diff (optionally for a single path).",
      schema: { type: "object", properties: { path: { type: "string" } }, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "git_diff", risk: ["filesystem"], approval: "never", sandbox: "repo", production: "needs-live-test", costEffective: true, note: nativeNote },
    },
    async ({ path }) => ({ diff: await git.diff(path) }),
  );

  reg.register<{ message: string; paths?: string[] }, { commit: string; summary: string; rollbackBundle: string }>(
    {
      name: "git_commit",
      description: "Stage the listed paths (or all changes if omitted) and commit with the given message.",
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["message"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "git_commit", risk: ["filesystem"], approval: "on-side-effect", sandbox: "repo", production: "ready", costEffective: true, note: "PraetorGit native; pre-commit rollback patch bundle written under .praetor/rollbacks/." },
    },
    async ({ message, paths }) => {
      // Generate rollback bundle before committing
      const rollbackDiff = await git.diff();
      const rollbackBundle = `rollback_commit_${Date.now()}.patch`;
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const rollbackDir = path.resolve(opts.repoRoot, ".praetor", "rollbacks");
      await fs.mkdir(rollbackDir, { recursive: true });
      await fs.writeFile(path.resolve(rollbackDir, rollbackBundle), rollbackDiff, "utf8");

      if (paths && paths.length > 0) await git.add(paths);
      else await git.add(["-A"]);

      const r = await git.commit(message);
      return { commit: r.commit, summary: r.summary, rollbackBundle };
    },
  );

  reg.register<Record<string, unknown>, { current: string; all: string[] }>(
    {
      name: "git_branch",
      description: "List branches and report the current one.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "git_branch", risk: ["filesystem"], approval: "never", sandbox: "repo", production: "needs-live-test", costEffective: true, note: nativeNote },
    },
    async () => git.branchLocal(),
  );

  reg.register<{ limit?: number }, { commits: { hash: string; subject: string; author: string; date: string }[] }>(
    {
      name: "git_log",
      description: "Show recent commits.",
      schema: { type: "object", properties: { limit: { type: "integer" } }, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "git_log", risk: ["filesystem"], approval: "never", sandbox: "repo", production: "needs-live-test", costEffective: true, note: nativeNote },
    },
    async ({ limit }) => ({ commits: await git.log(typeof limit === "number" ? limit : 20) }),
  );
}

export const GIT_TOOL_NAMES: readonly string[] = ["git_status", "git_diff", "git_commit", "git_branch", "git_log"] as const;
