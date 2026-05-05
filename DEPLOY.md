# Praetor — deployment

This is the single source of truth for where Praetor's surfaces live, how
to ship updates, and which knobs matter. If you're standing up a new
deploy, start here. If you're updating an existing one, check the
"Update" section per surface.

## Surfaces

| Surface | Lives at | Builds from | Rolls out via |
|---|---|---|---|
| npm packages | `npmjs.com/package/@kpanks/<name>` | each `packages/<name>` | `gh workflow run publish.yml -f package=<name> -f tag=latest` |
| `praetor-api` | `praetor-api.fly.dev` (target) | repo-root `Dockerfile` | `fly deploy --remote-only --dockerfile ../../Dockerfile` from `packages/api` |
| Praetor Desktop | per-user installs | `packages/desktop` (scaffold) | `electron-builder` (not yet wired — see `packages/desktop/README.md`) |
| MnemoPay MCP | `mnemopay-mcp.fly.dev` | a separate repo (`mnemopay-sdk/`) | covered in `mnemopay-sdk/CLAUDE.md` — not Praetor's deploy story |

Praetor's repo only owns the first three rows. The MnemoPay MCP server is
listed for cross-reference because Praetor's `@kpanks/payments` adapter
calls it.

## CI

`.github/workflows/ci.yml`:
- Runs on every push to `main` / `master` and every PR.
- Matrix: Node 20 + 22.
- Pipeline: `npm ci` → `npm audit --audit-level=high` → `npm run build`
  (`tsc -b`) → `npm test` (`vitest run`) → metadata gate
  (`scripts/check-metadata.mjs`) → smoke (`scripts/smoke-test.mjs`).
- Every package's tests must pass; current baseline is **439/439 across
  41 files**. CI is the ratchet — never lower it.

## Publishing an npm package

The publish workflow takes a single input — the package name minus the
`@kpanks/` prefix — and pushes that one package to npm.

```bash
gh workflow run publish.yml -f package=browser -f tag=latest
```

Pre-flight automatic checks:
- The directory `packages/<name>/package.json` must exist.
- The package must NOT have `"private": true`. Refusing private packages
  is a guard against accidental publication of internal packages.
- `npm run build` and `npm test` must pass for the entire workspace
  before the publish step runs.

`tag=next` is appropriate for prereleases (e.g. `0.3.0-beta.1`); use
`tag=latest` for production releases.

Currently publishable packages (13):
- `@kpanks/browser`, `@kpanks/computer-control`, `@kpanks/core`,
  `@kpanks/design`, `@kpanks/game-assets`, `@kpanks/scrape`,
  `@kpanks/sdk`, `@kpanks/seo`, `@kpanks/social`, `@kpanks/ugc`,
  `@kpanks/vision`, `@kpanks/voice`, `@kpanks/world-gen`.

If you want to publish a workspace-private package (e.g. `@kpanks/cli`),
flip its `private` field first and double-check `publishConfig.access`.

## Self-hosting the api server (Docker)

The repo-root `Dockerfile` is multi-stage and builds the entire
workspace. The runtime image runs `@kpanks/api` on port `8788`.

```bash
docker build -t praetor:latest .
docker run -d --name praetor \
  -p 8788:8788 \
  -e SUPABASE_URL=… \
  -e SUPABASE_SERVICE_ROLE_KEY=… \
  -e ANTHROPIC_API_KEY=… \
  -v praetor-data:/app/.praetor \
  praetor:latest
```

Required env (the api fails to boot without them):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — for auth + mission DB.
  Use `http://localhost:54321` + `praetor-desktop-shim` for single-user
  local installs (the dashboard's createClient shim auto-signs `dev-user`).

Strongly recommended env (charters need at least one LLM key):
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`
- `MNEMOPAY_API_KEY` — wires real fiscal gating
- `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` — wires PraetorVoice's
  Azure adapter alongside the native Kokoro default

Volume `praetor-data` mounts at `/app/.praetor` so charter inboxes,
mission audit bundles, and the Article 12 evidence stream survive
restarts.

The container runs as **uid 10001** (`praetor` user) and exposes
`/health` for orchestrator probes (built-in `HEALTHCHECK`).

## Self-hosting on Fly.io

`packages/api/fly.toml` ships the canonical Fly config: DFW region,
shared-cpu-1x with 512 MB, auto-stop on idle, persistent volume at
`/app/.praetor`.

```bash
cd packages/api
fly launch --no-deploy --copy-config   # first run only
fly secrets set \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  ANTHROPIC_API_KEY="..."
fly deploy --remote-only --dockerfile ../../Dockerfile
```

The `--dockerfile ../../Dockerfile` argument is required — Fly defaults
to looking next to fly.toml, but our Dockerfile is at the repo root so
the build context can see all workspace packages.

## Praetor Desktop

The `packages/desktop` scaffold is in the repo, but binary builds are
not wired yet. To run it locally:

```bash
npm install electron --workspace=@kpanks/desktop --save-dev
npx tsc -b
cd packages/desktop && npx electron dist/main.js
```

Shipping `.exe` / `.dmg` / `.AppImage` installers requires
`electron-builder` configuration + per-platform code-signing certs.
That's its own deploy session — flagged in `packages/desktop/README.md`
as the v1 ship gap.

## Production knobs

- **Sandbox kind**: charters declare `sandbox: { kind: "auto" }` by
  default. The dispatcher probes Docker availability inside the
  container — yes, even container-in-container if the host exposes the
  Docker socket. Per `feedback_security_first_doctrine.md`, never mount
  `/var/run/docker.sock` without an explicit `refuseDangerousMounts:
  false` opt-out — the factory refuses by default.
- **Browser**: PraetorBrowser's `playwright-core` peer dep is *not* in
  the runtime image — install it explicitly inside any container that
  needs the `browser_*` tools, or schedule those charters to a separate
  worker pool. The longer-term fix is the `SandboxedBrowserAdapter`
  scaffold under `@kpanks/browser/src/sandboxed.ts`.
- **Voice**: same pattern as browser. `kokoro-js` is a peer dep; install
  in containers that need `voice_synthesize`. Azure Speech adapter has
  no peer install — just env keys.
- **Activity bus**: in-memory by default. For multi-replica deployments
  where one fly machine spawns missions and another serves SSE, replace
  the bus with a Redis or Postgres LISTEN/NOTIFY adapter (not yet
  shipped).

## Rollback

- npm packages: `npm dist-tag add @kpanks/<pkg>@<previous-version> latest`
- Fly: `fly releases` → pick a previous version → `fly releases rollback <version>`
- Docker: every build is tagged; pin to a SHA in production
  (`praetor:sha-<commit>`) and update via your orchestrator.

## What's missing (next deploy session)

- `electron-builder` config + code signing for desktop binaries.
- A canonical Praetor-Chromium Docker image so `SandboxedBrowserAdapter`
  can ship.
- Multi-region deploy if `praetor-api` ever needs SLA-grade latency.
- Centralized log shipping (today: stdout → fly logs / docker logs).
