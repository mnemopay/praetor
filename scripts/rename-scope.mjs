#!/usr/bin/env node
/**
 * rename-scope.mjs — rename the npm scope across the workspace.
 *
 *   node scripts/rename-scope.mjs @praetor @kpanks
 *
 * Touches:
 *   - packages/<pkg>/package.json: name, dependencies, devDependencies, peerDependencies
 *   - packages/<pkg>/src/**.ts, .tsx, .js, .mjs:  import / from / require strings
 *   - packages/<pkg>/dist/**:  cleared (rebuild after)
 *   - packages/<pkg>/README.md:  text mentions
 *   - root README.md, RELEASE.md, STATE.md, scripts/*.mjs:  text mentions
 *
 * What it DOESN'T touch:
 *   - Bin command names (the cli's `praetor` command stays `praetor`)
 *   - Brand text in marketing / docs that uses the word "Praetor"
 *   - GitHub repo URL (still mnemopay/praetor)
 *   - tsconfig.json references (use directory paths, not package names)
 *
 * Use --check to dry-run.
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--check");
const oldScope = args.find((a) => a.startsWith("@") && a !== "--check");
const newScope = args.find((a, i) => a.startsWith("@") && i > args.indexOf(oldScope));

if (!oldScope || !newScope) {
  console.error("usage: node scripts/rename-scope.mjs @oldscope @newscope [--check]");
  process.exit(1);
}

console.log(`renaming ${oldScope}/* → ${newScope}/*${dryRun ? " (dry run)" : ""}`);

const REPO_ROOT = resolve(".");
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".json", ".txt", ".yml", ".yaml"]);

let touched = 0;

async function walk(dir, fn) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    if (entry.name === "dist") continue;
    if (entry.name === ".git") continue;
    if (entry.name === ".tsbuildinfo") continue;
    if (entry.name.startsWith(".tsbuildinfo")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, fn);
    } else if (entry.isFile()) {
      await fn(path);
    }
  }
}

const oldPattern = new RegExp(escapeRe(oldScope) + "\\/", "g");
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

await walk(REPO_ROOT, async (path) => {
  const ext = extname(path);
  if (!TEXT_EXTS.has(ext)) return;
  // Skip lockfile — npm regenerates on next install.
  if (path.endsWith("package-lock.json")) return;
  // Skip vendored docs / node_modules artifacts.
  if (path.includes("/node_modules/") || path.includes("\\node_modules\\")) return;

  let content;
  try { content = await readFile(path, "utf-8"); }
  catch { return; }
  if (!content.includes(oldScope + "/")) return;

  const next = content.replace(oldPattern, newScope + "/");
  if (next === content) return;

  const matchCount = (content.match(oldPattern) || []).length;
  const rel = path.replace(REPO_ROOT, "").replace(/\\/g, "/");
  console.log(`  ${rel} (${matchCount} hit${matchCount === 1 ? "" : "s"})`);
  if (!dryRun) await writeFile(path, next);
  touched++;
});

console.log(`\n${touched} file(s) ${dryRun ? "would change" : "updated"}.`);
console.log(dryRun ? "" : "\nNext steps:\n  1. rm -rf node_modules + delete package-lock.json + npm install\n  2. npm test\n  3. git commit -am 'chore: rename npm scope @praetor → @kpanks'\n  4. node scripts/publish-all.mjs --tag latest");
