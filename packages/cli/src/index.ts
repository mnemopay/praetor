#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { validateCharter, runMission, MerkleAudit } from "@praetor/core";
import { MockPayments } from "@praetor/payments";
import { EchoAgent } from "@praetor/agents";

function parseYaml(src: string): unknown {
  // Trivial subset YAML parser for the day-zero hello-world charter. Replaced
  // with `yaml` package in the next commit once dependencies are accepted.
  const obj: Record<string, unknown> = {};
  const lines = src.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;
  let currentObject: Record<string, unknown> | null = null;
  for (const line of lines) {
    if (line.startsWith("  - ")) {
      if (!currentArray) continue;
      currentArray.push(parseInline(line.slice(4).trim()));
    } else if (line.startsWith("    ")) {
      if (currentObject) {
        const [k, ...rest] = line.trim().split(":");
        currentObject[k] = parseInline(rest.join(":").trim());
      }
    } else if (line.startsWith("  ")) {
      if (currentKey && typeof obj[currentKey] === "object" && obj[currentKey] !== null && !Array.isArray(obj[currentKey])) {
        const [k, ...rest] = line.trim().split(":");
        (obj[currentKey] as Record<string, unknown>)[k] = parseInline(rest.join(":").trim());
      }
    } else {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      currentKey = k.trim();
      if (v === "") {
        const next: Record<string, unknown> | unknown[] = lines[lines.indexOf(line) + 1]?.startsWith("  - ") ? [] : {};
        obj[currentKey] = next;
        currentArray = Array.isArray(next) ? next : null;
        currentObject = !Array.isArray(next) ? next : null;
      } else {
        obj[currentKey] = parseInline(v);
        currentArray = null;
        currentObject = null;
      }
    }
  }
  return obj;
}

function parseInline(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

async function main() {
  const [, , cmd, arg] = argv;
  if (cmd !== "run" || !arg) {
    console.error("usage: praetor run <charter.yaml>");
    exit(1);
  }
  const raw = readFileSync(arg, "utf8");
  const charter = validateCharter(parseYaml(raw));
  const audit = new MerkleAudit();
  const result = await runMission({
    charter,
    payments: new MockPayments(),
    agents: { run: async (c) => new EchoAgent().run({ goal: c.goal, outputs: c.outputs, budgetUsd: c.budget.maxUsd }) },
    audit,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); exit(1); });
