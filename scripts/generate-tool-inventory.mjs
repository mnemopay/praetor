#!/usr/bin/env node
/**
 * Generate docs/tool-inventory.json from the live ToolRegistry. Runs in CI
 * (or on demand via `npm run inventory`) to keep the inventory in sync with
 * the code. Per Praetor doctrine — every production tool must declare its
 * ToolProductionMetadata; this script makes the inventory self-documenting.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\//, "");
const OUT = join(ROOT, "docs", "tool-inventory.json");

const { defaultRegistry } = await import("../packages/tools/dist/index.js");
const reg = defaultRegistry();
const list = reg.list();
const report = reg.productionReport();

const inventory = {
  "as-of": new Date().toISOString().slice(0, 10),
  total: report.total,
  byOrigin: report.byOrigin,
  byState: report.byState,
  missingMetadata: report.missingMetadata,
  tools: list.map((t) => ({
    name: t.name,
    description: t.description,
    tags: t.tags ?? [],
    allowedRoles: t.allowedRoles ?? [],
    costUsd: t.costUsd ?? 0,
    metadata: t.metadata ?? null,
  })),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(inventory, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT}`);
console.log(`  ${inventory.total} tools, ${report.missingMetadata.length} missing metadata`);
console.log(`  byOrigin: ${JSON.stringify(report.byOrigin)}`);
console.log(`  byState: ${JSON.stringify(report.byState)}`);
