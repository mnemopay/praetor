/**
 * @kpanks/mcp — MCP server + client adapters.
 *
 * The Model Context Protocol (modelcontextprotocol.io) is JSON-RPC 2.0 over
 * stdio (default) or HTTP/SSE. Praetor speaks MCP both directions:
 *
 *   - SERVER: expose ToolRegistry as an MCP server so external agents (Claude
 *     Desktop, Cursor, OpenAI Operator, custom hosts) can call Praetor tools.
 *
 *   - CLIENT: connect to any external MCP server and surface its tools inside
 *     a charter, gated by the same FiscalGate so a poisoned remote can't
 *     drain budget.
 *
 * This is a minimal, dependency-free transport. For the full MCP feature
 * surface (resources, prompts, sampling), wrap @modelcontextprotocol/sdk
 * around this when you ship — the JSON-RPC frame is identical.
 */

import type { ToolRegistry, ToolCallContext, FiscalGate } from "@kpanks/tools";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/* ─────────── SERVER (Praetor exposes tools) ─────────── */

export interface McpServerOptions {
  name?: string;
  version?: string;
  registry: ToolRegistry;
  ctx?: ToolCallContext;
  /**
   * If set, only tools whose name is in this list are exposed via tools/list
   * and callable via tools/call. Use this to publish a curated subset of
   * the registry to external MCP clients (Claude Desktop, Cursor, etc).
   */
  allowTools?: readonly string[];
  /**
   * If set, tools whose name matches are HIDDEN from tools/list and
   * REJECTED on tools/call. Layered on top of allowTools (deny wins).
   * Useful for blocking destructive tools like write_file / run_command
   * from being callable by external MCP clients while keeping them
   * available to internal charters.
   */
  denyTools?: readonly string[];
  /**
   * Stdio transport caps (defense against memory-exhaustion DoS):
   *   - maxLineBytes: drop any incoming line longer than this. Default 1 MB.
   *   - maxArgsBytes: refuse tools/call when the args JSON is larger.
   *     Default 256 KB.
   */
  limits?: {
    maxLineBytes?: number;
    maxArgsBytes?: number;
  };
}

const DEFAULT_MAX_LINE_BYTES = 1_048_576;     // 1 MB
const DEFAULT_MAX_ARGS_BYTES = 262_144;       // 256 KB

export class McpServer {
  private name: string;
  private version: string;
  private registry: ToolRegistry;
  private ctx: ToolCallContext;
  private allowTools?: ReadonlySet<string>;
  private denyTools?: ReadonlySet<string>;
  private maxArgsBytes: number;
  private maxLineBytes: number;

  constructor(opts: McpServerOptions) {
    this.name = opts.name ?? "praetor-mcp";
    this.version = opts.version ?? "0.0.1";
    this.registry = opts.registry;
    this.ctx = opts.ctx ?? {};
    this.allowTools = opts.allowTools ? new Set(opts.allowTools) : undefined;
    this.denyTools = opts.denyTools ? new Set(opts.denyTools) : undefined;
    this.maxArgsBytes = opts.limits?.maxArgsBytes ?? DEFAULT_MAX_ARGS_BYTES;
    this.maxLineBytes = opts.limits?.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  }

  /** True iff a tool name is callable through this MCP server. */
  private isToolExposed(name: string): boolean {
    if (this.denyTools?.has(name)) return false;
    if (this.allowTools && !this.allowTools.has(name)) return false;
    return this.registry.has(name);
  }

  async handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;
    try {
      switch (req.method) {
        case "initialize":
          return ok(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: this.name, version: this.version },
          });

