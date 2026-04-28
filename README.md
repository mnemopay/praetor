# Praetor

**The mission runtime for autonomous agents.** Charter-driven. Fiscally gated.
Audit-logged by default. Design, video, scraping, knowledge, GEO/SEO and EU AI
Act compliance are native, not bolted on.

Praetor is not a fork of an agent framework. It is not a wrapper around someone
else's runtime. It is its own thing — built to be the layer where a charter
becomes a real thing in the world: a deployed page, a rendered ad, a scraped
corpus, a billed customer, a SHA-256 audit trail you can hand to a regulator.

## What makes Praetor different

| Capability | What ships in the box |
| --- | --- |
| **Charter schema** | Declarative YAML mission. Goal, budget, output contract, audit policy. |
| **Fiscal gate** | MnemoPay-backed budget reserve / settle. Mission cannot exceed its dollar ceiling. |
| **Merkle audit** | Every mission event chain-hashed (SHA-256) — EU AI Act Article 12 ready. |
| **Agent pack** | Pluggable adapters. OpenClaw + Hermes today; bring-your-own tomorrow. |
| **Design pack** | Spline, Godly, Claude Design, AntiGravity, Hypeframes, Remotion, declarative-UI. |
| **UGC pipeline** | portrait → motion → voiceover → composite. Paid + zero-cost backends, voice clone gated on a reference sample. |
| **GEO/SEO pack** | sitemap, robots, ai.txt, llms.txt, ai:description, og/twitter, JSON-LD, hreflang, FAQ / Article / Breadcrumb schemas, RSS, opensearch, security.txt, humans.txt. |
| **Scrape pack** | Crawl4AI-style HTML, sitemap walker, JSON-LD extractor, X-cookie auth path. Firecrawl as paid tier. |
| **Knowledge pack** | Vector knowledge base. In-memory by default; swap for MnemoPay recall on production. |
| **Business-ops pack** | Outbound email, billing, scheduling, invoice / quote, contact CRM. Mock + live adapters per surface. |

## Status

Day one. See `STATE.md` for the truth-record this repo started from.

## Hello-world

```bash
npm install
npm run build
npx praetor run charters/hello.yaml
```

A charter is a YAML mission. The runtime parses it, asks MnemoPay for a budget,
spawns an agent, writes a Merkle-proof audit log on completion, and emits the
declared outputs (page, video, ad, scraped corpus, billed receipt, etc.).

## Layout

```
packages/core          charter schema + runtime + Merkle auditor
packages/cli           praetor binary
packages/payments      MnemoPay HITL wrapper
packages/agents        pluggable agent adapters (OpenClaw, Hermes, BYO)
packages/design        Spline / Godly / Claude Design / AntiGravity / Hypeframes /
                       Remotion + declarative-UI primitive
packages/seo           programmatic GEO/SEO surface generation (15+ surfaces)
packages/ugc           portrait -> motion -> voiceover -> composite ad pipeline
packages/scrape        native scraping + sitemap walker + auth-cookie path
packages/knowledge     vector knowledge base; MnemoPay recall on prod
packages/business-ops  outbound, billing, scheduling, CRM
charters/              example missions
docs/                  architecture, roadmap, research, compliance notes
```

## Why "Praetor"

A Praetor was the Roman magistrate who held *imperium* — the authority to
command, judge, and account for the result. That is exactly what this runtime
does: it holds authority over a mission, judges every cost, and accounts for
every artifact and event in a tamper-evident ledger.

## License

MIT.
