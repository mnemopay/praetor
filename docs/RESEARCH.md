# Praetor — what to build, given the 2026 AI trajectory

Findings as of 2026-04-28, drawn from public surfaces (Microsoft, Letta, e2b,
EU Commission, MCP ecosystem, Xiaomi MiMo team, Cisco / Linux Foundation
AGNTCY) and from three X posts scraped on the same day. Every claim has a
source URL on file at `docs/sources.md`.

The point of this document is to decide what Praetor *should* be in twelve
months — not what it is on day one. Day-one scope is in `ROADMAP.md`.

## What changed in the agent stack between Q1 2026 and now

1. **MCP became the default tool-call protocol.** Public MCP server count is
   north of 5,000, monthly SDK downloads are 110M+, A2A v1.0 has 150+
   adopting orgs. MCP is no longer experimental — it is the bus.
2. **MCP security collapsed first, fixed second.** Public studies show 53% of
   MCP servers ship static secrets, only 8.5% use OAuth, and tool-poisoning
   benchmarks succeed at a 72.8% rate. The market is now actively buying
   gateway / governance solutions (Microsoft Agent Governance Toolkit, AGNTCY
   identity layer) on top of MCP.
3. **"Agent OS" framing won.** Letta, AWS Bedrock AgentCore, LangChain Deep
   Agents, and Microsoft Agent Framework all converged on a multi-tier
   architecture: state / memory / tool / governance / sandbox. Praetor sits
   exactly in this lane.
4. **Sandbox isolation standardized on Firecracker.** e2b cold-starts in
   ~150 ms with KVM hardware isolation. The same primitive is in AWS
   Bedrock AgentCore. Self-hosted Firecracker is the sovereign-mode answer.
5. **EU AI Act Article 12 enforcement is 96 days out.** August 2, 2026 is the
   high-risk-system deadline. Penalty is up to €15M or 3% of global turnover.
   No finalized technical standard yet (prEN 18229-1 + ISO/IEC DIS 24970 are
   both in draft). Whoever ships a working "Article 12 in a box" before
   August has a wedge.
6. **Open-weight models caught up at the high-context end.** Xiaomi MiMo-V2.5
   shipped MIT-licensed, 1M-token context, two flavors (Pro = agent + coding,
   ranks #1 on the new ClawEval benchmark; native omni-modal variant for the
   coast-to-coast UGC pipelines). The free tier is now genuinely production
   grade.

## What this means Praetor must do

### 1. Be an MCP server *and* an MCP client

Charter authors should be able to expose any Praetor mission as an MCP tool
and consume any MCP server as a charter capability. This is table stakes by
end of Q3 2026. Concretely:

- Ship `@praetor/mcp` with a server adapter (`praetor mcp serve`) and a
  client adapter (`charter.tools` lists MCP servers).
- Default to OAuth — never static secrets — to stay out of the 53% bucket.
- Wrap every outbound MCP call through MnemoPay's HITL fiscal gate so a
  poisoned tool cannot drain budget or reputation.

### 2. Ship Article 12 audit-log packs out of the box

The Merkle chain in `@praetor/core` already gives chain-of-custody. We need
the export bundle: mission metadata + every tool call + every model call +
every cost event, packaged as CSV + JSON + a Merkle root proof, with
retention metadata stamped on.

The product unlock: a `praetor article12` CLI command that produces a
regulator-handable archive in under 60 s. That is a buyable thing.

### 3. Ship a sovereign-mode microVM sandbox

Charters that touch real infrastructure want Firecracker isolation, not
shared Node processes. Two adapters:

- `e2b` (cloud) — call out to e2b's API for the 80% case.
- `firecracker-self-hosted` — for sovereign deploys (DARPA, EU agencies,
  insurance carriers post-Klaimee). Keeps Praetor on the EU procurement
  short-list.

### 4. Pluggable LLM router with open-weight fallback

The router is already implied in `@praetor/agents`. Make it explicit:

- OpenAI / Anthropic / Google for the hot path.
- OpenRouter as the universal fallback.
- **Xiaomi MiMo-V2.5-Pro** for the open-weight long-context lane (1M tokens,
  MIT) — runs locally for sovereign mode, runs on Together.ai or HF Inference
  for hosted.
- A charter declares its quality / cost / sovereignty requirements; the
  router picks. MnemoPay meters the spend.

### 5. Three-tier memory parity with Letta — through MnemoPay

