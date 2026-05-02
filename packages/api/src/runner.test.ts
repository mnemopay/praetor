import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { Charter } from "@praetor/core";

describe("runner charter serialization", () => {
  it("round-trips special characters and preserves all agents", () => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
    const charter: Charter = {
      name: "SaaS: Mission #1",
      goal: "Ship:\n- safe YAML\n# not a comment",
      budget: { maxUsd: 3.5, approvalThresholdUsd: 0 },
      agents: [{ role: "developer" }, { role: "auditor" }],
      outputs: ["artifact:one", "notes # public"],
      plugins: ["@praetor/seo"],
    };

    return import("./runner.js").then(({ toYaml }) => {
      const parsed = parse(toYaml(charter)) as Charter;
    expect(parsed.name).toBe(charter.name);
    expect(parsed.goal).toBe(charter.goal);
    expect(parsed.agents).toEqual(charter.agents);
    expect(parsed.outputs).toEqual(charter.outputs);
    expect(parsed.plugins).toEqual(charter.plugins);
    });
  });
});
