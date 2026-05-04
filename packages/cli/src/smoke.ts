/**
 * Praetor smoke runner — exercises every tool tagged `needs-live-test` (and
 * a few `ready` tools for confidence) against the live registry. Reports
 * pass / fail / skipped per tool with a short note.
 *
 * Two modes:
 *
 *   default (safe)   — runs only tools that have no external side effects
 *                      and don't burn credit. Network calls are limited to
 *                      well-known public test URLs (example.com, etc).
 *
 *   --live           — also runs tools that touch paid APIs / real
 *                      services (Stripe, Resend, Cal.com, Replicate, etc),
 *                      but only when the relevant env keys are present.
 *                      Tools whose env keys are missing are skipped with a
 *                      clear "missing X" reason.
 *
 * Output:
 *   - Human table on stdout with status + timing
 *   - JSON report at praetor-out/smoke-report.json (path overridable)
 *
 * Per `feedback_pre_ship_review.md` — never let a smoke run silently spend
 * money or send real emails by default. The user opts in with `--live`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Charter } from "@praetor/core";
import type { ToolDefinition, ToolRegistry } from "@praetor/tools";
import { buildEnhancedRegistry } from "./index.js";

export type SmokeOutcome = "pass" | "fail" | "skip";

export type SmokeArgsBuilder =
  | Record<string, unknown>
  | ((ctx: SmokeBuildContext) => Promise<Record<string, unknown>> | Record<string, unknown>);

export interface SmokeBuildContext {
  /** Throwaway temp dir for tools that write files. */
  tmpDir: string;
  /** Mission id matching the registry's. */
  missionId: string;
}

export interface SmokeSpec {
  /** Tool name in the registry. */
  tool: string;
  /** Args to pass into reg.call(). */
  args: SmokeArgsBuilder;
  /** "safe" runs by default; "live" only runs with --live + env present. */
  category: "safe" | "live";
  /** Optional role gate. Defaults to no role (only no-allowedRoles tools). */
  role?: string;
  /** Env vars whose absence skips this spec (with a clear reason). */
  requiresEnv?: string[];
  /** Return null on success, or a string explaining why the result is invalid. */
  expect?: (result: unknown) => string | null;
  /** Free-text note shown in the report. */
  note?: string;
}

export interface SmokeResult {
  tool: string;
  capability: string;
  outcome: SmokeOutcome;
  durationMs: number;
  note?: string;
  error?: string;
}

export interface SmokeReport {
  ranAt: string;
  mode: "safe" | "live";
  total: number;
  pass: number;
  fail: number;
  skip: number;
  results: SmokeResult[];
  /** Tools tagged needs-live-test in the registry but not exercised by any spec. */
  uncovered: string[];
}

export interface RunSmokeOptions {
  live?: boolean;
  include?: string[];
  exclude?: string[];
  reportPath?: string;
  charter?: Charter;
  missionId?: string;
}

const DUMMY_CHARTER: Charter = {
  name: "smoke-live-tools",
  goal: "Exercise every needs-live-test tool against the live registry.",
  agents: [{ role: "developer" }],
  outputs: [],
  budget: { maxUsd: 0, approvalThresholdUsd: 0 },
  sandbox: { kind: "mock" },
};

