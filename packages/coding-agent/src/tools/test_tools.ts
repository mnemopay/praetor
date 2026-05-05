import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ToolRegistry } from "@kpanks/tools";

/**
 * Test + run tools.
 *
 * - run_tests autodetects the project type (npm, pytest, cargo, go) and
 *   runs the appropriate test command.
 * - run_command spawns an arbitrary command with cwd pinned to repoRoot
 *   and a hard 30-second timeout. No shell interpolation.
 */

export interface TestToolsOptions {
  repoRoot: string;
  /** Override the default 30-second timeout (ms). */
  timeoutMs?: number;
  /**
   * Replace the default `run_command` allowlist entirely. Use sparingly —
   * the default already covers the common JS/Python/Go/Rust toolchains plus
   * basic POSIX utilities. Pass `extraAllow` instead when you only want to
   * add to the defaults.
   */
  allowList?: readonly string[];
  /** Append additional commands to the default allowlist. */
  extraAllow?: readonly string[];
}

interface CommandResult {
  command: string;
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function registerTestTools(reg: ToolRegistry, opts: TestToolsOptions): void {
  const root = resolve(opts.repoRoot);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const tags = ["coding", "free", "exec"] as const;
  const allowedRoles = ["coding"] as const;

  reg.register<Record<string, unknown>, CommandResult>(
    {
      name: "run_tests",
      description: "Run the project's test suite. Autodetects npm test, pytest, cargo test, or go test.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "repo_test_run", risk: ["shell"], approval: "on-side-effect", sandbox: "repo", production: "needs-live-test", costEffective: true },
    },
    async () => {
      const detected = detectTestCommand(root);
      if (!detected) {
        return {
          command: "(none detected)",
          exitCode: 127,
          signal: null,
          stdout: "",
          stderr: "no test framework detected (looked for package.json, pyproject.toml, Cargo.toml, go.mod)",
          timedOut: false,
        };
      }
      return runCommand(detected.cmd, detected.args, root, timeoutMs);
    },
  );

  const defaultAllowList: readonly string[] = [
    // JS/TS toolchains
    "npm", "npx", "node", "tsc", "vitest", "pnpm", "yarn", "bun", "deno",
    // Python
    "python", "python3", "pip", "pip3", "pytest", "uv", "poetry",
    // Other languages
    "cargo", "rustc", "go",
    // Build / packaging
    "make",
    // Repo / utility
    "git", "ls", "pwd", "echo", "cat", "mkdir", "which", "where", "find", "head", "tail",
  ];
  const allowlist = (opts.allowList ? [...opts.allowList] : [...defaultAllowList]);
  if (opts.extraAllow) for (const a of opts.extraAllow) if (!allowlist.includes(a)) allowlist.push(a);
  reg.register<{ command: string; args?: string[] }, CommandResult>(
    {
      name: "run_command",
      description: "Spawn a command inside the repo root with a 30s timeout. No shell, no interpolation.",
      schema: {
        type: "object",
        properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } } },
        required: ["command"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "repo_command_run", risk: ["shell", "filesystem", "network"], approval: "on-side-effect", sandbox: "repo", production: "ready", costEffective: true, note: "Command allowlist enforced natively." },
    },
    async ({ command, args }) => {
      if (!allowlist.includes(command)) {
        throw new Error(`Command '${command}' is blocked by Praetor security policies. Allowed: ${allowlist.join(", ")}`);
      }
      return runCommand(command, args ?? [], root, timeoutMs);
    },
  );
}

function detectTestCommand(root: string): { cmd: string; args: string[] } | null {
  if (existsSync(join(root, "package.json"))) return { cmd: "npm", args: ["test", "--silent"] };
  if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "pytest.ini"))) {
    return { cmd: "pytest", args: ["-q"] };
  }
  if (existsSync(join(root, "Cargo.toml"))) return { cmd: "cargo", args: ["test", "--quiet"] };
  if (existsSync(join(root, "go.mod"))) return { cmd: "go", args: ["test", "./..."] };
  return null;
}

// Windows resolves these commands via .cmd / .ps1 shim files rather than
// direct .exe binaries. Without `shell: true`, Node's spawn calls
// CreateProcess directly and ENOENTs. We opt these specific names into
// shell-mode resolution; native executables like node/python/git stay on
// the default codepath so child.kill() can tree-kill them on timeout.
const WINDOWS_SHIMS = new Set([
  "npm", "npx", "pnpm", "yarn", "bun",
  "tsc", "vitest", "tsx",
  "pip", "pip3", "pytest", "uv", "poetry",
  "cargo", "deno", "rustc", "go",
]);

/**
 * When `shell: true` is in effect, args are concatenated by the shell, not
 * escaped — so an arg like `;rm -rf /` would actually run. Refuse args
 * containing shell metacharacters in shell-mode. Direct-spawn paths (the
 * default) don't need this because args are passed individually to
 * CreateProcess / posix_spawn without a shell intermediary.
 */
function rejectShellInjection(args: string[]): void {
  // Node's `shell: true` on Windows invokes cmd.exe; on POSIX it invokes
  // /bin/sh. Both interpret these as command separators / redirection /
  // chaining. Narrow set to keep legit args (parentheses, dots, dashes)
  // working while blocking the obvious injection vectors.
  for (const a of args) {
    if (typeof a !== "string") continue;
    if (/[&|<>`^]/.test(a) || /\$\(/.test(a)) {
      throw new Error(`run_command: argument contains shell metacharacter, refused for shell-mode spawn: ${a}`);
    }
  }
}

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveFn) => {
    const useShell = process.platform === "win32" && WINDOWS_SHIMS.has(cmd);
    if (useShell) rejectShellInjection(args);
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: useShell, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.on("data", (d) => { stdout += d.toString("utf8"); if (stdout.length > 200_000) stdout = stdout.slice(-200_000); });
    child.stderr?.on("data", (d) => { stderr += d.toString("utf8"); if (stderr.length > 200_000) stderr = stderr.slice(-200_000); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveFn({
        command: `${cmd} ${args.join(" ")}`.trim(),
        exitCode: -1,
        signal: null,
        stdout,
        stderr: stderr + `\n${err.message}`,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveFn({
        command: `${cmd} ${args.join(" ")}`.trim(),
        exitCode: typeof code === "number" ? code : -1,
        signal: signal ?? null,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export const TEST_TOOL_NAMES: readonly string[] = ["run_tests", "run_command"] as const;
