import { describe, expect, it } from "vitest";
import { buildEnhancedRegistry } from "./index.js";
import { validateCharter } from "@praetor/core";

describe("Praetor runtime registry", () => {
  it("declares production metadata for every built-in runtime tool", async () => {
    const charter = validateCharter({
      name: "metadata-check",
      goal: "verify registry metadata",
      budget: { maxUsd: 1, approvalThresholdUsd: 0 },
      agents: [{ role: "developer" }],
      outputs: ["result"],
    });

    const registry = await buildEnhancedRegistry(charter, "metadata-check");
    const report = registry.productionReport();
    expect(report.total).toBeGreaterThan(20);
    expect(report.missingMetadata).toEqual([]);
    expect(report.byOrigin.native).toBeGreaterThan(0);
    expect(report.byState.stub).toBeGreaterThan(0);
  });
});
