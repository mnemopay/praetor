<div align="center">
  <h1>Praetor Engine</h1>
  <p><strong>The autonomous mission runtime for digital employees.</strong></p>
</div>

Praetor is not a wrapper around someone else's framework. It is a purpose-built, bare-metal runtime where a YAML mission charter transforms an AI into a fully autonomous digital employee capable of designing, scraping, marketing, and closing deals in the real world. 

Charter-driven. Fiscally gated via **MnemoPay**. Audit-logged by default to comply with **EU AI Act Article 12**.

## 🚀 The Native Stack

Unlike typical agent frameworks that require you to bolt on third-party APIs, Praetor ships with the entire kitchen sink natively wired into the agent's brain:

### 1. Business Operations (`@praetor/business-ops`)
The agent can autonomously run your business:
- **`send_email`**: Drafts and sends outbound campaigns via Maileroo.
- **`issue_invoice`**: Generates live, payable Stripe Checkout links.
- **`schedule_meeting`**: Books and manages appointments via Cal.com.
- **`upsert_contact`**: Maintains a continuous CRM pipeline memory.

### 2. Generative Engine Optimization (`@praetor/seo`)
Built for the AI search era (2025-2026):
- **IndexNow Pinging**: Instantly forces search engines to crawl new agent-generated pages.
- **Competitor GEO Profiling**: Scrapes competitor `<meta ai:description>`, JSON-LD schemas, and heading structures to reverse-engineer their ranking strategy.
- **Content Analysis**: Deterministic Flesch-Kincaid grading, semantic keyword density, and structural integrity checks.
- **Social Graphing**: Dynamically generates stunning 1200x630 OpenGraph images via Pollinations AI.
- **Automated Outreach**: Drops hyper-personalized 3-step email sequences for backlink hunting.

### 3. High-End Design (`@praetor/design`)
- Spawns interactive 3D **Spline** WebGL presets (`godly-3d-orb`, `ai-audit-shield`).
- Generates polished **CSS3D Parallax** UIs.
- Native React **Remotion** bindings for programmatically generating video ads.

### 4. Game Development (`@praetor/game-assets`)
- **Godot 4.4 Generators**: The agent can turn a one-sentence idea into a fully scaffolded, playable Godot 4.4 project, complete with code, generated sprite sheets, and tilemaps.

### 5. Memory & Scraping
- **Persistent Knowledge (`@praetor/knowledge`)**: 3-tier memory system (Working, Episodic, Semantic) backed by MnemoPay so agents remember past context across missions.
- **Scraper (`@praetor/scrape`)**: Crawl4AI-style DOM abstraction, falling back to Playwright headless routing, with Firecrawl available for complex JS environments.

---

## 🔒 Security & Compliance First

| Feature | Description |
| --- | --- |
| **Charter Schema** | Declarative YAML mission limiting the agent's goal, budget, and output contract. |
| **Fiscal Gating** | Missions cannot execute without a MnemoPay budget reserve. If an agent tries to overspend, the runtime hard-halts. |
| **Merkle Audit** | Every single action (tool call, HTTP request, email sent) is cryptographically chain-hashed (SHA-256) into a bundle that satisfies **EU AI Act Article 12** requirements. |

---

## 💻 Quick Start

### 1. Launch the Dashboard
Use the Multi-Modal Dashboard to spawn your digital employees visually:
```bash
npm install
npm run dev
```

### 2. Repository Identity & Test Coverage
The sole canonical source for this engine is **[github.com/mnemopay/praetor](https://github.com/mnemopay/praetor)**. 

Praetor is tested exhaustively before every release. It currently runs **over 200 rigorous unit and integration tests** (specifically, 205 passing tests in the active suite) testing the entire Merkle audit flow, sandbox environment, LLM adapters, side-effect controls, and rollback protections.

### 2. CLI Mission Execution
Run headless YAML charters directly from the terminal:
```bash
npm run build
npx praetor run charters/hello.yaml --article12 ./audit-bundle
```

## 🏗 Architecture Layout

```text
packages/core          charter schema + runtime + Merkle auditor
packages/cli           praetor binary
packages/payments      MnemoPay HITL wrapper
packages/dashboard     Multi-modal Vite+React UI for spawning missions
packages/agents        pluggable agent adapters (OpenClaw, Hermes, ReAct)
packages/design        Spline / Godly / Remotion + declarative-UI primitives
packages/seo           programmatic GEO/SEO surfaces (15+ AI crawler rules)
packages/ugc           portrait -> motion -> voiceover -> composite ad pipeline
packages/scrape        native scraping + sitemap walker
packages/knowledge     3-tier Vector knowledge base
packages/business-ops  outbound, billing, scheduling, CRM
packages/game-assets   Godot 4.4 project scaffolding & sprite generation
```

## 🏛 Why "Praetor"?

A Praetor was a Roman magistrate who held *imperium* — the absolute authority to command, judge, and account for the result. That is exactly what this runtime does: it holds authority over an AI mission, judges every cost, and accounts for every artifact and event in a tamper-evident ledger.

## License
Apache 2.0. Built by the MnemoPay Team.
