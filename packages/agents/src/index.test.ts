import { describe, expect, it } from "vitest";
import { NativePraetorEngine } from "./index.js";
import type { LlmRouter } from "@praetor/router";
import { ToolRegistry } from "@praetor/tools";

describe("NativePraetorEngine", () => {
  it("enforces tool role allowlists for deterministic charter steps", async () => {
    const tools = new ToolRegistry();
    tools.register(
      {
        name: "host_write",
        description: "host write",
        schema: { type: "object", properties: {}, required: [] },
        allowedRoles: ["coding"],
      },
      async () => ({ ok: true }),
    );
    const router = {} as LlmRouter;
    const engine = new NativePraetorEngine(router, tools, {});

    await expect(
      engine.run({
        goal: "try host write",
        outputs: [],
        budgetUsd: 1,
        role: "developer",
        steps: [{ action: "host_write" }],
      }),
    ).rejects.toThrow(/not allowed/);

    await expect(
      engine.run({
        goal: "try host write",
        outputs: [],
        budgetUsd: 1,
        role: "coding",
        steps: [{ action: "host_write" }],
      }),
    ).resolves.toMatchObject({ spentUsd: 0 });
  });
});
