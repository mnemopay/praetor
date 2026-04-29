import { describe, it, expect } from "vitest";
import { McpServer, McpClient, type McpClientTransport } from "./index.js";
import { ToolRegistry } from "@praetor/tools";

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
