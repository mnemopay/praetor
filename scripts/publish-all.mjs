#!/usr/bin/env node
/**
 * publish-all.mjs — fire the GitHub Actions publish workflow once per
 * Praetor package, in dependency-tier order, waiting for each to land
 * on npm before kicking the next.
 *
 * Pre-requisites (in order):
 *   1. NPM_TOKEN secret set on the mnemopay/praetor GitHub repo
 *      (Settings → Secrets and variables → Actions → New repository secret)
 *   2. node scripts/bump-versions.mjs <semver>
 *   3. node scripts/freeze-cli-deps.mjs
 *   4. git commit + push (workflow runs against pushed code)
 *
 * Usage:
 *   node scripts/publish-all.mjs                  # publish to "latest"
 *   node scripts/publish-all.mjs --tag next       # publish to "next" dist-tag
 *   node scripts/publish-all.mjs --start router   # resume from this package
 *   node scripts/publish-all.mjs --check          # dry-run, prints order + commands
 *
 * Dependency tiers (from RELEASE.md):
 *   Tier 0 — leaves: core, tools, scrape, knowledge, router, seo, design,
 *                    social, game, vision, voice, 3d
 *   Tier 1 — depend on tier 0: payments, agents, sandbox, business-ops,
 *                                game-assets, world-gen, mcp
 *   Tier 2 — sysadmin, computer-control, browser, coding-agent,
 *            research-agent, ugc
 *   Tier 3 — api, sdk
 *   Tier 4 — cli (must be last, depends on every other)
 *
 * Special: dashboard, desktop are private/scaffold — skip.
 */

import { execSync } from "node:child_process";

const TIERS = [
  ["core", "tools", "scrape", "knowledge", "router", "seo", "design", "social", "game", "vision", "voice", "3d"],
  ["payments", "agents", "sandbox", "business-ops", "game-assets", "world-gen", "mcp"],
  ["sysadmin", "computer-control", "browser", "coding-agent", "research-agent", "ugc"],
  ["api", "sdk"],
  ["cli"],
];

const SKIP = new Set(["dashboard", "desktop"]);

const args = process.argv.slice(2);
const tag = pluck(args, "--tag") || "latest";
const start = pluck(args, "--start");
const dryRun = args.includes("--check");

let started = !start;
const ordered = TIERS.flat().filter((p) => !SKIP.has(p));

console.log(`publishing ${ordered.length} package(s) to npm with --tag ${tag}`);
if (start) console.log(`resuming from: ${start}`);
if (dryRun) console.log("(dry run — no actions)\n");

for (const pkg of ordered) {
  if (!started) {
    if (pkg === start) started = true;
    else { console.log(`  skip (before start): ${pkg}`); continue; }
  }
  const cmd = `gh workflow run publish.yml -f package=${pkg} -f tag=${tag}`;
  console.log(`\n→ ${pkg}`);
  console.log(`  ${cmd}`);
  if (dryRun) continue;
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err) {
    console.error(`  workflow trigger failed for ${pkg}:`, err.message);
    console.error(`  resume with: node scripts/publish-all.mjs --start ${pkg}`);
    process.exit(1);
  }
  // Wait for the package to appear on npm before kicking the next.
  const targetVersion = await getLocalVersion(pkg);
  console.log(`  waiting for @praetor/${pkg}@${targetVersion} to land on npm...`);
  let landed = false;
  for (let i = 0; i < 60; i++) { // max 10 minutes
    await sleep(10000);
    try {
      const v = execSync(`npm view @praetor/${pkg}@${targetVersion} version`, { stdio: "pipe" }).toString().trim();
      if (v === targetVersion) { landed = true; break; }
    } catch { /* not yet */ }
    process.stdout.write(".");
  }
  console.log("");
  if (!landed) {
    console.error(`  timeout waiting for @praetor/${pkg}@${targetVersion}`);
    console.error(`  check the workflow run at https://github.com/mnemopay/praetor/actions`);
    console.error(`  resume with: node scripts/publish-all.mjs --start ${pkg}`);
    process.exit(1);
  }
  console.log(`  ✓ landed`);
}

console.log("\nall packages published.");

function pluck(arr, flag) {
  const i = arr.indexOf(flag);
  if (i < 0) return null;
  return arr[i + 1];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getLocalVersion(pkg) {
  const { readFile } = await import("node:fs/promises");
  const json = JSON.parse(await readFile(`packages/${pkg}/package.json`, "utf-8"));
  return json.version;
}
