import { describe, it, expect } from "vitest";
import { validateCharter } from "./charter.js";
import { runMission } from "./runtime.js";
import { MerkleAudit } from "./audit.js";

describe("Praetor core runtime", () => {
  it("validates a charter and rejects malformed input", () => {
    expect(() => validateCharter({})).toThrow();
    expect(() =>
      validateCharter({ name: "x", goal: "y", budget: { maxUsd: 1, approvalThresholdUsd: 0 }, agents: [{ role: "developer" }], outputs: [] }),
    ).not.toThrow();
  });

  it("runs a mission, settles spend, and produces a non-empty audit digest", async () => {
    const charter = validateCharter({
      name: "hello",
      goal: "demo",
      budget: { maxUsd: 1, approvalThresholdUsd: 5 },
      agents: [{ role: "developer" }],
      outputs: ["hello.txt"],
    });
    const audit = new MerkleAudit();
    const result = await runMission({
      charter,
      payments: {
        reserve: async () => ({ holdId: "hold_1" }),
        settle: async () => undefined,
      },
      agents: {
        run: async () => ({ outputs: ["hello world"], spentUsd: 0.42 }),
      },
      audit,
    });
    expect(result.status).toBe("ok");
    expect(result.spentUsd).toBe(0.42);
    expect(result.outputs).toEqual(["hello world"]);
    expect(result.auditDigest).toHaveLength(64);
  });

  it("captures errors without settling phantom spend", async () => {
    const charter = validateCharter({
      name: "bad",
      goal: "fail",
      budget: { maxUsd: 1, approvalThresholdUsd: 5 },
      agents: [{ role: "developer" }],
      outputs: [],
    });
    const audit = new MerkleAudit();
    let settled = false;
    const result = await runMission({
      charter,
      payments: {
        reserve: async () => ({ holdId: "hold_2" }),
        settle: async () => { settled = true; },
      },
      agents: {
        run: async () => { throw new Error("boom"); },
      },
      audit,
    });
    expect(result.status).toBe("error");
    expect(settled).toBe(false);
    expect(result.auditDigest).toHaveLength(64);
  });
});
