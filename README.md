<div align="center">
  <h1>Praetor</h1>
  <p><strong>The agent runtime you'd actually defend in front of a CISO.</strong></p>
  <p>Charter-driven · Fiscally gated · Audit-logged · Native-first</p>
</div>

> Praetor's governance primitives — Charter, FiscalGate, Article 12 audit bundle, MerkleAudit chain — now ship inside [`@mnemopay/sdk`](https://www.npmjs.com/package/@mnemopay/sdk) as the unified MnemoPay platform. This repo remains the reference runtime for self-hosted deployments.

```bash
npm install -g @kpanks/cli
PRAETOR_DEV_MODE=1 ANTHROPIC_API_KEY=sk-ant-... praetor serve
```

Praetor is an agent runtime for shipping autonomous missions to production. A charter is a YAML file that declares a goal, a budget, and the tools the agent may use. The runtime validates, dispatches, sandboxes, audits, and fiscally gates every action. Every default codepath is Praetor-native — third-party libs only enter as opt-in adapters.

Built for the buyer who needs to answer "how does the agent know what it's allowed to spend, what it's allowed to touch, and how do you prove it?" before they ship.

---

## What's in the box

The runtime is 25 packages, **489 tests passing across 41 test files**.

| Capability | Package |
|---|---|
| Multi-LLM routing with prompt caching + Batch API | `@kpanks/router` |
| Charter schema, mission lifecycle, Merkle audit, Article 12 bundle | `@kpanks/core` |
| HTTP api server (PraetorHTTP, no Express) + dashboard SSE | `@kpanks/api` |
| Web dashboard with chat-back UX | `@kpanks/dashboard` |
| Coding agent — 16 tools incl. `apply_edit`, `repo_map`, `find_symbol`, `load_conventions`, `git_*`, `run_tests` | `@kpanks/coding-agent` |
| DOM-first browser automation (lazy `playwright-core`, Stagehand-shaped a11y outline) | `@kpanks/browser` |
| Sandbox factory — Mock / Local / **Docker (hardened)** / Firecracker stub | `@kpanks/sandbox` |
| Native voice / TTS — Kokoro 82M default + Azure Speech, license-family enforceable | `@kpanks/voice` |
| Screen capture — native PowerShell / `screencapture` / grim | `@kpanks/vision` |
| Computer-use session — audit + activity-bus streaming | `@kpanks/computer-control` |
| Scrape — native fetch + SSRF guard + JSON-LD + sitemap + X.com syndication | `@kpanks/scrape` |
| Payments — MnemoPay HoldId / Settle / Release pattern | `@kpanks/payments` |
| MCP server + client (allow/deny tools, oversize guards) | `@kpanks/mcp` |
| Knowledge base — vector + chunking | `@kpanks/knowledge` |
| SEO / GEO emit — sitemap, robots, ai.txt, llms.txt, JSON-LD | `@kpanks/seo` |
| Design pack — PraetorScene → 9 native render targets incl. Remotion, Hyperframes, Three.js, **claude-skill bundle** | `@kpanks/design` |
| UGC video pipeline — portrait → motion (Sora 2 / Luma / Hedra / Seedance) → voice → ffmpeg | `@kpanks/ugc` |
| 3D world gen — TRELLIS / Hunyuan / Tripo / fal-sam / HY-World / Marble routing | `@kpanks/world-gen` |
| Web-native game engine — single-file HTML 2D + Three.js 3D + AABB physics + camera-follow | `@kpanks/game` |
| Godot 4.4 scaffolder | `@kpanks/game-assets` |
| Praetor Desktop (Electron wrapper) | `@kpanks/desktop` |
| Browser-in-Docker | `@kpanks/browser/sandboxed` |

---

## The "browser + sandbox + cache" stack

The runtime's three load-bearing capabilities, all native:

**Browser.** Charters can drive a real Chromium via CDP — log into admin panels, fill forms, scrape paywalled pages, click through anti-bot screens. DOM-first (12–17 percentage points more reliable than vision-driven on common tasks per industry benchmarks). Optional vision fallback via PraetorScreen for canvas-only / anti-bot pages.

