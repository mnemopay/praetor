/**
 * @praetor/sandbox — sandboxed execution for charters that touch real infra.
 *
 * Five adapters, ranked by isolation:
 *   - LocalSandbox: direct host execution, NO isolation. Use only for
 *     trusted code (e.g. coding-agent editing the user's own repo).
 *   - MockSandbox: in-process, deterministic. Tests + dry runs.
 *   - DockerSandbox: real OS-level isolation via the host's `docker` CLI.
 *     Native — no third-party Docker SDK in the default codepath.
 *   - E2bSandbox: cloud, ~150 ms cold start, KVM hardware isolation. Opt-in.
 *   - FirecrackerSandbox: self-hosted, sovereign-mode KVM microVM. Opt-in.
 *
 * A charter declares `sandbox: { kind: "auto" | "local" | "mock" | "docker"
 * | "e2b" | "firecracker" }`. The dispatcher in `auto` mode probes Docker
 * and falls through to mock if Docker isn't reachable.
 */

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface Sandbox {
  /** Identifier for the running microVM/instance. */
  readonly id: string;
  /** Run a single shell command. */
  exec(cmd: string, opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<ExecResult>;
  /** Write a file into the sandbox FS. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /** Read a file out of the sandbox FS. */
  readFile(path: string): Promise<string>;
  /** Tear down. Adapters must release the underlying VM. */
  close(): Promise<void>;
}

export type SandboxKind = "auto" | "local" | "mock" | "docker" | "e2b" | "firecracker" | "firecracker-self-hosted";

export interface SandboxFactory {
  create(opts?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox>;
}

/* ─────────── MOCK (in-process, deterministic) ─────────── */

/**
 * MockSandbox — the default for `charter.sandbox.kind: "mock"` (or unset).
 *
 * Reads/writes go through to the REAL filesystem under
 * `.praetor/sandbox/<missionId>/` so charter authors can actually see the
 * artifacts their charter produces. `exec` stays mocked (returns canned
 * stdout) — real shell execution requires explicit microvm/host sandbox.
 *
 * Path semantics: paths are joined under the sandbox root. Absolute paths
 * have their drive/root stripped so a charter can't escape the sandbox.
 */
import { mkdir, writeFile as fsWriteFile, readFile as fsReadFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class MockSandbox implements Sandbox {
  readonly id: string;
  readonly root: string;
  constructor(id = `mock-${Date.now().toString(36)}`, baseDir = ".praetor/sandbox") {
    this.id = id;
    this.root = join(process.cwd(), baseDir, id);
  }
  async exec(cmd: string): Promise<ExecResult> {
    return { exitCode: 0, stdout: `mock> ${cmd}\n`, stderr: "", durationMs: 1 };
  }
  async writeFile(p: string, content: string | Uint8Array): Promise<void> {
    const safe = join(this.root, this.confine(p));
    await mkdir(dirname(safe), { recursive: true });
    await fsWriteFile(safe, content as Buffer | string);
  }
  async readFile(p: string): Promise<string> {
    const safe = join(this.root, this.confine(p));
    try {
      return await fsReadFile(safe, "utf-8");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new Error(`mock-sandbox: file not found '${p}'`);
      throw err;
    }
  }
  async close(): Promise<void> {
    // Keep artifacts on disk so the user can inspect them post-mission.
  }
  /** Strip drive letter + leading separator so the path stays inside the sandbox root. */
  private confine(p: string): string {
    return p.replace(/^[A-Za-z]:/, "").replace(/^[\/\\]+/, "").replace(/\.\.[\/\\]/g, "");
  }
}

export class MockSandboxFactory implements SandboxFactory {
  async create(): Promise<Sandbox> {
    return new MockSandbox();
  }
}

/* ─────────── E2B (cloud) ─────────── */

export interface E2bClient {
  /** Spawn a sandbox. Returns the sandbox identifier. */
  spawn(template?: string, envVars?: Record<string, string>): Promise<string>;
  exec(id: string, cmd: string, opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<ExecResult>;
  writeFile(id: string, path: string, content: string): Promise<void>;
  readFile(id: string, path: string): Promise<string>;
  kill(id: string): Promise<void>;
}

export class E2bSandbox implements Sandbox {
  constructor(public readonly id: string, private client: E2bClient) {}
  exec(cmd: string, opts?: Parameters<Sandbox["exec"]>[1]): Promise<ExecResult> { return this.client.exec(this.id, cmd, opts); }
  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await this.client.writeFile(this.id, path, typeof content === "string" ? content : Buffer.from(content).toString("utf8"));
  }
  readFile(path: string): Promise<string> { return this.client.readFile(this.id, path); }
  close(): Promise<void> { return this.client.kill(this.id); }
}

export class E2bSandboxFactory implements SandboxFactory {
  constructor(private client: E2bClient, private defaultTemplate = "base") {}
  async create(opts?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox> {
    const id = await this.client.spawn(opts?.template ?? this.defaultTemplate, opts?.envVars);
    return new E2bSandbox(id, this.client);
  }
}

/**
 * Thin REST client for e2b. Pass e2b's API key + endpoint and this hits the public
 * sandbox HTTP API. Replace with `import { Sandbox } from 'e2b'` if you'd rather
 * use the official SDK — same shape.
 */
export function httpE2bClient(opts: { apiKey: string; baseUrl?: string }): E2bClient {
  const base = opts.baseUrl ?? "https://api.e2b.dev";
  const headers = { "X-API-Key": opts.apiKey, "content-type": "application/json" };
  return {
    async spawn(template = "base", envVars) {
      const r = await fetch(`${base}/sandboxes`, { method: "POST", headers, body: JSON.stringify({ template, envVars }) });
      if (!r.ok) throw new Error(`e2b spawn failed: ${r.status}`);
      const j = (await r.json()) as { sandboxId: string };
      return j.sandboxId;
    },
    async exec(id, cmd, _opts) {
      const r = await fetch(`${base}/sandboxes/${id}/exec`, { method: "POST", headers, body: JSON.stringify({ cmd, ..._opts }) });
      const j = (await r.json()) as ExecResult;
      return j;
    },
    async writeFile(id, path, content) {
      const r = await fetch(`${base}/sandboxes/${id}/fs`, { method: "PUT", headers, body: JSON.stringify({ path, content }) });
      if (!r.ok) throw new Error(`e2b writeFile failed: ${r.status}`);
    },
    async readFile(id, path) {
      const r = await fetch(`${base}/sandboxes/${id}/fs?path=${encodeURIComponent(path)}`, { headers });
      if (!r.ok) throw new Error(`e2b readFile failed: ${r.status}`);
      const j = (await r.json()) as { content: string };
      return j.content;
    },
    async kill(id) {
      await fetch(`${base}/sandboxes/${id}`, { method: "DELETE", headers });
    },
  };
}

/* ─────────── FIRECRACKER (self-hosted, sovereign mode) ─────────── */

export interface FirecrackerClient extends E2bClient {
  /** Path to firecracker control socket — typically /run/firecracker.sock. */
  socketPath: string;
}

export class FirecrackerSandboxFactory implements SandboxFactory {
  constructor(private client: FirecrackerClient, private rootfs: string) {}
  async create(opts?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox> {
    const id = await this.client.spawn(opts?.template ?? this.rootfs, opts?.envVars);
    return new E2bSandbox(id, this.client);
  }
}

/* ─────────── DISPATCHER ─────────── */

export interface SandboxDispatcherOpts {
  mock?: SandboxFactory;
  local?: SandboxFactory;
  docker?: SandboxFactory;
  e2b?: SandboxFactory;
  firecracker?: SandboxFactory;
  /**
   * Probe used by `kind: "auto"` to decide between docker → mock. Defaults
   * to `DockerSandboxFactory.isAvailable()`. Tests inject a fake.
   */
  isDockerAvailable?: () => Promise<boolean>;
}

export class SandboxDispatcher {
  constructor(private opts: SandboxDispatcherOpts) {}
  async create(kind: SandboxKind, runtimeOpts?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox> {
    if (kind === "auto") {
      const dockerOk = await (this.opts.isDockerAvailable ?? defaultDockerProbe)();
      const resolved: SandboxKind = dockerOk && this.opts.docker ? "docker" : "mock";
      return this.create(resolved, runtimeOpts);
    }
    if (kind === "mock") return (this.opts.mock ?? new MockSandboxFactory()).create(runtimeOpts);
    if (kind === "local") {
      if (!this.opts.local) throw new Error("sandbox kind 'local' requested but no LocalSandboxFactory configured. Pass { local: new LocalSandboxFactory({ cwd }) }.");
      return this.opts.local.create(runtimeOpts);
    }
    if (kind === "docker") {
      if (!this.opts.docker) throw new Error("sandbox kind 'docker' requested but no DockerSandboxFactory configured. Pass { docker: new DockerSandboxFactory() }.");
      return this.opts.docker.create(runtimeOpts);
    }
    if (kind === "e2b") {
      if (!this.opts.e2b) throw new Error("sandbox kind 'e2b' requested but no E2bSandboxFactory configured. Pass { e2b: new E2bSandboxFactory(httpE2bClient({apiKey})) }.");
      return this.opts.e2b.create(runtimeOpts);
    }
    // firecracker + firecracker-self-hosted are aliases.
    if (kind === "firecracker" || kind === "firecracker-self-hosted") {
      if (!this.opts.firecracker) throw new Error("sandbox kind 'firecracker' requested but no FirecrackerSandboxFactory configured.");
      return this.opts.firecracker.create(runtimeOpts);
    }
    throw new Error(`sandbox: unknown kind '${kind as string}'`);
  }
}

async function defaultDockerProbe(): Promise<boolean> {
  // Lazy import to avoid pulling docker.ts when nobody used auto mode yet.
  const { DockerSandboxFactory } = await import("./docker.js");
  return DockerSandboxFactory.isAvailable();
}

/* ─── Re-exports for the new local/docker adapters ─────────────────────── */
export { LocalSandbox, LocalSandboxFactory } from "./local.js";
export type { LocalSandboxOptions } from "./local.js";
export { DockerSandbox, DockerSandboxFactory } from "./docker.js";
export type { DockerSandboxOptions } from "./docker.js";
