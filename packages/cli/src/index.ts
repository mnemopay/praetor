#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { parse as parseYamlReal } from "yaml";
import {
  validateCharter,
  runMission,
  MerkleAudit,
  buildArticle12Bundle,
  type Charter,
  type MissionResult,
} from "@praetor/core";
import { MockPayments } from "@praetor/payments";
import { EchoAgent, LlmAgent, type AgentAdapter } from "@praetor/agents";
import { defaultScraper, type ScrapeBackend } from "@praetor/scrape";
import { chunkText, defaultKnowledgeBase } from "@praetor/knowledge";
import { DEFAULT_CATALOGUE, LlmRouter, registerDefaultProviders, type RouteRequirements } from "@praetor/router";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

function loadDotenv(...candidates: string[]): void {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      if (process.env[k] !== undefined) continue;
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  }
}

function pickAgent(charter: Charter): AgentAdapter {
  const env = process.env;
  const haveAny = env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY;
  if (!haveAny) return new EchoAgent();

  const registered = new Set<string>();
  if (env.ANTHROPIC_API_KEY) registered.add("anthropic");
  if (env.OPENAI_API_KEY) registered.add("openai");
  if (env.OPENROUTER_API_KEY) registered.add("openrouter");
  const catalogue = DEFAULT_CATALOGUE.filter((m) => registered.has(m.provider));

  const charterRoute = (charter as { route?: RouteRequirements }).route;
  const route: RouteRequirements = charterRoute ?? { quality: "fast" };

  const router = registerDefaultProviders(new LlmRouter(catalogue), env, { catalogue });
  return new LlmAgent(router, route);
}

function parseYaml(src: string): unknown {
  return parseYamlReal(src);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function writeBundle(outDir: string, charter: Charter, result: MissionResult, audit: MerkleAudit, operatorId?: string) {
  const bundle = buildArticle12Bundle({ charter, result, audit, operatorId });
  mkdirSync(outDir, { recursive: true });
  for (const f of bundle.files) {
    const target = join(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.body);
  }
  writeFileSync(join(outDir, "bundle.sha256"), bundle.bundleSha256 + "\n");
  return bundle;
}

async function cmdRun(args: string[]) {
  const charterPath = args[0];
  if (!charterPath) {
    console.error("usage: praetor run <charter.yaml> [--article12 <out-dir>] [--save <mission.json>]");
    exit(1);
  }
  const article12Out = flag(args, "--article12");
  const saveMission = flag(args, "--save");
  const operatorId = flag(args, "--operator");
  const verbose = args.includes("--verbose") || args.includes("-v");

  loadDotenv(
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "mnemopay-sdk", ".env"),
    resolve(process.cwd(), "..", "..", "mnemopay-sdk", ".env"),
  );

  const raw = readFileSync(charterPath, "utf8");
  const charter = validateCharter(parseYaml(raw));
  const audit = new MerkleAudit();
  if (verbose) {
    audit.on((event, chainHash, index) => {
      process.stderr.write(JSON.stringify({ i: index, ts: event.ts, type: event.type, chain: chainHash.slice(0, 12), data: event.data }) + "\n");
    });
  }
  const agent = pickAgent(charter);
  if (verbose) process.stderr.write(JSON.stringify({ agent: agent.name }) + "\n");
  const result = await runMission({
    charter,
    payments: new MockPayments(),
    agents: { run: async (c) => agent.run({ goal: c.goal, outputs: c.outputs, budgetUsd: c.budget.maxUsd }) },
    audit,
  });

  if (saveMission) {
    const record = {
      charter,
      result,
      audit: audit.toJSON(),
      operatorId,
    };
    mkdirSync(dirname(resolve(saveMission)), { recursive: true });
    writeFileSync(saveMission, JSON.stringify(record, null, 2));
  }

  const wantArticle12 = article12Out || charter.compliance?.article12;
  if (wantArticle12) {
    const dir = article12Out ?? charter.compliance?.auditLogPath ?? "./article12-bundle";
    const bundle = writeBundle(dir, charter, result, audit, operatorId);
    console.error(`[praetor] wrote ${bundle.files.length} Article 12 files to ${resolve(dir)} (sha256=${bundle.bundleSha256.slice(0, 12)}…)`);
  }

  console.log(JSON.stringify(result, null, 2));
}