**Sandbox.** Untrusted code runs with kernel-level isolation by default. The `DockerSandboxFactory` ships hardening defaults baked in: `--memory 2g`, `--cpus 2.0`, `--pids-limit 256`, `--read-only` rootfs + tmpfs at `/tmp`, `--cap-drop ALL`, `--security-opt no-new-privileges`. Refuses dangerous mounts (`/`, `/var/run/docker.sock`, `/proc`, `/sys`, `/etc`) by default. `kind: "auto"` probes Docker availability and falls back to mock.

**Cache.** Prompt caching on Anthropic + OpenAI is wired into the agent loop. Multi-turn missions cost ~10% of uncached after turn 1 (system prompt + tool definitions cached). Batch API for `async: true` missions takes another 50% off. The FiscalGate sees real discounted numbers.

A 10-turn coding charter that read 5 files + edited 3 + ran tests twice cost ~$1.50 input pre-ABC. After ABC: ~$0.20. **~7× cheaper, plus the charter can now actually browse and sandbox real code.**

---

## Governance is the floor, not a feature

Most agent frameworks treat governance as the user's problem. Praetor treats it as the default.

| Surface | What's enforced |
|---|---|
| **FiscalGate** | Every tool with `costUsd > 0` routes through `MnemoPay.hold()` before execution. Charters cannot exceed `budget.maxUsd`. Runaway agents hit the cap and abort. |
| **Article 12 bundle** | Merkle-rooted SHA-256 chain over every tool call, network request, file write. Satisfies EU AI Act Article 12 retention requirements. |
| **License-family enforcement** | Charters can declare `requireLicense: "apache_or_mit"` and the runtime refuses to dispatch to proprietary or restricted backends. |
| **Sandbox refuses dangerous mounts** | `/var/run/docker.sock`, `/proc`, `/sys`, `/etc`, `/root`, `C:\Windows`, `C:\Users` — all refused by default. Caller must explicitly opt out. |
| **SSRF guard** | `nativeHttpFetch` defaults to `denyInternal: true`. Blocks RFC1918 / loopback / 169.254 metadata / link-local. Manual redirect chase re-checks each hop; cookies / authorization stripped on cross-origin redirects. |
| **Tool argument validation** | JSON-schema validation at the registry layer. Shell-mode args refuse `&\|<>` `^` `$(` metacharacters. |
| **Audit-log redaction** | `redact()` strips `api_key` / `token` / `secret` / `password` / `auth` fields from every audit event, truncates strings >200 chars. |
| **MCP server hardening** | Allow / deny tool exposure, oversize-input refusal (256 KB args, 1 MB lines), response caps on the HTTP transport. |

See [`DEPLOY.md`](./DEPLOY.md) for the full security doctrine.

---

## Observability

Structured JSON logs ship by default — every runtime event is a JSON line on stdout/stderr, so `grep`, `jq`, and any log aggregator work out of the box.

- `log.info` / `log.error` are available from `import { log } from "@kpanks/core"` — no wiring needed.
- Set `SENTRY_DSN` in the environment and a `SentrySink` is auto-wired: `info`/`warn` become Sentry breadcrumbs, `error` calls `captureMessage`.
- Field redaction matches the audit-log redactor — `api_key`, `token`, `secret`, `password`, `auth` are scrubbed before any sink sees them.
- `PRAETOR_LOG_LEVEL=debug|info|warn|error` controls verbosity (default: `info`).

---

## Quick start

```bash
# Install
npm install -g @kpanks/cli

# Dev mode — no Supabase, no DB, in-memory
PRAETOR_DEV_MODE=1 ANTHROPIC_API_KEY=sk-ant-... praetor serve
# → http://localhost:8788

# Hit the api
curl -X POST http://localhost:8788/api/v1/missions \
  -H "Authorization: Bearer dev:any" \
  -H "Content-Type: application/json" \
  -d '{"goal":"summarize the top 5 Hacker News links"}'

# Or run a charter directly
praetor run charters/hello.yaml --article12 ./audit-bundle/

# 60-second end-to-end demo — 6 tools, real artifacts, Merkle-rooted audit
praetor run charters/demo-basic.yaml --article12 ./audit-bundle/
ls praetor-out/seo/      # generated SEO bundle
ls audit-bundle/         # Article 12 evidence

# Smoke-test the live registry against real services
praetor smoke

# List every tool the runtime exposes
praetor tools

# Diagnose your install
praetor doctor
```

