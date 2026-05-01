#!/usr/bin/env node
/**
 * Tool registry smoke test.
 *
 * Builds the EXACT registry the CLI builds when running a charter (via the
 * `buildEnhancedRegistry` export from packages/cli) and reports which tools
 * are registered, any schema problems, and which tools were callable with a
 * safe no-op input.
 *
 * Usage:
 *   node scripts/smoke-tools.mjs
 *   node scripts/smoke-tools.mjs --run-safe        # also invoke pure-local tools
 */

const args = process.argv.slice(2);
const runSafe = args.includes("--run-safe");

const cli = await import("@praetor/cli").catch((err) => {
  console.error("Could not import @praetor/cli. Run `npm run build` first.");
  console.error(err.message);
  process.exit(1);
});

if (typeof cli.buildEnhancedRegistry !== "function") {
  console.error("@praetor/cli does not export buildEnhancedRegistry. Rebuild after pulling.");
  process.exit(1);
}

const charter = {
  name: "smoke",
  goal: "smoke test the tool registry",
  budget: { maxUsd: 1, approvalThresholdUsd: 0 },
  agents: [{ role: "developer" }],
  outputs: ["result"],
  plugins: [],
};

const reg = await cli.buildEnhancedRegistry(charter, "smoke-mission");
const tools = reg.list();

console.log(`\nPraetor enhanced tool registry — ${tools.length} tools registered\n`);

// Group by tag
const byTag = new Map();
for (const t of tools) {
  const tag = (t.tags && t.tags[0]) || "general";
  if (!byTag.has(tag)) byTag.set(tag, []);
  byTag.get(tag).push(t);
}

for (const [tag, list] of [...byTag.entries()].sort()) {
  console.log(`  [${tag}]`);
  for (const t of list) {
    const required = (t.schema?.required ?? []).join(", ");
    console.log(`    - ${t.name.padEnd(34)} (required: ${required || "none"})`);
  }
}

// Self-tests: invoke a few pure-local tools with safe inputs.
const safeProbes = [
  {
    name: "design_spline_preset",
    input: { presetId: "godly-3d-orb", title: "Smoke" },
  },
  {
    name: "analyze_content_seo",
    input: { text: "Praetor is a mission runtime for autonomous agents.", targetKeyword: "praetor" },
  },
  {
    name: "geo_outreach_sequence",
    input: { targetSite: "example.com", authorName: "Jane", niche: "AI" },
  },
  {
    name: "generate_og_images",
    input: { title: "Praetor — Mission Runtime" },
  },
  {
    name: "list_dir",
    input: { path: process.cwd() },
  },
];

let okCount = 0;
let failCount = 0;
let skipCount = 0;

if (runSafe) {
  console.log("\n── Invoking safe local tools ───────────────────────────────\n");
  for (const p of safeProbes) {
    if (!reg.has(p.name)) {
      console.log(`  ⊘ ${p.name.padEnd(28)} — not registered`);
      skipCount++;
      continue;
    }
    try {
      const out = await reg.call(p.name, p.input);
      const preview = typeof out === "string" ? out.slice(0, 80) : JSON.stringify(out).slice(0, 100);
      console.log(`  ✓ ${p.name.padEnd(28)} → ${preview}${preview.length >= 80 ? "…" : ""}`);
      okCount++;
    } catch (err) {
      console.log(`  ✗ ${p.name.padEnd(28)} → ${err.message}`);
      failCount++;
    }
  }
}

console.log(`\nTotal registered: ${tools.length}`);
if (runSafe) console.log(`Safe-probe results: ${okCount} ok · ${failCount} failed · ${skipCount} skipped`);
process.exit(failCount === 0 ? 0 : 1);