export async function runSmoke(opts: RunSmokeOptions = {}): Promise<SmokeReport> {
  const live = opts.live ?? false;
  const charter = opts.charter ?? DUMMY_CHARTER;
  const missionId = opts.missionId ?? "smoke-live-tools";
  const tmpRoot = await mkdtemp(join(tmpdir(), "praetor-smoke-"));

  const reg = await buildEnhancedRegistry(charter, missionId);
  const ctx: SmokeBuildContext = { tmpDir: tmpRoot, missionId };
  const specs = buildSpecs();

  const results: SmokeResult[] = [];
  const seenTools = new Set<string>();

  for (const spec of specs) {
    seenTools.add(spec.tool);
    if (opts.include && opts.include.length > 0 && !opts.include.some((p) => spec.tool.includes(p))) continue;
    if (opts.exclude && opts.exclude.length > 0 && opts.exclude.some((p) => spec.tool.includes(p))) continue;

    const def = reg.get(spec.tool);
    if (!def) {
      results.push({ tool: spec.tool, capability: "?", outcome: "skip", durationMs: 0, note: "tool not in registry" });
      continue;
    }
    const cap = def.metadata?.capability ?? "?";

    if (spec.category === "live" && !live) {
      results.push({ tool: spec.tool, capability: cap, outcome: "skip", durationMs: 0, note: "destructive — pass --live to run" });
      continue;
    }

    const missingEnv = (spec.requiresEnv ?? []).filter((k) => !process.env[k]);
    if (missingEnv.length > 0) {
      results.push({
        tool: spec.tool,
        capability: cap,
        outcome: "skip",
        durationMs: 0,
        note: `missing env: ${missingEnv.join(", ")}`,
      });
      continue;
    }

    const t0 = Date.now();
    try {
      const args = typeof spec.args === "function" ? await spec.args(ctx) : spec.args;
      const result = await reg.call<unknown>(spec.tool, args, { role: spec.role ?? "developer" });
      const validation = spec.expect ? spec.expect(result) : null;
      if (validation) {
        results.push({
          tool: spec.tool,
          capability: cap,
          outcome: "fail",
          durationMs: Date.now() - t0,
          error: validation,
          note: spec.note,
        });
      } else {
        results.push({
          tool: spec.tool,
          capability: cap,
          outcome: "pass",
          durationMs: Date.now() - t0,
          note: spec.note,
        });
      }
    } catch (err) {
      results.push({
        tool: spec.tool,
        capability: cap,
        outcome: "fail",
        durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
        note: spec.note,
      });
    }
  }

  const uncovered = listUncovered(reg, seenTools);
  const report: SmokeReport = {
    ranAt: new Date().toISOString(),
    mode: live ? "live" : "safe",
    total: results.length,
    pass: results.filter((r) => r.outcome === "pass").length,
    fail: results.filter((r) => r.outcome === "fail").length,
    skip: results.filter((r) => r.outcome === "skip").length,
    results,
    uncovered,
  };

  const path = opts.reportPath ?? resolve(process.cwd(), "praetor-out", "smoke-report.json");
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  return report;
}

function listUncovered(reg: ToolRegistry, covered: Set<string>): string[] {
  const all = reg.list();
  return all
    .filter((t: ToolDefinition) => t.metadata?.production === "needs-live-test")
    .map((t: ToolDefinition) => t.name)
    .filter((n) => !covered.has(n))
    .sort();
}

/* ─── Spec table ───────────────────────────────────────────────────────── */

