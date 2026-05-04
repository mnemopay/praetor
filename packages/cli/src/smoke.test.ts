import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSmoke, formatReport } from "./smoke.js";

describe("praetor smoke runner", () => {
  // The smoke runner builds the full enhanced registry which expects some
  // env vars (Supabase, etc) to be present in some adapters. We don't hit
  // those in safe mode, but the registry needs to *construct* without them.
  beforeAll(() => {
    process.env.SUPABASE_URL ??= "http://localhost";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
  });

  it("safe mode produces a valid report and skips destructive specs", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "smoke-test-"));
    const out = join(tmp, "report.json");
    const report = await runSmoke({
      live: false,
      // Limit to a couple of cheap specs so the unit test stays fast and
      // doesn't shell out to git/screenshot tooling that may not exist on
      // every CI image.
      include: ["geo_outreach_sequence", "ingest_knowledge", "search_knowledge"],
      reportPath: out,
    });
    expect(report.mode).toBe("safe");
    expect(report.total).toBeGreaterThan(0);
    expect(report.fail).toBe(0);
    // The destructive `send_email` spec must not have run.
    expect(report.results.find((r) => r.tool === "send_email")).toBeUndefined();
    expect(existsSync(out)).toBe(true);
    const persisted = JSON.parse(readFileSync(out, "utf8"));
    expect(persisted.mode).toBe("safe");
  });

  it("formatReport renders a tabular summary including uncovered tools", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "smoke-format-"));
    const out = join(tmp, "report.json");
    const report = await runSmoke({
      live: false,
      include: ["geo_outreach_sequence"],
      reportPath: out,
    });
    const text = formatReport(report);
    expect(text).toContain("praetor smoke (safe)");
    expect(text).toContain("geo_outreach_sequence");
    expect(text).toMatch(/pass=\d+ fail=\d+ skip=\d+/);
  });

  it("live-only specs are reported as skipped without --live", async () => {
    const report = await runSmoke({
      live: false,
      include: ["send_email"],
      reportPath: join(mkdtempSync(join(tmpdir(), "smoke-live-skip-")), "r.json"),
    });
    const send = report.results.find((r) => r.tool === "send_email");
    expect(send?.outcome).toBe("skip");
    expect(send?.note).toMatch(/--live/);
  });
});
