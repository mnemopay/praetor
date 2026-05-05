#!/usr/bin/env node
/**
 * freeze-cli-deps.mjs — replace every "*" sibling-package dep in
 * packages/cli/package.json with the concrete version that sibling
 * has on disk. Required before the cli can be published; npm rejects
 * "*" wildcards on package.json deps when the package is itself
 * published.
 *
 * Usage:
 *   node scripts/freeze-cli-deps.mjs        # write
 *   node scripts/freeze-cli-deps.mjs --check  # dry-run
 *
 * Only touches deps where the value is exactly "*" — already-pinned
 * deps are left alone. Safe to run repeatedly.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const dryRun = process.argv.includes("--check");
const cliPkgPath = resolve("packages/cli/package.json");
const packagesDir = resolve("packages");

const cliJson = JSON.parse(await readFile(cliPkgPath, "utf-8"));
const siblings = await loadSiblings();

let changed = 0;
for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
  const deps = cliJson[section];
  if (!deps) continue;
  for (const [name, value] of Object.entries(deps)) {
    if (value !== "*") continue;
    const sibling = siblings.get(name);
    if (!sibling) {
      console.warn(`  ! ${name}: marked "*" but no sibling package found, leaving as-is`);
      continue;
    }
    if (!sibling.version) {
      console.warn(`  ! ${name}: sibling has no version, leaving "*"`);
      continue;
    }
    console.log(`  ${name}: "*" → "^${sibling.version}"`);
    deps[name] = `^${sibling.version}`;
    changed++;
  }
}

if (dryRun) {
  console.log(`\n(dry run) ${changed} dep(s) would be frozen.`);
} else {
  await writeFile(cliPkgPath, JSON.stringify(cliJson, null, 2) + "\n");
  console.log(`\n${changed} dep(s) frozen in packages/cli/package.json.`);
}

async function loadSiblings() {
  const map = new Map();
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const json = JSON.parse(await readFile(join(packagesDir, entry.name, "package.json"), "utf-8"));
      if (json.name) map.set(json.name, json);
    } catch {
      /* skip */
    }
  }
  return map;
}
