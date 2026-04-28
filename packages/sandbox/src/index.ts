/**
 * @praetor/sandbox — microVM isolation for charters that touch real infra.
 *
 * Three adapters:
 *   - MockSandbox: in-process; for tests + dry runs.
 *   - E2bSandbox: cloud, ~150 ms cold start, KVM hardware isolation. Calls e2b.dev.
 *     Wraps the public REST surface. No e2b SDK dependency required at build time;
 *     attach a sender at runtime so this package stays dep-free.
 *   - FirecrackerSandbox: self-hosted. Talks to a local firecracker REST API socket
 *     for sovereign-mode deploys (DARPA, EU procurement). Same interface as e2b.
 *
 * A charter declares `sandbox: { kind: "e2b" | "firecracker-self-hosted" | "mock" }`.
 * The runtime picks the matching adapter and runs the charter inside.
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

export type SandboxKind = "mock" | "e2b" | "firecracker-self-hosted";

export interface SandboxFactory {
  create(opts?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox>;
}

/* ─────────── MOCK (in-process, deterministic) ─────────── */

export class MockSandbox implements Sandbox {
  readonly id: string;
  private files = new Map<string, string>();
  constructor(id = `mock-${Date.now().toString(36)}`) {
    this.id = id;
  }
  async exec(cmd: string): Promise<ExecResult> {
    return { exitCode: 0, stdout: `mock> ${cmd}\n`, stderr: "", durationMs: 1 };
  }
  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.files.set(path, typeof content === "string" ? content : Buffer.from(content).toString("utf8"));
  }
  async readFile(path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`mock-sandbox: file not found '${path}'`);
    return f;
  }
  async close(): Promise<void> {
    this.files.clear();
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
  e2b?: SandboxFactory;
  firecracker?: SandboxFactory;
}

export class SandboxDispatcher {
  constructor(private opts: SandboxDispatcherOpts) {}
  async create(kind: SandboxKind, runtimeOpts?: { template?: string; envVars?: Record<string, string> }): Promise<Sandbox> {
    if (kind === "mock") return (this.opts.mock ?? new MockSandboxFactory()).create(runtimeOpts);
    if (kind === "e2b") {
      if (!this.opts.e2b) throw new Error("sandbox kind 'e2b' requested but no E2bSandboxFactory configured. Pass { e2b: new E2bSandboxFactory(httpE2bClient({apiKey})) }.");
      return this.opts.e2b.create(runtimeOpts);
    }
    if (!this.opts.firecracker) throw new Error("sandbox kind 'firecracker-self-hosted' requested but no FirecrackerSandboxFactory configured.");
    return this.opts.firecracker.create(runtimeOpts);
  }
}
