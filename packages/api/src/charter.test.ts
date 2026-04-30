import { describe, expect, it } from "vitest";
import { buildCharter } from "./charter.js";

describe("buildCharter", () => {
  it("builds a charter with defaults", () => {
    const charter = buildCharter({ goal: "Ship a launch page" });
    expect(charter.goal).toBe("Ship a launch page");
    expect(charter.plugins).toEqual([]);
    expect(charter.budget.maxUsd).toBe(5);
    expect(charter.outputs).toEqual(["result"]);
  });

  it("respects explicit plugins and outputs", () => {
    const charter = buildCharter({
      goal: "Run mission",
      outputs: ["artifact"],
      plugins: ["@praetor/seo"],
    });
    expect(charter.plugins).toEqual(["@praetor/seo"]);
    expect(charter.outputs).toEqual(["artifact"]);
  });
});