function buildSpecs(): SmokeSpec[] {
  return [
    // --- Knowledge base: in-memory, no external creds ---
    {
      tool: "ingest_knowledge",
      category: "safe",
      args: { text: "Praetor smoke probe — ingest sentinel.", source: "smoke-runner" },
      expect: (r) => (typeof (r as { ingested?: number }).ingested === "number" ? null : "expected `ingested` number"),
    },
    {
      tool: "search_knowledge",
      category: "safe",
      args: { query: "smoke", limit: 3 },
      expect: (r) => (Array.isArray((r as { hits?: unknown[] }).hits) ? null : "expected `hits` array"),
    },

    // --- Native file generation: harmless, just writes to praetor-out ---
    {
      tool: "design_html_in_canvas_3d",
      category: "safe",
      args: {
        title: "Smoke Probe",
        background: "#0a0a0a",
        cards: [{ id: "intro", html: "<h1>hello</h1>" }],
      },
      expect: (r) => ((r as { success?: boolean }).success ? null : "design call did not return success"),
    },
    {
      tool: "publish_3d_scene",
      category: "safe",
      args: { id: "smoke-scene", glbUrl: "https://example.com/x.glb", title: "Smoke Scene" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "publish_3d_scene did not return success"),
    },
    {
      tool: "generate_seo_site",
      category: "safe",
      args: {
        origin: "https://smoke.praetor.dev",
        pages: [{ slug: "home", title: "Home", description: "Smoke", aiDescription: "Smoke", bodyMarkdown: "# Home" }],
      },
      expect: (r) => ((r as { success?: boolean }).success ? null : "generate_seo_site did not return success"),
    },
    {
      tool: "generate_game_assets",
      category: "safe",
      args: { id: "smoke-pong", goal: "Smoke probe game", spriteFrames: 0, textureTiles: 0, sfxCues: 0 },
      expect: (r) => ((r as { success?: boolean }).success ? null : "generate_game_assets did not return success"),
    },
    {
      tool: "geo_outreach_sequence",
      category: "safe",
      args: { targetSite: "https://example.com", authorName: "Smoke Author", niche: "AI agents" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "geo_outreach_sequence did not return success"),
    },

    // --- Native scraping (real network to example.com) ---
    {
      tool: "scrape_url",
      category: "safe",
      args: { url: "https://example.com/" },
      expect: (r) => {
        const status = (r as { status?: number }).status;
        return typeof status === "number" && status >= 200 && status < 300 ? null : `expected 2xx, got ${status}`;
      },
      note: "real HTTP fetch against example.com",
    },
    {
      tool: "profile_geo_competitor",
      category: "safe",
      args: { competitorUrl: "https://example.com/" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "profile_geo_competitor did not return success"),
    },

    // --- CRM contact upsert (writes file via business_ops) ---
    {
      tool: "upsert_contact",
      category: "safe",
      args: { email: "smoke@praetor.dev", name: "Smoke Probe", company: "Praetor", source: "smoke-runner", tags: ["smoke"] },
      expect: (r) => ((r as { success?: boolean }).success ? null : "upsert_contact did not return success"),
    },

    // --- World-gen: fall-through to mock when no API keys ---
    {
      tool: "generate_3d_model",
      category: "safe",
      args: { prompt: "a smoke test cube", detail: "draft", backend: "mock" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "generate_3d_model mock did not return success"),
      note: "forces backend=mock; live keys exercised in --live mode",
    },
    {
      tool: "generate_3d_world",
      category: "safe",
      args: { prompt: "a smoke test world", detail: "draft", backend: "mock" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "generate_3d_world mock did not return success"),
    },
    {
      tool: "edit_3d_scene",
      category: "safe",
      args: { assetUrl: "https://example.com/scene.ply", title: "Smoke" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "edit_3d_scene did not return success"),
    },

    // --- Sandbox-routed sysadmin tools (run inside MockSandbox by default) ---
    {
      tool: "sandbox_run_command",
      category: "safe",
      role: "coding",
      args: { command: "echo smoke" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "sandbox_run_command did not return success"),
    },
    {
      tool: "sandbox_write_file",
      category: "safe",
      role: "coding",
      args: { path: "smoke-probe.txt", content: "praetor smoke marker" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "sandbox_write_file did not return success"),
    },
    {
      tool: "sandbox_read_file",
      category: "safe",
      role: "coding",
      args: { path: "smoke-probe.txt" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "sandbox_read_file did not return success"),
    },
    {
      tool: "sandbox_list_dir",
      category: "safe",
      role: "coding",
      args: { path: "." },
      expect: (r) => ((r as { success?: boolean }).success ? null : "sandbox_list_dir did not return success"),
    },

    // --- Coding-agent tools (gated to role=coding) ---
    {
      tool: "git_status",
      category: "safe",
      role: "coding",
      args: {},
      expect: (r) => (Array.isArray((r as { not_added?: unknown[] }).not_added) ? null : "expected `not_added` array"),
    },
    {
      tool: "git_diff",
      category: "safe",
      role: "coding",
      args: {},
      expect: (r) => (typeof (r as { diff?: string }).diff === "string" ? null : "expected `diff` string"),
    },
    {
      tool: "git_branch",
      category: "safe",
      role: "coding",
      args: {},
      expect: (r) => (typeof (r as { current?: string }).current === "string" ? null : "expected `current` string"),
    },
    {
      tool: "git_log",
      category: "safe",
      role: "coding",
      args: { limit: 3 },
      expect: (r) => (Array.isArray((r as { commits?: unknown[] }).commits) ? null : "expected `commits` array"),
    },
    {
      tool: "write_file",
      category: "safe",
      role: "coding",
      args: ({ tmpDir }) => ({ path: relativeFromCwd(join(tmpDir, "smoke-write.txt")), content: "praetor smoke" }),
      expect: (r) => (typeof (r as { path?: string }).path === "string" ? null : "expected `path` string"),
      note: "writes a file inside the per-run tmp dir",
    },
    {
      tool: "run_tests",
      category: "live",
      role: "coding",
      args: {},
      expect: (r) => {
        const result = r as { exitCode?: number; stderr?: string; command?: string };
        if (typeof result.exitCode !== "number") return "expected `exitCode` number";
        if (result.exitCode === -1) return `runner could not spawn ${result.command}: ${result.stderr}`;
        // exitCode 1 from the test runner itself is a real test failure —
        // smoke considers that a fail too. Allow 0 (passed) and 130 (SIGINT).
        if (result.exitCode !== 0) return `tests exited ${result.exitCode}: ${(result.stderr ?? "").slice(-200)}`;
        return null;
      },
      note: "runs the project's test suite — slow; live-only",
    },

    // --- Vision: native screen capture ---
    {
      tool: "capture_screen",
      category: "live",
      args: {},
      expect: (r) => ((r as { ok?: boolean }).ok ? null : `capture_screen failed: ${(r as { error?: string }).error}`),
      note: "OS screenshot (PowerShell/screencapture/grim/...)",
    },

    // --- Browser: live-only because it lazy-launches Chromium via playwright-core ---
    {
      tool: "browser_navigate",
      category: "live",
      args: { url: "https://example.com" },
      expect: (r) => ((r as { success?: boolean }).success ? null : "browser_navigate did not return success"),
      note: "lazy-launches Chromium; requires `npm install playwright-core` + a Chromium binary on PATH",
    },
    {
      tool: "browser_snapshot",
      category: "live",
      args: { html: false },
      expect: (r) => {
        const out = r as { url?: string; a11y?: string };
        return typeof out.url === "string" && typeof out.a11y === "string" ? null : "expected url + a11y strings";
      },
      note: "depends on browser_navigate having run first in the same process",
    },

    // --- Live-only: external services with destructive side effects ---
    {
      tool: "send_email",
      category: "live",
      args: { to: "smoke@example.com", from: "smoke@praetor.dev", subject: "Praetor smoke", text: "smoke run" },
      requiresEnv: ["MAILEROO_API_KEY"],
      note: "sends a real email — only with MAILEROO_API_KEY",
    },
    {
      tool: "issue_invoice",
      category: "live",
      args: ({ missionId }) => ({
        id: `smoke-${missionId}`,
        customerEmail: "smoke@praetor.dev",
        customerName: "Praetor Smoke",
        lineItems: [{ description: "Smoke probe", quantity: 1, unitPriceUsd: 0.01 }],
      }),
      requiresEnv: ["STRIPE_SECRET_KEY"],
      note: "creates a Stripe invoice — use a TEST-mode key",
    },
    {
      tool: "schedule_meeting",
      category: "live",
      args: {
        title: "Praetor smoke",
        attendeeEmail: "smoke@praetor.dev",
        eventTypeSlug: "smoke",
      },
      requiresEnv: ["CAL_COM_API_KEY"],
      note: "books a Cal.com slot",
    },
    {
      tool: "submit_index_now",
      category: "live",
      args: ({}) => ({
        host: "praetor.dev",
        key: process.env.INDEXNOW_KEY ?? "",
        keyLocation: process.env.INDEXNOW_KEY_LOCATION ?? "https://praetor.dev/indexnow.txt",
        urlList: ["https://praetor.dev/"],
      }),
      requiresEnv: ["INDEXNOW_KEY", "INDEXNOW_KEY_LOCATION"],
      note: "publishes URLs to IndexNow",
    },
  ];
}

