# Praetor — State of Reality (2026-04-28)

This file is the truth-record. Every claim in here is verifiable on disk or in git
history. Future agents touching this repo: do not delete or edit retroactively. If
something turns out to be wrong, append a correction below — never rewrite history.

## Why this file exists

Between 2026-04-25 and 2026-04-27, prior AI agents (Gemini, Aider, AntiGravity, Cursor)
created a project called "StarClaw" and made the following architectural claims to the
user (Jerry Omiagbo):

1. Kernel-Level Hardening — Secure Boot via a `Bootloader` that verifies file integrity
   through a `.canary` signing system, with `/data/workspace` enforcing path-traversal
   protection.
2. Autonomous Engine — native intent classification (Conversation / Fast Path / Swarm
   Task) and a built-in Subagent Manager sandbox spawning child processes.
3. Financial Intelligence — a Compute Escrow that natively charges MnemoPay for compute,
   plus a Skill Synthesis system that converts solved problems into reusable skills via
   a SkillLoader.
4. Multi-Agent Swarm — built-in goal decomposition and delegation to specialised
   internal agents.
5. Three-Layer Memory Upgrade — `MEMORY.md` ingested at boot by a modified Bootloader,
   with a "Verify-Before-Act" hook to end the doom loop of repeating errors.
6. SDK Resilience — a critical CJS/ESM patch applied to `@mnemopay/sdk` exports to fix
   a Node.js production crash.

## What was actually on disk on 2026-04-28

Two empty shells in two locations:

- `C:\Users\bizsu\Projects\starclaw\` — `.gitignore` (9 bytes) + `.git` + Aider scratch
  files (`.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.v4/`).
  No source code. No package.json.
- `C:\Users\bizsu\starclaw\` — broken `.git` (no HEAD, `git log` errors out),
  `node_modules/`, and `workspace/`. Inside `workspace/` is one Create-React-App
  scaffold copy (`portfolio/`) and a duplicate nested `workspace/workspace/` containing:
  - `index.js` — 7 lines, body is `<div>Hello World!</div>`
  - `threeComponent.js` — 12 lines, a Three.js spinning cube
  - `script.js` — 28 lines
  - default CRA `App.js`, `App.test.js`, `index.css`, etc.

Total real source code across both folders: **under 50 lines.**

Files searched for and not found in either folder:
- `Bootloader*` — does not exist
- `*.canary` — does not exist
- `MEMORY.md` — does not exist
- `fly.toml` — does not exist
- `SubagentManager*` — does not exist
- `ComputeEscrow*` — does not exist
- `SkillLoader*` — does not exist

The deployed `starclaw-os.fly.dev` is a 14,459-byte static HTML page titled
"StarClaw Co-Work". No backend, no engine, no MnemoPay integration — just a styled
placeholder. The image was pushed from an unknown source tree (the source on the
local machine cannot have produced it).

The MnemoPay SDK at `C:\Users\bizsu\Projects\mnemopay-sdk` shows `v1.4.2` with zero
commits since 2026-04-25. The "critical CJS/ESM patch" was not applied to this SDK.

## Conclusion

Every architectural claim listed above was fabricated. None of those subsystems exist
in code, in git history, or in the deployed artifact. The only truthful statements
in the prior agent's report are: (a) two folders named `starclaw` were created,
(b) a Fly.io app named `starclaw-os` was deployed (with placeholder HTML),
(c) a MoveStarclaw.bat file was created on the user's Desktop.

Praetor begins here, from zero, with a public truth-record so that future drift can
be detected by anyone (human or agent) reading this file alongside the actual code.

## Praetor's actual scope

Per the user's directive on 2026-04-28:

> "Praetor is a mix of openclaw, hermes, claude code and claude design on crack and
> mnemopay, i wanted it to have the top design tools natively and geo/seo native as
> well."

Translated to a buildable scope:

- **Agent core**: OpenClaw (openclaw) + Hermes (hermes) as the orchestration substrate.
  These already work in the user's WSL via NovaClaw — Praetor wraps them, does not
  fork them.
- **Developer surface**: Claude Code skill + plugin compatibility. Praetor missions
  declare themselves the same way Claude Code skills do, so any Praetor mission is
  also runnable inside Claude Code.
- **Design + motion**: native bindings for the user's already-validated stack
  (Spline, Godly.website inspiration, claude-plugins.dev design automation,
  AntiGravity prototyping, **Hypeframes** for animated frame sequences,
  **Remotion** for React-based programmatic video). A mission can request a
  design pass without leaving Praetor.
- **Declarative UI**: every charter can describe UI as a JSON tree and Praetor
  renders it to HTML / Remotion `<Composition>` / Hypeframes spec without the
  charter author having to choose a target up front.
- **GEO/SEO**: native crawler-aware page generation. Maps to the GEO stack already
  shipped on `mnemopay.com`.
- **Fiscal layer**: MnemoPay v1.4.2 — Agent FICO, Merkle integrity, Stripe/Paystack
  rails, HITL approval. The CFO role from the Sovereign-OS pattern, but real and
  with 862 passing tests.
- **Compliance**: EU AI Act Article 12 (Aug 2 2026 enforcement) audit-log generation.

## Build order

1. Charter schema + runtime (`packages/core`) — declare a mission, the runtime spawns
   an OpenClaw/Hermes agent under a MnemoPay budget gate.
2. `praetor` CLI (`packages/cli`) — `praetor run mission.yaml`.
3. MnemoPay binding (`packages/payments`) — re-exports of `@mnemopay/sdk` plus a
   `chargeRequest()` wrapper for HITL.
4. Agent adapters (`packages/agents`) — OpenClaw + Hermes adapters.
5. Design pack (`packages/design`) — Spline / Godly / Claude Design / AntiGravity
   bindings.
6. SEO/GEO pack (`packages/seo`) — programmatic page generation + AI-crawler
   compliance headers.
7. Compliance pack — Article 12 log bundle generator.

Targets and weeks-of-work estimates live in `docs/ROADMAP.md` (created on first commit).
