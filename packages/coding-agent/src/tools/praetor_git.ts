/**
 * PraetorGit — native git porcelain runner.
 *
 * Replaces simple-git with a thin spawn + porcelain v2 parser. No third-
 * party dep — `git` itself is the runtime, which Praetor users already
 * have installed (it's the only sane prerequisite for any coding agent).
 *
 * Why native: simple-git is MIT but adds 80 KB + a maintenance vector
 * for a problem that's `child_process.spawn` + a regex away. Per Praetor
 * doctrine — every tool in the registry should be Praetor-native.
 *
 * Surface mirrors the simple-git subset the coding-agent actually used:
 *   status() → { not_added, modified, created, deleted, staged }
 *   diff(path?) → string
 *   add(paths) + commit(message) → { commit, summary }
 *   branchLocal() → { current, all }
 *   log(maxCount) → { hash, subject, author, date }[]
 */

import { spawn } from "node:child_process";

export interface GitStatus {
  not_added: string[];
  modified: string[];
  created: string[];
  deleted: string[];
  staged: string[];
}

export interface GitCommit {
  commit: string;
  summary: string;
}

export interface GitBranches {
  current: string;
  all: string[];
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export class PraetorGit {
  constructor(private readonly cwd: string) {}

  /** Execute `git <args>` in the configured cwd and return stdout (trimmed of trailing newline). */
  private async exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(out).toString("utf8").replace(/\n$/, ""));
        else reject(new Error(`git ${args.join(" ")} exited ${code}: ${Buffer.concat(err).toString("utf8")}`));
      });
    });
  }

  /** Parse `git status --porcelain=v1 -z` output into category buckets.
   * porcelain v1 line shape: `XY <path>` where X is staged-area status,
   * Y is unstaged-area status. NUL-delimited so paths with newlines work. */
  async status(): Promise<GitStatus> {
    const raw = await this.exec(["status", "--porcelain=v1", "-z"]);
    const result: GitStatus = { not_added: [], modified: [], created: [], deleted: [], staged: [] };
    if (!raw) return result;
    const entries = raw.split("\0").filter(Boolean);
    for (const entry of entries) {
      // First two chars are the status code, then a space, then the path.
      // For renames the format is `R  src -> dst` but rare for our use; treat as modified.
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      const x = code[0];
      const y = code[1];
      if (x !== " " && x !== "?") result.staged.push(path);
      if (code === "??") result.not_added.push(path);
      else if (y === "M") result.modified.push(path);
      else if (y === "D") result.deleted.push(path);
      else if (x === "A") result.created.push(path);
    }
    return result;
  }

  /** Show unstaged diff. If a path is provided, scope to that path. */
  async diff(path?: string): Promise<string> {
    const args = path ? ["diff", "--", path] : ["diff"];
    return this.exec(args);
  }

  /** Stage paths. Pass `["-A"]` (or omit) to stage everything. */
  async add(paths: string[] = ["-A"]): Promise<void> {
    await this.exec(["add", ...paths]);
  }

  /** Commit with the given message. Returns the new commit's short hash + a summary line. */
  async commit(message: string): Promise<GitCommit> {
    // -m + porcelain output. Use a single -m so newlines in message cause errors loudly.
    const out = await this.exec(["commit", "-m", message]);
    // git commit's stdout looks like:
    //   [master abc1234] subject
    //    1 file changed, 2 insertions(+), 1 deletion(-)
    const head = out.split("\n")[0] ?? "";
    const headMatch = /^\[(\S+)\s+([0-9a-f]+)\]/.exec(head);
    const commitHash = headMatch?.[2] ?? "";
    const summaryLine = out.split("\n")[1]?.trim() ?? "";
    return { commit: commitHash, summary: summaryLine };
  }

  /** List local branches + the current one. */
  async branchLocal(): Promise<GitBranches> {
    const current = await this.exec(["branch", "--show-current"]);
    const allRaw = await this.exec(["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
    const all = allRaw.split("\n").filter(Boolean);
    return { current, all };
  }

  /** Recent commits, newest first. */
  async log(maxCount = 20): Promise<GitLogEntry[]> {
    // Use NUL between fields + RS between records so subjects with any char are safe.
    const out = await this.exec([
      "log",
      `-n${maxCount}`,
      "--pretty=format:%H%x00%s%x00%an%x00%aI%x1e",
    ]);
    if (!out) return [];
    return out
      .split("\x1e")
      .map((rec) => rec.replace(/^\n+/, ""))
      .filter(Boolean)
      .map((rec) => {
        const [hash, subject, author, date] = rec.split("\0");
        return { hash, subject, author, date };
      });
  }
}
