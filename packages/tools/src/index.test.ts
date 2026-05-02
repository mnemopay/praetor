import { describe, it, expect, vi } from "vitest";
import { ToolRegistry, defaultRegistry, type FiscalGate } from "./index.js";

describe("ToolRegistry", () => {
  it("registers + lists tools", () => {
    const reg = new ToolRegistry();
    reg.register(
      { name: "echo", description: "echoes input", schema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } },
      async ({ msg }) => ({ echoed: msg })
    );
    expect(reg.has("echo")).toBe(true);
    expect(reg.list()).toHaveLength(1);
    expect(reg.search("echo")).toHaveLength(1);
  });

  it("validates required fields", async () => {
    const reg = new ToolRegistry();
    reg.register(
      { name: "t", description: "x", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } },
      async () => "ok"
    );
    await expect(reg.call("t", {})).rejects.toThrow(/missing required field 'a'/);
  });

  it("validates type mismatches", async () => {
    const reg = new ToolRegistry();
    reg.register(
      { name: "t", description: "x", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] } },
      async () => "ok"
    );
    await expect(reg.call("t", { n: "not a number" })).rejects.toThrow(/must be number/);
  });

  it("rejects unknown additional fields when configured", async () => {
    const reg = new ToolRegistry();
    reg.register(
      { name: "t", description: "x", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
      async () => "ok"
    );
    await expect(reg.call("t", { junk: 1 })).rejects.toThrow(/unknown field 'junk'/);
  });

  it("invokes fiscal gate when cost > 0", async () => {
    const fiscal: FiscalGate = {
      approve: vi.fn(async () => undefined),
      settle: vi.fn(async () => undefined),
    };
    const reg = new ToolRegistry();
    reg.register(
      { name: "paid", description: "costs money", costUsd: 0.05, schema: { type: "object", properties: {}, required: [] } },
      async () => "done"
    );
    await reg.call("paid", {}, { fiscal });
    expect(fiscal.approve).toHaveBeenCalledTimes(1);
    expect(fiscal.settle).toHaveBeenCalledTimes(1);
  });

  it("settles with error when handler throws", async () => {
    const fiscal: FiscalGate = {
      approve: vi.fn(async () => undefined),
      settle: vi.fn(async () => undefined),
    };
    const reg = new ToolRegistry();
    reg.register(
      { name: "broken", description: "x", costUsd: 0.01, schema: { type: "object", properties: {}, required: [] } },
      async () => { throw new Error("boom"); }
    );
    await expect(reg.call("broken", {}, { fiscal })).rejects.toThrow("boom");
    expect((fiscal.settle as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({ error: "boom" });
  });

  it("default registry seeds public-api starter tools", () => {
    const reg = defaultRegistry();
    expect(reg.has("openweathermap.current")).toBe(true);
    expect(reg.has("coingecko.simple_price")).toBe(true);
    expect(reg.has("rest_countries.name")).toBe(true);
  });

  it("enforces allowedRoles during direct execution", async () => {
    const reg = new ToolRegistry();
    reg.register(
      {
        name: "host_write",
        description: "writes somewhere sensitive",
        schema: { type: "object", properties: {}, required: [] },
        allowedRoles: ["coding"],
      },
      async () => "ok"
    );
    await expect(reg.call("host_write", {}, { role: "developer" })).rejects.toThrow(/not allowed/);
    await expect(reg.call("host_write", {}, { role: "coding" })).resolves.toBe("ok");
  });
});
