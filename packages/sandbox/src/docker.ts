/**
 * DockerSandbox — container-isolated execution via the host's `docker` CLI.
 *
 * Praetor-native: the docker CLI is the platform's standard automation
 * surface (same category as `git` for PraetorGit, `screencapture` for
 * PraetorScreen, `playwright-core` for the browser). Praetor owns the
 * sandbox lifecycle, audit, and contract; Docker just runs the container.
 *
 *   - On `create()`: spawn a long-running container with `docker run -d`,
 *     mount whichever host paths the charter declared, fix the workdir,
 *     keep it alive with `sleep infinity`. Return a Sandbox handle.
 *   - On `exec()`: `docker exec <id>` runs the command inside the container.
 *   - On `writeFile()`: pipes content into `docker exec -i <id> tee <path>`.
 *   - On `readFile()`: `docker exec <id> cat <path>` and decode the stdout.
 *   - On `close()`: `docker rm -f <id>`.
 *
 * Why not use a third-party Docker SDK? Because the SDK would put a
 * third-party lib in the default codepath. The CLI ships with every Docker
 * install; talking to it via spawn is cheap, well-specified, and platform-
 * neutral (Docker Desktop on Windows/Mac uses the same CLI as Linux).
 */

import { spawn, type SpawnOptions } from "node:child_process";
import type { ExecResult, Sandbox, SandboxFactory } from "./index.js";

export interface DockerSandboxOptions {
  /** Image to run. Defaults to `node:20-alpine` (~50MB; node + sh + busybox). */
  image?: string;
  /** Working directory inside the container. Defaults to `/work`. */
  workdir?: string;
  /** Bind-mounts. `host` is on the host fs, `container` is the in-VM path. */
  mounts?: { host: string; container: string; readonly?: boolean }[];
  /** Env passed to the container at create time. */
  env?: Record<string, string>;
  /** Network mode. Default: "bridge". Pass "none" when running untrusted code. */
  network?: "bridge" | "none" | "host" | string;
  /** Hard timeout for any single docker invocation (ms). Default 5min. */
  dockerTimeoutMs?: number;
  /** Override the docker binary path. Default: `docker` (resolved via PATH). */
  dockerPath?: string;
  /**
   * Hardening defaults applied unless overridden. Each entry maps to a
   * docker-run flag. Set to `null` to disable a specific default.
   */
  limits?: {
    /** `--memory`. Default "2g". */
    memory?: string | null;
    /** `--cpus`. Default "2.0". */
    cpus?: string | null;
    /** `--pids-limit`. Default 256 (kills fork bombs). */
    pidsLimit?: number | null;
    /** Run with `--read-only` root fs. Default true; charters write to mounts/tmpfs. */
    readOnlyRootFs?: boolean;
    /** `--security-opt no-new-privileges`. Default true. */
    noNewPrivileges?: boolean;
    /** `--cap-drop ALL`. Default true; pass `capAdd: [...]` to grant specifics. */
    dropAllCaps?: boolean;
    /** `--cap-add` allowlist (only meaningful when dropAllCaps=true). */
    capAdd?: string[];
    /** Add a writable tmpfs at `/tmp`. Default true (with `--read-only` rootfs you'll want this). */
    tmpfs?: string[] | null;
  };
  /**
   * Refuse high-risk mounts at construct time. Default true. When true the
   * factory rejects `/`, `/var/run/docker.sock`, `/proc`, `/sys`,
   * `/etc/shadow`, and home-directory roots — common breakout vectors.
   */
  refuseDangerousMounts?: boolean;
  /**
   * Test injection — instead of spawning real docker, route every call
   * through this stub. The stub receives the argv and returns canned
   * stdout/stderr/exitCode. Lets us unit-test the adapter without a live
   * Docker daemon.
   */
  __spawn?: (args: string[], stdin?: string | Buffer) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const DEFAULT_IMAGE = "node:20-alpine";
const DEFAULT_WORKDIR = "/work";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const DANGEROUS_MOUNT_PATHS = [
  "/",
  "/var/run/docker.sock",
  "/var/run",
  "/proc",
  "/sys",
  "/etc",
  "/etc/shadow",
  "/etc/passwd",
  "/root",
  "C:\\",
  "C:\\Windows",
  "C:\\Users",
];

export class DockerSandbox implements Sandbox {
  constructor(
    public readonly id: string,
    private readonly opts: Required<Pick<DockerSandboxOptions, "dockerPath" | "dockerTimeoutMs">> & Pick<DockerSandboxOptions, "__spawn" | "workdir">,
  ) {}

