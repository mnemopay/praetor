/**
 * LocalSandbox — direct host execution, NO isolation.
 *
 * Use cases:
 *   - Coding agent editing the user's actual repo (the host *is* the
 *     workspace).
 *   - Charters that legitimately need to spawn the system Node, hit
 *     localhost services, or read files outside any container.
 *   - Tests where MockSandbox's canned `exec` output is too lossy.
 *
 * Charters that touch *untrusted* code or input must never use this — pick
 * `kind: "docker"` (or `firecracker` for sovereign mode) instead.
 *
 * Praetor-native — `node:child_process` and `node:fs/promises` only. No
 * third-party deps in the default codepath.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExecResult, Sandbox, SandboxFactory } from "./index.js";

export interface LocalSandboxOptions {
  /** Working directory rooted at the host. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Default env passed to every exec(). Merges with the per-call env. */
  env?: Record<string, string>;
  /** Default per-exec timeout (ms). Caller can override per-call. */
  defaultTimeoutMs?: number;
  /** Allow paths that escape the cwd. Defaults to false (path-safety on). */
  allowEscape?: boolean;
}

export class LocalSandbox implements Sandbox {
  readonly id: string;
  private readonly cwd: string;
  private readonly defaultEnv: Record<string, string>;
  private readonly defaultTimeoutMs: number;
  private readonly allowEscape: boolean;

  constructor(opts: LocalSandboxOptions = {}, id?: string) {
    this.id = id ?? `local-${Date.now().toString(36)}`;
    this.cwd = resolve(opts.cwd ?? process.cwd());
    this.defaultEnv = opts.env ?? {};
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120_000;
    this.allowEscape = !!opts.allowEscape;
  }

  async exec(cmd: string, opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<ExecResult> {
    const startedAt = Date.now();
    const cwd = opts?.cwd ? this.confine(opts.cwd) : this.cwd;
    const env = { ...process.env, ...this.defaultEnv, ...(opts?.env ?? {}) } as NodeJS.ProcessEnv;
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    return new Promise((resolveFn) => {
      // We use a real shell here because the command string is the contract
      // (ExecResult-style sandboxes are shell-shaped). Charters that want a
      // strict no-shell spawn should use coding-agent's run_command tool.
      const isWin = process.platform === "win32";
      const shell = isWin ? "cmd.exe" : "sh";
      const args = isWin ? ["/d", "/s", "/c", cmd] : ["-c", cmd];
      // detached:true on POSIX puts the child in its own process group so
      // we can SIGKILL the whole tree on timeout (otherwise grandchild
      // processes keep stdio pipes open and `close` never fires).
      const child = spawn(shell, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: !isWin });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const settle = (result: ExecResult) => {
        if (settled) return;
        settled = true;
        resolveFn(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (isWin) {
            child.kill("SIGKILL");
          } else if (child.pid) {
            // Kill the whole process group (negative pid).
            try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
          }
        } catch { /* already exited */ }
        // Resolve from the timer rather than waiting for `close` —
        // detached grandchildren can keep pipes open even after SIGKILL,
        // so the close event isn't reliable across platforms.
        settle({
          exitCode: -1,
          stdout: `${stdout}\n[praetor: timed out after ${timeoutMs}ms]`,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      }, timeoutMs);
      child.stdout?.on("data", (d) => { stdout += d.toString("utf8"); if (stdout.length > 5_000_000) stdout = stdout.slice(-5_000_000); });
      child.stderr?.on("data", (d) => { stderr += d.toString("utf8"); if (stderr.length > 5_000_000) stderr = stderr.slice(-5_000_000); });
      child.on("error", (err) => {
        clearTimeout(timer);
        settle({
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n${err.message}`,
          durationMs: Date.now() - startedAt,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        settle({
          exitCode: typeof code === "number" ? code : -1,
          stdout: timedOut ? `${stdout}\n[praetor: timed out after ${timeoutMs}ms]` : stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }

  async writeFile(p: string, content: string | Uint8Array): Promise<void> {
    const abs = this.confine(p);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content as Buffer | string);
  }

  async readFile(p: string): Promise<string> {
    return readFile(this.confine(p), "utf-8");
  }

  async close(): Promise<void> {
    // Nothing to clean up — the host is the host.
  }

  private confine(p: string): string {
    if (this.allowEscape) return isAbsolute(p) ? p : resolve(this.cwd, p);
    const abs = isAbsolute(p) ? resolve(p) : resolve(this.cwd, p);
    if (abs !== this.cwd && !abs.startsWith(this.cwd + "\\") && !abs.startsWith(this.cwd + "/")) {
      throw new Error(`local-sandbox: path '${p}' resolves outside cwd '${this.cwd}'`);
    }
    return abs;
  }
}

export class LocalSandboxFactory implements SandboxFactory {
  constructor(private readonly opts: LocalSandboxOptions = {}) {}
  async create(_runtime?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox> {
    return new LocalSandbox({ ...this.opts, env: { ...this.opts.env, ..._runtime?.envVars } });
  }
}
