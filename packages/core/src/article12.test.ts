import { describe, it, expect, vi } from "vitest";
import { buildArticle12Bundle } from "./article12.js";
import { MerkleAudit } from "./audit.js";
import type { Charter } from "./charter.js";

const charter: Charter = {
  name: "t",
  goal: "g",
  outputs: [],
  budget: { maxUsd: 1, approvalThresholdUsd: 0.5 },
  agents: [{ role: "developer" }],
};

describe("buildArticle12Bundle", () => {
  function fixture() {
    const audit = new MerkleAudit();
    audit.record("mission.start", { charter: "test" });
    audit.record("tool.call.ok", { name: "echo", estUsd: 0 });
    audit.record("mission.complete", { outputs: 1, spentUsd: 0 });
    return audit;
  }

  it("emits the 5 mandated files", () => {
    const audit = fixture();
    const bundle = buildArticle12Bundle({
      charter,
      result: { charterName: "t", status: "ok", spentUsd: 0, outputs: [], auditDigest: audit.finalize(), startedAt: "2026-04-28T00:00:00Z", finishedAt: "2026-04-28T00:00:01Z" },
      audit,
    });
    const paths = bundle.files.map((f) => f.path).sort();
    expect(paths).toEqual(["chain.txt", "events.csv", "events.json", "manifest.json", "mission.json"]);
  });

  it("each file has a sha256 checksum", () => {
    const audit = fixture();
    const bundle = buildArticle12Bundle({
      charter,
      result: { charterName: "t", status: "ok", spentUsd: 0, outputs: [], auditDigest: audit.finalize(), startedAt: "2026-04-28T00:00:00Z", finishedAt: "2026-04-28T00:00:01Z" },
      audit,
    });
    for (const f of bundle.files) {
      expect(f.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("retention defaults to 6 months", () => {
    const audit = fixture();
    const bundle = buildArticle12Bundle({
      charter,
      result: { charterName: "t", status: "ok", spentUsd: 0, outputs: [], auditDigest: audit.finalize(), startedAt: "2026-04-28T00:00:00Z", finishedAt: "2026-04-28T00:00:01Z" },
      audit,
    });
    const mission = JSON.parse(bundle.files.find((f) => f.path === "mission.json")!.body);
    expect(mission.retention.months).toBe(6);
    expect(mission.retention.retainUntil).toBe("2026-10-28T00:00:00.000Z");
  });

  it("bundleSha256 is deterministic for the same input", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));
    try {
      const a1 = fixture();
      const a2 = fixture();
      const result = { charterName: "t", status: "ok" as const, spentUsd: 0, outputs: [], auditDigest: a1.finalize(), startedAt: "2026-04-28T00:00:00Z", finishedAt: "2026-04-28T00:00:01Z" };
      const b1 = buildArticle12Bundle({ charter, result, audit: a1 });
      const b2 = buildArticle12Bundle({ charter, result, audit: a2 });
      expect(b1.files.find((f) => f.path === "events.csv")!.sha256).toBe(b2.files.find((f) => f.path === "events.csv")!.sha256);
      expect(b1.files.find((f) => f.path === "chain.txt")!.sha256).toBe(b2.files.find((f) => f.path === "chain.txt")!.sha256);
    } finally {
      vi.useRealTimers();
    }
  });

  it("verify reports clean chain", () => {
    const audit = fixture();
    const bundle = buildArticle12Bundle({
      charter,
      result: { charterName: "t", status: "ok", spentUsd: 0, outputs: [], auditDigest: audit.finalize(), startedAt: "2026-04-28T00:00:00Z", finishedAt: "2026-04-28T00:00:01Z" },
      audit,
    });
    const mission = JSON.parse(bundle.files.find((f) => f.path === "mission.json")!.body);
    expect(mission.chainVerified).toBe(true);
  });
});
