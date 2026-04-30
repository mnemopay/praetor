import { describe, expect, it } from "vitest";
import { getPluginRegistry, validatePluginName } from "./marketplace.js";

describe("marketplace", () => {
  it("loads static plugin registry", () => {
    const plugins = getPluginRegistry();
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins[0]).toHaveProperty("name");
  });

  it("validates npm scoped plugin names", () => {
    expect(validatePluginName("@praetor/seo")).toBe(true);
    expect(validatePluginName("seo")).toBe(false);
    expect(validatePluginName("@praetor seo")).toBe(false);
  });
});
