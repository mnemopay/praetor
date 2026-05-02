import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ToolRegistry } from "@praetor/tools";

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
      metadata: { origin: "native", capability: "repo_command_run", risk: ["shell", "filesystem", "network"], approval: "on-side-effect", sandbox: "repo", production: "needs-live-test", costEffective: true, note: "No shell interpolation; production target adds command allowlists and transcript replay." },
    },
    async ({ command, args }) => {
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

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveFn) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
