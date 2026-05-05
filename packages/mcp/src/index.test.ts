import { describe, it, expect } from "vitest";
import { McpServer, McpClient, type McpClientTransport } from "./index.js";
import { ToolRegistry } from "@kpanks/tools";

function makeServerWithEcho() {
  const reg = new ToolRegistry();
  reg.register(
    { name: "echo", description: "echo back", schema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } },
    async ({ msg }) => ({ echoed: msg })
  );
  return new McpServer({ registry: reg });
}

/** In-memory transport that pipes a client straight to a server — for tests. */
function loopback(server: McpServer): McpClientTransport {
  return {
    async send(req) {
      const res = await server.handle(req);
      return res ?? { jsonrpc: "2.0", id: req.id ?? null };
    },
  };
}

describe("McpServer", () => {
  it("responds to initialize", async () => {
    const s = makeServerWithEcho();
    const r = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(r?.result).toMatchObject({ protocolVersion: "2024-11-05", serverInfo: { name: "praetor-mcp" } });
  });

  it("lists registered tools", async () => {
    const s = makeServerWithEcho();
    const r = await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const result = r?.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name)).toContain("echo");
  });

  it("calls a tool through tools/call", async () => {
    const s = makeServerWithEcho();
    const r = await s.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { msg: "hi" } } });
    const result = r?.result as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0].text)).toEqual({ echoed: "hi" });
  });

  it("returns -32601 for unknown methods", async () => {
    const s = makeServerWithEcho();
    const r = await s.handle({ jsonrpc: "2.0", id: 4, method: "unknown.method" });
    expect(r?.error?.code).toBe(-32601);
  });
});

describe("McpServer hardening", () => {
  function makeServerWithMany(allowTools?: string[], denyTools?: string[]) {
    const reg = new ToolRegistry();
    reg.register(
      { name: "safe_read", description: "read", schema: { type: "object", properties: {}, required: [] } },
      async () => ({ ok: true }),
    );
    reg.register(
      { name: "dangerous_write", description: "write", schema: { type: "object", properties: {}, required: [] } },
      async () => ({ ok: true }),
    );
    reg.register(
      { name: "destructive_run_command", description: "exec", schema: { type: "object", properties: {}, required: [] } },
      async () => ({ ok: true }),
    );
    return new McpServer({ registry: reg, allowTools, denyTools });
  }

  it("denyTools hides + rejects flagged tools", async () => {
    const s = makeServerWithMany(undefined, ["dangerous_write", "destructive_run_command"]);
    const list = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(["safe_read"]);
    const denied = await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dangerous_write", arguments: {} } });
    expect(denied?.error?.code).toBe(-32601);
    expect(denied?.error?.message).toMatch(/not exposed/);
  });

  it("allowTools restricts to a curated subset (deny wins on conflict)", async () => {
    const s = makeServerWithMany(["safe_read", "dangerous_write"], ["dangerous_write"]);
    const list = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(["safe_read"]); // dangerous_write hidden by deny
    const blocked = await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "destructive_run_command", arguments: {} } });
    expect(blocked?.error?.code).toBe(-32601);
  });

  it("rejects oversized arguments", async () => {
    const reg = new ToolRegistry();
    reg.register(
      { name: "echo", description: "echo", schema: { type: "object", properties: { data: { type: "string" } }, required: [] } },
      async (args) => args,
    );
    const s = new McpServer({ registry: reg, limits: { maxArgsBytes: 100 } });
    const huge = "x".repeat(10_000);
    const r = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { data: huge } } });
    expect(r?.error?.code).toBe(-32602);
    expect(r?.error?.message).toMatch(/exceed.*100 bytes/);
  });

  it("rejects malformed tool name (non-string or > 256 chars)", async () => {
    const s = makeServerWithMany();
    const longName = "x".repeat(300);
    const r = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: longName, arguments: {} } });
    expect(r?.error?.code).toBe(-32602);
  });
});

describe("McpClient (loopback)", () => {
  it("initializes + lists + calls tools end to end", async () => {
    const s = makeServerWithEcho();
    const c = new McpClient(loopback(s));
    const init = await c.initialize();
    expect(init.serverInfo.name).toBe("praetor-mcp");
    const tools = await c.listTools();
    expect(tools.map((t) => t.name)).toContain("echo");
    const result = await c.callTool("echo", { msg: "loopback" });
    expect(JSON.parse(result as string)).toEqual({ echoed: "loopback" });
  });
});
