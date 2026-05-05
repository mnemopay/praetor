/**
 * @kpanks/sdk is a re-export aggregator. The unit test here asserts that
 * every documented public symbol is actually exported, so a missing
 * upstream rename gets caught at CI time instead of at consumer-import time.
 */
import { describe, it, expect } from "vitest";
import * as sdk from "./index.js";

const REQUIRED_EXPORTS = [
  "validateCharter",
  "runMission",
  "PolicyEngine",
  "MerkleAudit",
  "ToolRegistry",
  "MockPayments",
  "MnemoPayAdapter",
] as const;

describe("@kpanks/sdk", () => {
  it.each(REQUIRED_EXPORTS)("re-exports %s as a non-undefined value", (name) => {
    expect((sdk as Record<string, unknown>)[name]).toBeDefined();
  });

  it("MockPayments is constructible from the sdk root", () => {
    expect(typeof sdk.MockPayments).toBe("function");
    const p = new sdk.MockPayments();
    expect(typeof p.reserve).toBe("function");
  });

  it("ToolRegistry is constructible from the sdk root", () => {
    expect(typeof sdk.ToolRegistry).toBe("function");
  });

  it("MerkleAudit is exported as a class or factory", () => {
    expect(sdk.MerkleAudit).toBeDefined();
  });

  it("does not expose unintended internals (no default export)", () => {
    expect((sdk as Record<string, unknown>).default).toBeUndefined();
  });
});