Letta won the framing (core / archival / recall). MnemoPay's recall engine
already has 205 tests + Merkle integrity + the Hindsight observations port
(committed today). Wire it to charters as the default `@praetor/knowledge`
backend so Praetor matches Letta's coherence claim (500+ interaction context)
without owning a separate memory store.

### 6. Native scrape + knowledge ingestion

The `@praetor/scrape` pack already ships fetch + sitemap walk + JSON-LD
extraction. Add:

- `crawl4ai` adapter for richer extraction (already the user's default
  scraper per `feedback_scraping_default.md`).
- `playwright-mcp` adapter to bridge to authenticated surfaces.
- A `praetor ingest <url>` command that scrapes → chunks → embeds → stores
  in the knowledge backend. End-to-end pipeline in one command.

### 7. Run a real business

`@praetor/business-ops` already ships outbound / billing / scheduling / CRM
in mock mode. Production wiring:

- Maileroo for outbound (verified domain on getbizsuite.com per memory).
- Stripe live keys for billing (already on file in mnemopay-sdk/.env).
- Cal.com for scheduling (live link is in production today).
- Audit every business-ops event into the same Merkle chain so
  CRM mutations and billing events show up in Article 12 exports.

### 8. Be great at design + video

`@praetor/design` already emits Remotion + Hypeframes artifacts. Production
wiring:

- Hook the dele-video pipeline + ugc-pipeline so a charter can ask for
  "produce a 30-second ad about X" and get an MP4 rendered through Azure
  TTS + the user's existing Remotion templates.
- Ship a Spline scene library (the BizSuite 3D-orb hero, the MnemoPay
  particle field) as charter-callable presets so design quality is
  consistent across products.

## What Praetor *should not* try to be

- A new agent framework with a new tool-calling format. MCP wins. Praetor
  consumes and exposes MCP, period.
- A new memory system. Letta + MnemoPay-recall cover this.
- A new sandbox. Firecracker via e2b or self-hosted.
- A new model. We route to existing models.
- A new IDE. Cursor / Claude Code own that.

Praetor's wedge is **the layer that turns a charter into an audited business
event** — fiscal gate + Merkle audit + Article 12 export + the design / video /
scrape / business-ops surfaces a real mission needs to actually ship.

## Twelve-month bets

1. **Q2 2026** — Article 12 in a box ships, paid pilot or LOI from one EU
   compliance-buying ICP (insurance, DARPA, drone, MCP-server vendor in the
   53% static-secret bucket).
2. **Q3 2026** — sovereign-mode Firecracker sandbox + MnemoPay 3-tier memory
   default. EU procurement-ready.
3. **Q4 2026** — agent-as-service marketplace (charters as installable
   missions, billed through MnemoPay, audited by default).

## Sources

- [Microsoft — Agent Governance Toolkit](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/)
- [Microsoft Agent Framework Overview](https://learn.microsoft.com/en-us/agent-framework/overview/)
- [Agentic AI Foundation — open standards](https://intuitionlabs.ai/articles/agentic-ai-foundation-open-standards)
- [LangChain — runtime behind Deep Agents](https://www.langchain.com/conceptual-guides/runtime-behind-production-deep-agents)
- [AWS Bedrock AgentCore deep dive](https://joudwawad.medium.com/aws-bedrock-agentcore-deep-dive-6822e4071774)
- [Best multi-agent frameworks 2026](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [Letta — agent memory](https://www.letta.com/blog/agent-memory)
- [Mem0 vs Letta vs MemGPT — 2026 comparison](https://tokenmix.ai/blog/ai-agent-memory-mem0-vs-letta-vs-memgpt-2026)
- [E2B — enterprise AI agent cloud](https://e2b.dev/)
- [Firecracker microVM cold-start — Northflank](https://northflank.com/blog/daytona-vs-e2b-ai-code-execution-sandboxes)
- [Article 12 — record-keeping](https://artificialintelligenceact.eu/article/12/)
- [FireTail — Article 12 logging mandate](https://www.firetail.ai/blog/article-12-and-the-logging-mandate-what-the-eu-ai-act-actually-requires)
- [Help Net Security — EU AI Act logging requirements](https://www.helpnetsecurity.com/2026/04/16/eu-ai-act-logging-requirements/)
- X scrapes (2026-04-27): XiaomiMiMo (MiMo-V2.5 release), RodmanAi (public-apis directory), ihtesham2005 (RTK CLI).
