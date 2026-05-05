#!/usr/bin/env node
/**
 * bump-versions.mjs — set every workspace package's version to a target
 * value in lockstep. Required before the first coordinated npm publish.
 *
 * Usage:
 *   node scripts/bump-versions.mjs 0.1.0          # set every package to 0.1.0
 *   node scripts/bump-versions.mjs 0.2.0 --check  # dry-run, no writes
 *   node scripts/bump-versions.mjs --align        # set all to the highest existing version
 *
 * After bumping:
 *   1. Run scripts/freeze-cli-deps.mjs so cli's package.json no longer
 *      uses "*" as a dep version.
 *   2. Commit + tag the release.
 *   3. Run scripts/publish-all.mjs to fire the publish workflow per
 *      package in tier order.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

const args = process.argv.slice(2);
const dryRun = args.includes("--check");
const alignToHighest = args.includes("--align");
const target = args.find((a) => SEMVER_RE.test(a));

if (!alignToHighest && !target) {
  console.error("usage: node scripts/bump-versions.mjs <semver> [--check]   |   --align");
  process.exit(1);
}

const packagesDir = resolve("packages");
const entries = await readdir(packagesDir, { withFileTypes: true });
const packages = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const pkgPath = join(packagesDir, entry.name, "package.json");
  try {
    const json = JSON.parse(await readFile(pkgPath, "utf-8"));
    packages.push({ name: entry.name, path: pkgPath, json });
  } catch {
    /* package.json missing — skip */
  }
}

let resolvedTarget = target;
if (alignToHighest) {
  const versions = packages.map((p) => p.json.version).filter(Boolean).sort(cmpSemver);
  resolvedTarget = versions[versions.length - 1];
  console.log(`--align: highest existing version is ${resolvedTarget}`);
}

console.log(dryRun ? "(dry run — no writes)" : `bumping ${packages.length} packages to ${resolvedTarget}`);

let changed = 0;
for (const p of packages) {
  if (p.json.version === resolvedTarget) continue;
  console.log(`  ${p.name}: ${p.json.version || "(no version)"} → ${resolvedTarget}`);
  if (!dryRun) {
    p.json.version = resolvedTarget;
    await writeFile(p.path, JSON.stringify(p.json, null, 2) + "\n");
  }
  changed++;
}

console.log(`\n${changed} package(s) ${dryRun ? "would change" : "updated"}.`);

function cmpSemver(a, b) {
  const pa = a.split(/[.-]/).map((x) => (isNaN(+x) ? x : +x));
  const pb = b.split(/[.-]/).map((x) => (isNaN(+x) ? x : +x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}
