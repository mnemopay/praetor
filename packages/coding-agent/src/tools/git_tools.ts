import { ToolRegistry } from "@praetor/tools";
import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Git tools — wrappers over simple-git, scoped to the repo root.
 *
 * No tool here pushes or rewrites history. The agent must ask the user
 * before any operation that touches a remote or rewrites commits.
 */

export interface GitToolsOptions {
  repoRoot: string;
}

export function registerGitTools(reg: ToolRegistry, opts: GitToolsOptions): void {
  const git: SimpleGit = simpleGit({ baseDir: opts.repoRoot });
  const tags = ["coding", "free", "git"] as const;
  const allowedRoles = ["coding"] as const;

  reg.register<Record<string, unknown>, { not_added: string[]; modified: string[]; created: string[]; deleted: string[]; staged: string[] }>(
    {
      name: "git_status",
      description: "List uncommitted changes in the working tree.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
    },
    async () => {
      const s = await git.status();
      return {
        not_added: s.not_added,
        modified: s.modified,
        created: s.created,
        deleted: s.deleted,
        staged: s.staged,
      };
    },
  );

  reg.register<{ path?: string }, { diff: string }>(
    {
      name: "git_diff",
      description: "Show the unstaged diff (optionally for a single path).",
      schema: { type: "object", properties: { path: { type: "string" } }, required: [] },
      tags, allowedRoles,
    },
    async ({ path }) => {
      const diff = path ? await git.diff([path]) : await git.diff();
      return { diff };
    },
  );

  reg.register<{ message: string; paths?: string[] }, { commit: string; summary: string }>(
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
    },
    async ({ message, paths }) => {
      if (paths && paths.length > 0) {
        await git.add(paths);
      } else {
        await git.add(["-A"]);
      }
      const r = await git.commit(message);
      return { commit: r.commit, summary: `${r.summary?.changes ?? 0} changes / ${r.summary?.insertions ?? 0} insertions / ${r.summary?.deletions ?? 0} deletions` };
    },
  );

  reg.register<Record<string, unknown>, { current: string; all: string[] }>(
    {
      name: "git_branch",
      description: "List branches and report the current one.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
    },
    async () => {
      const b = await git.branchLocal();
      return { current: b.current, all: b.all };
    },
  );

  reg.register<{ limit?: number }, { commits: { hash: string; subject: string; author: string; date: string }[] }>(
    {
      name: "git_log",
      description: "Show recent commits.",
      schema: { type: "object", properties: { limit: { type: "integer" } }, required: [] },
      tags, allowedRoles,
    },
    async ({ limit }) => {
      const r = await git.log({ maxCount: typeof limit === "number" ? limit : 20 });
      return {
        commits: r.all.map((c) => ({
          hash: c.hash,
          subject: c.message,
          author: c.author_name,
          date: c.date,
        })),
      };
    },
  );
}

export const GIT_TOOL_NAMES: readonly string[] = ["git_status", "git_diff", "git_commit", "git_branch", "git_log"] as const;