        case "tools/list":
          return ok(id, {
            tools: this.registry
              .list()
              .filter((t) => this.isToolExposed(t.name))
              .map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.schema,
              })),
          });

        case "tools/call": {
          const name = req.params?.name as string;
          const args = (req.params?.arguments as Record<string, unknown>) ?? {};
          if (!name) return err(id, -32602, "params.name required");
          if (typeof name !== "string" || name.length > 256) {
            return err(id, -32602, "params.name must be a string ≤ 256 chars");
          }
          if (!this.isToolExposed(name)) {
            // Don't leak whether the tool exists in the wider registry —
            // external MCP clients only know about exposed tools.
            return err(id, -32601, `tool '${name}' not exposed via this server`);
          }
          // Cap argument size so a hostile client can't OOM the runtime.
          const argsSize = Buffer.byteLength(JSON.stringify(args), "utf8");
          if (argsSize > this.maxArgsBytes) {
            return err(id, -32602, `arguments exceed ${this.maxArgsBytes} bytes`);
          }
          const result = await this.registry.call(name, args, this.ctx);
          return ok(id, {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
            isError: false,
          });
        }

        case "ping":
          return ok(id, {});

        case "notifications/initialized":
          return null; // no response for notifications

        default:
          return err(id, -32601, `method '${req.method}' not found`);
      }
    } catch (e) {
      return err(id, -32000, (e as Error).message);
    }
  }

  /**
   * Run as a stdio MCP server. Reads JSON-RPC requests line-by-line on
   * stdin. Lines longer than `limits.maxLineBytes` are dropped (defense
   * against memory-exhaustion DoS). The server keeps running so a single
   * malformed / oversized line doesn't take it down.
   */
  async runStdio(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void> {
    let buffer = "";
    const maxLine = this.maxLineBytes;
    return new Promise((resolve) => {
      stdin.setEncoding?.("utf8");
      stdin.on("data", async (chunk: string) => {
        buffer += chunk;
        // Reset the buffer if it grows past the cap and contains no \n yet.
        if (buffer.length > maxLine && buffer.indexOf("\n") < 0) {
          buffer = "";
          stdout.write(JSON.stringify(err(null, -32700, `incoming line exceeds ${maxLine} bytes; buffer reset`)) + "\n");
          return;
        }
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          if (Buffer.byteLength(line, "utf8") > maxLine) {
            stdout.write(JSON.stringify(err(null, -32700, `line exceeds ${maxLine} bytes`)) + "\n");
            continue;
          }
          let req: JsonRpcRequest;
          try {
            req = JSON.parse(line);
          } catch {
            continue;
          }
          const res = await this.handle(req);
          if (res) stdout.write(JSON.stringify(res) + "\n");
        }
      });
      stdin.on("end", () => resolve());
    });
  }
}

/* ─────────── CLIENT (Praetor calls external tools) ─────────── */

export interface McpClientTransport {
  send(req: JsonRpcRequest): Promise<JsonRpcResponse>;
  close?(): Promise<void>;
}

/** HTTP+JSON transport — works for the new "streamable HTTP" servers. */
export class HttpTransport implements McpClientTransport {
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;
  constructor(
    private endpoint: string,
    private headers: Record<string, string> = {},
    opts: { timeoutMs?: number; maxResponseBytes?: number; fetchImpl?: typeof fetch } = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxResponseBytes = opts.maxResponseBytes ?? 8 * 1024 * 1024; // 8 MB
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }
  async send(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: JSON.stringify(req),
        signal: ac.signal,
      });
      // Size-limited body read to defend against a hostile MCP server
      // returning a 1 GB response that would OOM the client.
      const body = await readWithLimit(res, this.maxResponseBytes);
      return JSON.parse(body) as JsonRpcResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readWithLimit(res: Response, limit: number): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limit) {
        try { reader.cancel(); } catch { /* best-effort */ }
        throw new Error(`mcp http response exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  }
  return new TextDecoder("utf-8").decode(concatChunks(chunks));
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const c of chunks) length += c.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

/** Stdio transport — spawns a child process speaking MCP over stdin/stdout. */
export class StdioTransport implements McpClientTransport {
  private nextId = 1;
  private pending = new Map<number | string, (res: JsonRpcResponse) => void>();
  private buffer = "";
  constructor(private proc: { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; kill?: () => void }) {
    proc.stdout.setEncoding?.("utf8");
    proc.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const res = JSON.parse(line) as JsonRpcResponse;
          const cb = this.pending.get(res.id ?? -1);
          if (cb) {
            this.pending.delete(res.id ?? -1);
            cb(res);
          }
        } catch {
          /* ignore malformed line */
        }
      }
    });
  }
  async send(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req.id ?? this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.proc.stdin.write(JSON.stringify({ ...req, id }) + "\n");
    });
  }
  async close(): Promise<void> {
    this.proc.kill?.();
  }
}

export class McpClient {
  private nextId = 1;
  constructor(private transport: McpClientTransport) {}

  private async rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.transport.send({ jsonrpc: "2.0", id, method, params });
    if (res.error) throw new Error(`mcp ${method}: ${res.error.message}`);
    return res.result;
  }

  async initialize(clientName = "praetor-client", clientVersion = "0.0.1"): Promise<{ serverInfo: { name: string; version: string } }> {
    return this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    }) as Promise<{ serverInfo: { name: string; version: string } }>;
  }

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
    const r = (await this.rpc("tools/list")) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    return r.tools;
  }

  async callTool(name: string, args: Record<string, unknown>, fiscal?: FiscalGate): Promise<unknown> {
    if (fiscal) {
      // Tool cost is unknown until we call — quote a small reservation; settle on real result.
      await fiscal.approve({ tool: `mcp:${name}`, estUsd: 0.01, input: args });
    }
    try {
      const r = (await this.rpc("tools/call", { name, arguments: args })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
      if (r.isError) throw new Error(r.content?.[0]?.text ?? "mcp tool returned error");
      if (fiscal) await fiscal.settle({ tool: `mcp:${name}`, estUsd: 0.01 });
      return r.content?.[0]?.text;
    } catch (e) {
      if (fiscal) await fiscal.settle({ tool: `mcp:${name}`, estUsd: 0.01, error: (e as Error).message });
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }
}

/* ─────────── helpers ─────────── */

function ok(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function err(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
