#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\//, "");
const AUTHOR = "Jeremiah Omiagbo <jeremiah@getbizsuite.com>";
const LICENSE = "Apache-2.0";
const REPO_URL = "https://github.com/mnemopay/praetor.git";

const targets = ["package.json"];
for (const dir of readdirSync(join(ROOT, "packages"))) {
  const pkgPath = join("packages", dir, "package.json");
  try {
    statSync(join(ROOT, pkgPath));
    targets.push(pkgPath);
  } catch {}
}

const changes = [];
for (const rel of targets) {
  const abs = join(ROOT, rel);
  const before = readFileSync(abs, "utf8");
  const pkg = JSON.parse(before);
  const diff = [];

  if (pkg.author !== AUTHOR) {
    diff.push(`author: ${JSON.stringify(pkg.author ?? null)} -> "${AUTHOR}"`);
    pkg.author = AUTHOR;
  }
  if (pkg.license !== LICENSE) {
    diff.push(`license: ${JSON.stringify(pkg.license ?? null)} -> "${LICENSE}"`);
    pkg.license = LICENSE;
  }
  const dir = rel === "package.json"
    ? null
    : rel.replace(/[\\/]package\.json$/, "").replace(/\\/g, "/");
  const wantRepo = dir
    ? { type: "git", url: REPO_URL, directory: dir }
    : { type: "git", url: REPO_URL };
  if (JSON.stringify(pkg.repository) !== JSON.stringify(wantRepo)) {
    diff.push(`repository: ${JSON.stringify(pkg.repository ?? null)} -> ${JSON.stringify(wantRepo)}`);
    pkg.repository = wantRepo;
  }

  if (diff.length === 0) continue;
  writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n");
  changes.push({ file: rel, diff });
}

console.log(`fixed ${changes.length} package.json file(s)\n`);
for (const c of changes) {
  console.log(c.file);
  for (const d of c.diff) console.log(`  ${d}`);
}
