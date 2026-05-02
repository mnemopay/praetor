import { describe, expect, it } from "vitest";
import { getToolCatalog } from "./tools.js";

describe("tool catalog", () => {
  it("exposes the live registry production metadata", async () => {
    const catalog = await getToolCatalog();

    expect(catalog.ok).toBe(true);
    expect(catalog.tools.length).toBeGreaterThan(0);
    expect(catalog.report.total).toBe(catalog.tools.length);
    expect(catalog.report.missingMetadata).toEqual([]);
    expect(catalog.tools.some((tool) => tool.metadata?.origin === "native")).toBe(true);
    expect(catalog.tools.every((tool) => tool.metadata?.costEffective !== undefined)).toBe(true);
  });
});
