#!/usr/bin/env node
/**
 * load-charter.mjs — small autocannon-style harness for praetor-api.
 *
 * Fires N concurrent POSTs to /api/v1/missions and reports latency
 * percentiles + error rate. No third-party deps; pure Node fetch.
 *
 * Usage:
 *   node scripts/load-charter.mjs \
 *     --url https://praetor-api.fly.dev \
 *     --token <bearer> \
 *     --total 200 --concurrency 20 \
 *     --goal "summarize a bug report"
 *
 * Defaults:
 *   --url            $PRAETOR_API_URL or http://localhost:3000
 *   --token          $PRAETOR_API_TOKEN (required for auth)
 *   --total          100
 *   --concurrency    10
 *   --goal           "load-harness ping"
 *   --budgetUsd      0.05
 *   --timeoutMs      15000
 *   --warmup         3   (pre-flight requests, results discarded)
 *
 * Exit code: 0 if every response was 2xx, 1 otherwise.
 */

const args = parseArgs(process.argv.slice(2));
const URL_BASE = (args.url || process.env.PRAETOR_API_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = args.token || process.env.PRAETOR_API_TOKEN || "";
const TOTAL = Number(args.total ?? 100);
const CONCURRENCY = Number(args.concurrency ?? 10);
const GOAL = args.goal ?? "load-harness ping";
const BUDGET = Number(args.budgetUsd ?? 0.05);
const TIMEOUT_MS = Number(args.timeoutMs ?? 15_000);
const WARMUP = Number(args.warmup ?? 3);

if (!Number.isFinite(TOTAL) || TOTAL <= 0) die("--total must be a positive number");
if (!Number.isFinite(CONCURRENCY) || CONCURRENCY <= 0) die("--concurrency must be a positive number");
if (!TOKEN) console.error("[warn] no --token / PRAETOR_API_TOKEN set — requests will hit auth and 401");

const endpoint = `${URL_BASE}/api/v1/missions`;
const body = JSON.stringify({ goal: GOAL, budgetUsd: BUDGET });
const headers = {
  "content-type": "application/json",
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

console.log(`praetor load harness → ${endpoint}`);
console.log(`  total=${TOTAL} concurrency=${CONCURRENCY} budget=${BUDGET} timeout=${TIMEOUT_MS}ms warmup=${WARMUP}`);
console.log("");

async function fireOne() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  let status = 0;
  let bodyPreview = "";
  let err;
  try {
    const res = await fetch(endpoint, { method: "POST", headers, body, signal: ctrl.signal });
    status = res.status;
    if (!res.ok) bodyPreview = (await res.text()).slice(0, 80);
    else await res.text();
  } catch (e) {
    err = e?.name === "AbortError" ? "TIMEOUT" : (e?.message || String(e));
  } finally {
    clearTimeout(t);
  }
  const ms = Date.now() - startedAt;
  return { ms, status, err, bodyPreview };
}

async function runWave(count) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < count) {
      const myIdx = i++;
      if (myIdx >= count) return;
      out[myIdx] = await fireOne();
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, count) }, worker);
  await Promise.all(workers);
  return out;
}

(async () => {
  if (WARMUP > 0) {
    process.stdout.write(`warmup ${WARMUP} requests… `);
    await runWave(WARMUP);
    console.log("done.\n");
  }

  process.stdout.write(`firing ${TOTAL}… `);
  const startedAt = Date.now();
  const results = await runWave(TOTAL);
  const totalMs = Date.now() - startedAt;
  console.log(`done in ${totalMs}ms.`);
  console.log("");

  const ok = results.filter((r) => r.status >= 200 && r.status < 300);
  const fail = results.filter((r) => !(r.status >= 200 && r.status < 300));
  const lats = ok.map((r) => r.ms).sort((a, b) => a - b);
  const pick = (p) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(lats.length * p))] : 0);

  console.log("results:");
  console.log(`  ok           ${ok.length} / ${TOTAL}`);
  console.log(`  fail         ${fail.length} / ${TOTAL}`);
  console.log(`  rps          ${(TOTAL / (totalMs / 1000)).toFixed(2)}`);
  if (lats.length) {
    console.log(`  latency min  ${lats[0]}ms`);
    console.log(`  latency p50  ${pick(0.5)}ms`);
    console.log(`  latency p95  ${pick(0.95)}ms`);
    console.log(`  latency p99  ${pick(0.99)}ms`);
    console.log(`  latency max  ${lats[lats.length - 1]}ms`);
  }
  if (fail.length) {
    console.log("\nfail breakdown:");
    const byStatus = new Map();
    for (const r of fail) {
      const key = r.err ? `network:${r.err}` : `http:${r.status}`;
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }
    for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(28)} ${v}`);
    }
    const sample = fail.find((r) => r.bodyPreview);
    if (sample) console.log(`\nfirst fail body preview: ${sample.bodyPreview}`);
  }

  process.exit(fail.length ? 1 : 0);
})();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}