  async exec(cmd: string, opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<ExecResult> {
    const t0 = Date.now();
    const args = ["exec"];
    if (opts?.cwd) {
      args.push("-w", opts.cwd);
    } else if (this.opts.workdir) {
      args.push("-w", this.opts.workdir);
    }
    for (const [k, v] of Object.entries(opts?.env ?? {})) {
      args.push("-e", `${k}=${v}`);
    }
    args.push(this.id, "sh", "-c", cmd);
    const r = await runDocker(this.opts.dockerPath, args, undefined, opts?.timeoutMs ?? this.opts.dockerTimeoutMs, this.opts.__spawn);
    return {
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      durationMs: Date.now() - t0,
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    // Use `tee` argv-style instead of `sh -c "cat > <path>"` so the path
    // never enters a shell context. Eliminates the command-injection class
    // for crafted file names (e.g. "; rm -rf /;").
    const parent = path.replace(/\/[^/]*$/, "");
    if (parent && parent !== path) {
      const mk = await runDocker(this.opts.dockerPath, ["exec", this.id, "mkdir", "-p", parent], undefined, this.opts.dockerTimeoutMs, this.opts.__spawn);
      if (mk.exitCode !== 0) throw new Error(`docker writeFile mkdir failed: ${mk.stderr.trim()}`);
    }
    const r = await runDocker(this.opts.dockerPath, ["exec", "-i", this.id, "tee", path], buf, this.opts.dockerTimeoutMs, this.opts.__spawn);
    if (r.exitCode !== 0) throw new Error(`docker writeFile failed: ${r.stderr.trim()}`);
  }

  async readFile(path: string): Promise<string> {
    const r = await runDocker(this.opts.dockerPath, ["exec", this.id, "cat", path], undefined, this.opts.dockerTimeoutMs, this.opts.__spawn);
    if (r.exitCode !== 0) throw new Error(`docker readFile failed: ${r.stderr.trim()}`);
    return r.stdout;
  }

  async close(): Promise<void> {
    try {
      await runDocker(this.opts.dockerPath, ["rm", "-f", this.id], undefined, this.opts.dockerTimeoutMs, this.opts.__spawn);
    } catch {
      // best-effort
    }
  }
}

export class DockerSandboxFactory implements SandboxFactory {
  constructor(private readonly opts: DockerSandboxOptions = {}) {}

  async create(runtime?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox> {
    const image = runtime?.template ?? this.opts.image ?? DEFAULT_IMAGE;
    const workdir = this.opts.workdir ?? DEFAULT_WORKDIR;
    const dockerPath = this.opts.dockerPath ?? "docker";
    const dockerTimeoutMs = this.opts.dockerTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const limits = this.opts.limits ?? {};
    const refuseDangerous = this.opts.refuseDangerousMounts !== false;

    // Refuse mounts that frequently appear in container-escape playbooks.
    if (refuseDangerous) {
      for (const m of this.opts.mounts ?? []) {
        const host = m.host.replace(/[\\/]+$/, "").toLowerCase();
        for (const danger of DANGEROUS_MOUNT_PATHS) {
          const dl = danger.toLowerCase().replace(/[\\/]+$/, "");
          if (host === dl) {
            throw new Error(`DockerSandboxFactory: refusing dangerous mount '${m.host}' (set refuseDangerousMounts: false to override)`);
          }
        }
      }
    }

    const args: string[] = ["run", "-d", "--rm"];
    args.push("-w", workdir);
    args.push("--network", this.opts.network ?? "bridge");

    // Hardening defaults — opt out by passing nulls, not by silent omission.
    if (limits.memory !== null) args.push("--memory", limits.memory ?? "2g");
    if (limits.cpus !== null) args.push("--cpus", limits.cpus ?? "2.0");
    if (limits.pidsLimit !== null) args.push("--pids-limit", String(limits.pidsLimit ?? 256));
    if (limits.noNewPrivileges !== false) args.push("--security-opt", "no-new-privileges");
    if (limits.dropAllCaps !== false) {
      args.push("--cap-drop", "ALL");
      for (const cap of limits.capAdd ?? []) args.push("--cap-add", cap);
    }
    if (limits.readOnlyRootFs !== false) {
      args.push("--read-only");
      // With read-only rootfs the agent still needs a writable area for
      // build artefacts. Mount tmpfs at /tmp and the workdir by default —
      // but skip any path that's already a host bind-mount (Docker
      // refuses duplicate mount points).
      const mountedPaths = new Set((this.opts.mounts ?? []).map((m) => m.container));
      const defaultTmpfs = ["/tmp", workdir].filter((p) => !mountedPaths.has(p));
      const tmpfsList = limits.tmpfs ?? defaultTmpfs;
      for (const t of tmpfsList) {
        if (mountedPaths.has(t)) continue;
        args.push("--tmpfs", `${t}:rw,size=512m,mode=1777`);
      }
    }

    for (const m of this.opts.mounts ?? []) {
      args.push("-v", `${m.host}:${m.container}${m.readonly ? ":ro" : ""}`);
    }
    const env = { ...this.opts.env, ...(runtime?.envVars ?? {}) };
    for (const [k, v] of Object.entries(env)) {
      args.push("-e", `${k}=${v}`);
    }
    args.push(image, "sleep", "infinity");

    const r = await runDocker(dockerPath, args, undefined, dockerTimeoutMs, this.opts.__spawn);
    if (r.exitCode !== 0) {
      throw new Error(`DockerSandboxFactory: 'docker run' failed (${r.exitCode}): ${r.stderr.trim() || r.stdout.trim()}`);
    }
    const id = r.stdout.trim().split(/\s+/).pop()!.slice(0, 64);
    if (!id) throw new Error("DockerSandboxFactory: docker run returned no container id");

    // Make sure the workdir exists in the container (so subsequent execs land somewhere real).
    await runDocker(dockerPath, ["exec", id, "mkdir", "-p", workdir], undefined, dockerTimeoutMs, this.opts.__spawn);

    return new DockerSandbox(id, { dockerPath, dockerTimeoutMs, workdir, __spawn: this.opts.__spawn });
  }

  /**
   * Probe whether `docker` is reachable from this process. Used by the
   * dispatcher's `auto` mode. Cheap (`docker version` is a single round
   * trip); cached by callers.
   */
  static async isAvailable(opts: { dockerPath?: string; __spawn?: DockerSandboxOptions["__spawn"] } = {}): Promise<boolean> {
    try {
      const r = await runDocker(opts.dockerPath ?? "docker", ["version", "--format", "{{.Server.Version}}"], undefined, 10_000, opts.__spawn);
      return r.exitCode === 0 && r.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}

function escapeShellPath(p: string): string {
  return p.replace(/(["\\$`])/g, "\\$1");
}

async function runDocker(
  dockerPath: string,
  args: string[],
  stdin: string | Buffer | undefined,
  timeoutMs: number,
  injected: DockerSandboxOptions["__spawn"] | undefined,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (injected) {
    return injected(args, stdin);
  }
  return new Promise((resolveFn) => {
    const spawnOpts: SpawnOptions = { stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true };
    const child = spawn(dockerPath, args, spawnOpts);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
    }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString("utf8"); if (stdout.length > 10_000_000) stdout = stdout.slice(-10_000_000); });
    child.stderr?.on("data", (d) => { stderr += d.toString("utf8"); if (stderr.length > 5_000_000) stderr = stderr.slice(-5_000_000); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveFn({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveFn({
        exitCode: typeof code === "number" ? code : -1,
        stdout: timedOut ? `${stdout}\n[praetor: docker invocation timed out after ${timeoutMs}ms]` : stdout,
        stderr,
      });
    });
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin);
    }
  });
}