async function cmdArticle12(args: string[]) {
  const inPath = flag(args, "--in") ?? flag(args, "--mission");
  const outDir = flag(args, "--out");
  const operatorId = flag(args, "--operator");
  if (!inPath || !outDir) {
    console.error("usage: praetor article12 --in <mission.json> --out <bundle-dir> [--operator <id>]");
    exit(1);
  }
  const record = JSON.parse(readFileSync(inPath, "utf8")) as {
    charter: Charter;
    result: MissionResult;
    audit: { events: { ts: string; type: string; data: Record<string, unknown> }[]; chain: string[] };
    operatorId?: string;
  };
  const audit = MerkleAudit.fromJSON(record.audit);
  if (!audit.verify()) {
    console.error("[praetor] WARNING: chain verification failed for mission record at " + inPath);
  }
  const bundle = writeBundle(outDir, record.charter, record.result, audit, operatorId ?? record.operatorId);
  console.log(JSON.stringify({
    files: bundle.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    bundleSha256: bundle.bundleSha256,
    out: resolve(outDir),
  }, null, 2));
}

async function cmdIngest(args: string[]) {
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("usage: praetor ingest <url> [--mission <id>] [--backend fetch|crawl4ai|playwright-mcp|firecrawl] [--chunk <chars>]");
    exit(1);
  }
  const missionId = flag(args, "--mission") ?? "default";
  const backend = (flag(args, "--backend") as ScrapeBackend | undefined) ?? "fetch";
  const chunkChars = Number(flag(args, "--chunk") ?? "1200");

  const scraper = defaultScraper();
  const r = await scraper.scrape({ url, backend });
  if (r.status >= 400) {
    console.error(`[praetor] scrape returned ${r.status} for ${url}`);
    exit(2);
  }
  const text = r.text ?? r.body;
  const pieces = chunkText(text, chunkChars);

  const kb = defaultKnowledgeBase({ missionId });
  const chunks = pieces.map((piece, i) => ({
    id: `${urlHash(url)}-${i}`,
    text: piece,
    source: url,
    metadata: {
      url,
      contentType: r.contentType,
      backend: r.backend,
      fetchedAt: r.fetchedAt,
      tier: "semantic" as const,
      partIndex: i,
      partCount: pieces.length,
    },
  }));
  const ing = await kb.ingest(chunks);
  console.log(JSON.stringify({
    url,
    backend: r.backend,
    status: r.status,
    chunks: pieces.length,
    ingested: ing.ingested,
    missionId,
    jsonLd: r.jsonLd?.length ?? 0,
  }, null, 2));
}

function urlHash(u: string): string {
  return createHash("sha1").update(u).digest("hex").slice(0, 12);
}

async function cmdDesignServe(args: string[]) {
  const sub = args[0];
  if (sub !== "serve") {
    console.error("usage: praetor design serve <dir> [--port <n>] [--host <h>]");
    exit(1);
  }
  const dir = args[1] ?? ".";
  const port = Number(flag(args, "--port") ?? "0");
  const host = flag(args, "--host") ?? "127.0.0.1";
  const { startDesignServer } = await import("./serve.js");
  const handle = await startDesignServer({ dir, port, host });
  const stop = () => { handle.close().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`praetor design serve: ${handle.url}`);
}

function usage(): never {
  console.error([
    "usage:",
    "  praetor run <charter.yaml> [--article12 <out-dir>] [--save <mission.json>] [--operator <id>] [--verbose]",
    "  praetor article12 --in <mission.json> --out <bundle-dir> [--operator <id>]",
    "  praetor ingest <url> [--mission <id>] [--backend fetch|crawl4ai|playwright-mcp|firecrawl] [--chunk <chars>]",
    "  praetor design serve <dir> [--port <n>] [--host <h>]",
  ].join("\n"));
  exit(1);
}

async function main() {
  const [, , cmd, ...rest] = argv;
  if (!cmd) usage();
  switch (cmd) {
    case "run": return cmdRun(rest);
    case "article12": return cmdArticle12(rest);
    case "ingest": return cmdIngest(rest);
    case "design": return cmdDesignServe(rest);
    default: usage();
  }
}

main().catch((e) => { console.error(e); exit(1); });
