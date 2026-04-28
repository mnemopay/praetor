# Praetor

Mission runtime for autonomous agents.

OpenClaw + Hermes for orchestration. Claude Code for the developer surface. Claude
Design + Spline + Godly + AntiGravity + Hypeframes + Remotion for the visual /
motion surface. Declarative UI: hand the runtime a JSON tree, get HTML, video, or
animated frames out the other side. MnemoPay for the fiscal gate. Design and
GEO/SEO are native, not bolted on. EU AI Act Article 12 audit-log output ships
in the box.

## Status

Day zero. See `STATE.md` for the truth-record this repo started from.

## Hello-world

```bash
npm install
npm run build
npx praetor run charters/hello.yaml
```

A charter is a YAML mission. The runtime parses it, asks MnemoPay for a budget,
spawns an OpenClaw/Hermes agent, and writes a Merkle-proof audit log on completion.

## Layout

```
packages/core      charter schema + runtime + auditor
packages/cli       `praetor` binary
packages/payments  MnemoPay HITL wrapper
packages/agents    OpenClaw + Hermes adapters
packages/design    Spline / Godly / Claude Design / AntiGravity bindings
packages/seo       programmatic GEO/SEO page generation
charters/          example missions
docs/              architecture, roadmap, compliance notes
```

## License

MIT.
