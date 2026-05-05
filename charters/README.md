# Praetor — example charters

Three charters at different "fidelity" levels. Run any of them with:

```bash
praetor run charters/<charter>.yaml [--article12 ./audit-bundle/]
```

## `hello.yaml` — smallest possible charter

Single-step deterministic charter. Writes `Hello, World` to a file. Zero
LLM, zero peer deps, zero budget, zero network. Useful for confirming
your install works.

```bash
praetor run charters/hello.yaml
cat hello.txt
```

## `demo-basic.yaml` — 6-tool deterministic demo

Exercises six different Praetor packages without any LLM provider:

| Step | Tool | Package |
|---|---|---|
| 1 | `scrape_url` | `@kpanks/scrape` (native fetch + SSRF guard) |
| 2 | `profile_geo_competitor` | `@kpanks/seo` |
| 3 | `geo_outreach_sequence` | `@kpanks/seo` |
| 4 | `generate_seo_site` | `@kpanks/seo` |
| 5 | `ingest_knowledge` | `@kpanks/knowledge` |
| 6 | `upsert_contact` | `@kpanks/business-ops` |

Output:
- `praetor-out/seo/` — sitemap.xml, robots.txt, ai.txt, llms.txt, schema.jsonld, index/index.html
- `audit-bundle/` (if `--article12` passed) — Merkle-rooted Article 12 evidence

```bash
praetor run charters/demo-basic.yaml --article12 ./audit-bundle/
ls praetor-out/seo/
ls audit-bundle/
```

Runtime: ~3-5 seconds. No keys. No internet beyond the example.com
fetch (which returns 200 OK reliably).

## `demo-full.yaml` — LLM-driven version of the same demo

Same goal, but an LLM agent decides the plan from the natural-language
`goal` string. Exercises:

- **Prompt caching** — system prompt + tool definitions cached after turn 1
- **FiscalGate budget enforcement** — caps total spend at $0.20
- **Article 12 audit bundle** — Merkle-rooted SHA-256 chain over every tool call
- **Multi-LLM routing** — picks Anthropic / OpenAI / OpenRouter based on which `*_API_KEY` is set

```bash
ANTHROPIC_API_KEY=sk-ant-... praetor run charters/demo-full.yaml --article12 ./audit-bundle/
```

Runtime: ~20-60 seconds depending on the model. Cost: under $0.05 with
caching enabled (the cache hit on the second LLM call drops input cost
to 10%).

Requires at least one LLM API key. Optionally:
- `npm install playwright-core` → unlocks `browser_*` tools (the agent may use them)
- `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` → unlocks `voice_synthesize`
- Docker daemon running → auto-sandbox picks `docker` instead of `mock`

## What to verify after running

```bash
# 1. The seed pages exist
ls praetor-out/seo/

# 2. The Article 12 bundle has a Merkle root
cat audit-bundle/manifest.json | head

# 3. The mission completed cleanly (exit 0)
echo $?
```

## What these charters prove

- **Native runtime works.** `scrape_url` ran without `got-scraping`. SEO emit ran without third-party templating. KB stored without an external vector store.
- **Governance is enforced.** The audit bundle contains every tool call. The fiscal gate refuses any tool whose `costUsd > 0` if the budget is exhausted.
- **Stack is composable.** Six packages exercised in one charter. Each tool independently testable; together they form a working flow.

These are the proof points for the `README.md` claims. If a teammate
asks "what does Praetor actually do?", run `demo-basic.yaml` in front
of them and walk through the produced files.