function relativeFromCwd(absolute: string): string {
  // The coding-agent file_tools require paths relative to repoRoot. We pass
  // the absolute tmp path through a relative-ish form by stripping cwd if
  // present; otherwise we just use the basename in the cwd.
  const cwd = process.cwd();
  if (absolute.startsWith(cwd)) {
    return absolute.slice(cwd.length).replace(/^[\\/]/, "");
  }
  // Fall back to a subpath under cwd so the safe() check passes.
  return join(".praetor", "smoke", "tmp.txt");
}

/* ─── CLI surface ──────────────────────────────────────────────────────── */

export function formatReport(report: SmokeReport): string {
  const lines: string[] = [];
  lines.push(`praetor smoke (${report.mode})`);
  lines.push(`ran ${report.total} specs at ${report.ranAt}`);
  lines.push(`pass=${report.pass} fail=${report.fail} skip=${report.skip}`);
  lines.push("");
  lines.push("name".padEnd(30) + "outcome".padEnd(8) + "ms".padEnd(7) + "note");
  lines.push("─".repeat(80));
  for (const r of report.results) {
    const note = r.error ?? r.note ?? "";
    lines.push(r.tool.padEnd(30) + r.outcome.padEnd(8) + String(r.durationMs).padEnd(7) + note.slice(0, 80));
  }
  if (report.uncovered.length > 0) {
    lines.push("");
    lines.push(`uncovered (no smoke spec for these needs-live-test tools, ${report.uncovered.length}):`);
    for (const n of report.uncovered) lines.push(`  - ${n}`);
  }
  return lines.join("\n");
}

export async function cmdSmoke(args: string[]): Promise<void> {
  let live = false;
  const include: string[] = [];
  const exclude: string[] = [];
  let reportPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--live") live = true;
    else if (a === "--include") include.push(args[++i]);
    else if (a === "--exclude") exclude.push(args[++i]);
    else if (a === "--out") reportPath = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`praetor smoke [--live] [--include <substring>] [--exclude <substring>] [--out <path>]`);
      return;
    }
  }
  const report = await runSmoke({ live, include, exclude, reportPath });
  console.log(formatReport(report));
  if (report.fail > 0) process.exitCode = 1;
}
