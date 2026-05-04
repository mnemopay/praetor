# @praetor/cli

The Praetor agent runtime CLI. Run YAML mission charters with native
browser, sandbox, voice, screen, scrape, payment, and audit tools wired
in. Charter-driven, fiscally gated, audit-logged by default.

```bash
npm install -g @praetor/cli
```

## Quick start

```bash
# 1. Boot the api server in dev mode (no Supabase, no DB, in-memory)
PRAETOR_DEV_MODE=1 ANTHROPIC_API_KEY=sk-ant-... praetor serve

# 2. In another terminal, hit it
curl -X POST http://localhost:8788/api/v1/missions \
  -H "Authorization: Bearer dev:any" \
  -H "Content-Type: application/json" \
  -d '{"goal":"hello world"}'

# 3. Or run a charter directly without the api
praetor run charters/hello.yaml
```

## Commands

| Command | What it does |
|---|---|
| `praetor run <charter.yaml>` | Execute a YAML mission charter end-to-end |
| `praetor serve` | Boot the api server (auto-enables dev mode if `PRAETOR_DEV_MODE` unset) |
| `praetor smoke` | Run live-tool smoke tests against the registry |
| `praetor tools` | List every registered tool with metadata |
| `praetor doctor` | Diagnose env, registry, and config health |
| `praetor article12 --in <mission.json> --out <bundle-dir>` | Build EU AI Act Article 12 audit bundle |
| `praetor ingest <url>` | Add a URL to the knowledge base |
| `praetor design serve <dir>` | Serve a directory of design renders locally |

## Capabilities

The CLI ships with all native runtime packages wired:

- **Browser** — `browser_navigate / click / fill / press / snapshot / screenshot` via lazy-loaded `playwright-core`. DOM-first, Stagehand-shaped a11y outline.
- **Sandbox** — Mock / Local / **Docker** (with hardening defaults: `--memory 2g --cpus 2.0 --pids-limit 256 --read-only --cap-drop ALL --security-opt no-new-privileges`) / Firecracker stub. Auto-mode probes Docker.
- **Voice** — Kokoro 82M (Apache 2.0, native default) + Azure Speech adapter, license-family enforceable.
- **Screen capture** — native PowerShell / `screencapture` / grim / gnome-screenshot. No third-party lib.
- **Scrape** — native fetch + SSRF guard (default-on, blocks RFC1918 / loopback / 169.254 metadata) + JSON-LD + sitemap walker + X.com syndication path.
- **Coding agent** — `read_file / write_file / edit_file / apply_edit / list_files / grep_codebase / repo_map / find_symbol / load_conventions / git_* / run_tests / run_command` (16 tools).
- **Payment / fiscal gate** — MnemoPay adapter, Hold/Settle/Release pattern, FiscalGate caps every tool with `costUsd > 0`.
- **MCP server + client** — allow / deny tools, oversize-input guards, response caps.
- **Design pack** — PraetorScene → 9 native render targets (html, email, markdown, og-image, three-scene, react-remotion, hyperframes, video-mp4, claude-skill).
- **UGC pipeline** — portrait → motion (Sora 2 / Luma / Hedra / Seedance / kenburns) → voice → ffmpeg composite.
- **Game emit** — single-file HTML 2D + Three.js 3D + AABB physics + camera-follow.

## Charter example

```yaml
name: my-mission
goal: Scrape the top 5 Hacker News links and email me a summary
agents: [{ role: developer }]
budget: { maxUsd: 0.50, approvalThresholdUsd: 0.10 }
sandbox: { kind: auto }   # auto-detects Docker, falls back to mock
outputs: [summary]
```

```bash
praetor run my-mission.yaml
```

## Cost model

- Multi-turn agent loops use **prompt caching** by default — system prompt + tool definitions cached at 10× discount on read after the first call. 5–10× cost cut on multi-step charters.
- **Batch API** for `async: true` missions — 50% off both input and output tokens via Anthropic Batch.
- Every tool with `costUsd > 0` routes through the FiscalGate: budget reserved before execution, settled on success, released on error. Charters cannot exceed `budget.maxUsd`.

## Production deployment

For real auth + persistent storage, unset `PRAETOR_DEV_MODE` and supply:

```bash
SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
ANTHROPIC_API_KEY="..." \
MNEMOPAY_API_KEY="..." \
praetor serve
```

See [`DEPLOY.md`](https://github.com/mnemopay/praetor/blob/main/DEPLOY.md) in the repo root for the full deploy story (Docker, Fly.io, env matrix, rollback).

## License

Apache-2.0. Built by Jeremiah Omiagbo.
