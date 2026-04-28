# Praetor Roadmap

## Day zero (this commit)

- Monorepo scaffold, TypeScript project references, Vitest.
- `@praetor/core` — charter schema, mission runtime, Merkle audit.
- `@praetor/payments` — `MockPayments` (works) + `MnemoPayAdapter` (interface, no
  hard dep on the SDK yet).
- `@praetor/agents` — `EchoAgent` (works) + OpenClaw/Hermes adapters (placeholders
  that throw until week 2).
- `@praetor/design` — interface only.
- `@praetor/seo` — minimal `renderPage` (works for a basic HTML emit).
- `@praetor/cli` — `praetor run <charter.yaml>` end-to-end with EchoAgent +
  MockPayments. This is the "functional" bar.
- `STATE.md` — disk-truth audit so future agents cannot drift undetected.

## Week 1 — make MnemoPay binding real

- Wire `MnemoPayAdapter` to the actual `@mnemopay/sdk` v1.4.2 client.
- HITL approval path: missions over `approvalThresholdUsd` block on
  `chargeRequest` until the user approves via the MnemoPay dashboard.
- Smoke test against the live MnemoPay test mode.

## Week 2 — OpenClaw + Hermes adapters

- `OpenClawAgent` runs against the user's NovaClaw stack in WSL.
- `HermesAgent` runs against `hermes v0.11.0` with the MnemoPay memory provider.
- Charter `agents` array now picks one adapter and dispatches.
- Mission cost is metered to MnemoPay per-token.

## Week 3 — Design + motion + SEO/GEO native

- Declarative UI primitive: JSON tree → HTML / Remotion / Hypeframes (day zero
  has the HTML target shipping; week 3 adds the other two targets).
- Spline binding (`<spline-viewer>` emit + scene URL pinning) — done day zero.
- Godly.website pattern library lifted into a token set.
- Claude Design hook: a charter can emit a Claude Code `.claude/skills/<name>/`
  bundle so the design lives next to the agent that uses it.
- AntiGravity scaffold export.
- **Remotion** binding: charter declares scenes, Praetor renders an MP4 via the
  user's existing dele-video pipeline.
- **Hypeframes** binding: charter declares a frame sequence, Praetor emits an
  animated landing-page artifact.
- `@praetor/seo` upgrade: real markdown renderer, structured data, sitemap
  rollup, AI-crawler conventions (`ai.txt`, `ai:description`, `llms.txt`).

## Week 4 — EU AI Act Article 12 mode + distribution

- Article 12 audit-log bundle generator: CSV + JSON + Merkle proof per mission,
  retention metadata baked in.
- Single-CTA landing page on `praetor.dev` (or whichever domain Jerry registers).
- Submit to Smithery, ClawHub, mcpservers.org per existing playbook.
- 50-prospect compliance / legal-ops outbound via Maileroo.

## Sovereignty stretch

- Self-hosted Firecracker microVM mode for sandboxing (alternative to e2b).
- Local-llama fallback model routing.
- Charter signing (`.canary` files done for real, not as a placeholder).