For production deployment (real auth, persistent storage, Fly.io / Docker self-host) see [`DEPLOY.md`](./DEPLOY.md).

For the dev-mode quickstart with curl examples see [`PRAETOR_QUICKSTART.md`](./PRAETOR_QUICKSTART.md).

---

## Charter example

```yaml
name: my-mission
goal: Scrape the top 5 Hacker News links and email me a summary
agents: [{ role: developer }]
budget:
  maxUsd: 0.50
  approvalThresholdUsd: 0.10
sandbox: { kind: auto }    # auto-detects Docker, falls back to mock
outputs: [summary]
```

```bash
praetor run my-mission.yaml
```

The runtime will:
1. Validate the charter against the schema
2. Dispatch a Docker-isolated sandbox if Docker is available
3. Build a registry of tools the `developer` role is allowed to call
4. Run the agent loop (prompt-cached) under a $0.50 budget cap
5. Stream activity events to the dashboard SSE feed
6. Emit a Merkle-audited Article 12 bundle on completion

---

## Where Praetor sits

Praetor is the runtime layer — charter schema, mission lifecycle, FiscalGate budget enforcement, Article 12 audit bundle, native browser + sandbox + cache. It's the layer regulated enterprises sit on when they need governance + audit + cost caps from day one, and it's the layer solo and small-team builders sit on when they want a runtime + tools + payment + sandbox done for them, not stitched from eight npm packages.

It plays well with the rest of the agent ecosystem — Cursor / Claude Code / Codex CLI as the IDE surface, Devin / Replit for hosted long-running runs, Browser Use / Stagehand / Browserbase as alternate browser substrates, e2b / Modal / Daytona / Sprites as remote sandbox backends, Mem0 / Letta / Zep as alternate memory backends. Praetor consumes MnemoPay for trust + payments + memory.

---

## Architecture

```
packages/
  core               charter schema · runtime · Merkle audit · Article 12 bundler
  cli                praetor binary · run · serve · smoke · tools · doctor
  api                PraetorHTTP server · dashboard SSE · mission lifecycle
  dashboard          Vite chat UI · live activity feed · talk-back to running missions
  desktop            Electron wrapper (scaffold)
  router             multi-LLM router · prompt caching · Batch API
  payments           MnemoPay HoldId pattern · MockPayments
  agents             NativePraetorEngine · CoordinatorAgent · LlmAgent · EchoAgent
  coding-agent       16 tools · file ops · git · tests · repo_map · apply_edit
  research-agent     fetch_url · web_search · synthesize · ingest_kb
  scrape             native fetch · SSRF guard · JSON-LD · sitemap · X.com syndication
  browser            DOM-first browser automation · lazy playwright-core
  voice              Kokoro 82M default · Azure Speech adapter · license-pin
  vision             native screen capture (PowerShell / screencapture / grim)
  computer-control   PraetorComputerSession · audit · activity streaming
  sandbox            Mock · Local · Docker (hardened) · Firecracker stub
  sysadmin           sandbox-routed file/exec wrappers
  tools              ToolRegistry · FiscalGate · audit hooks
  mcp                MCP server + client (allow/deny tools, oversize guards)
  knowledge          vector KB · chunking
  seo                sitemap · robots · ai.txt · llms.txt · structured data
  design             PraetorScene → 9 render targets (html / remotion / hyperframes / claude-skill / etc)
  social             X · TikTok · cron stubs
  ugc                portrait → motion (Sora 2 / Luma / Hedra / Seedance) → voice → composite
  world-gen          TRELLIS · Hunyuan · Tripo · fal-sam · HY-World · Marble routing
  game               single-file HTML 2D + Three.js 3D + AABB physics
  game-assets        Godot 4.4 project scaffolder
  business-ops       email · billing · scheduling · CRM stubs
  sdk                public SDK aggregate
```

---

## Why "Praetor"?

A *praetor* in Roman law held *imperium* — the absolute authority to command, judge, and account for the result. That's what the runtime does: holds authority over an AI mission, judges every cost against a budget, accounts for every artifact and event in a tamper-evident Merkle ledger.

The Praetor stack inherits the same posture — opinionated defaults, governance as the floor, security-first.

---

## License

Apache-2.0. Built by Jeremiah Omiagbo (`jeremiah@getbizsuite.com`).
