# @praetor/research-agent

Praetor's research agent. Composes web search, source fetch, structured
synthesis, and knowledge-base ingest into a single agent.

## Tool surface

| Tool          | Purpose                                                        | Free path |
|---------------|----------------------------------------------------------------|-----------|
| `search_web`  | Brave Search when `BRAVE_API_KEY` is set; DuckDuckGo otherwise.| Yes (DDG)  |
| `fetch_url`   | Fetch a primary source via `@praetor/scrape`.                  | Yes        |
| `synthesize`  | LLM merges hits + excerpts into Markdown with citations.       | Open-weight model option via router |
| `ingest_kb`   | Drop gathered text into the knowledge base.                    | Yes        |

All tools are role-gated to `research` and tagged `["research", "free"]`
where applicable.

## Cost-aware path

`RESEARCH_PREFER` controls the chain:

| Mode    | search_web first | synthesize route                           |
|---------|------------------|--------------------------------------------|
| quality | Brave (paid)     | `{ quality: "high" }` -> Sonnet/Opus/etc. |
| cost    | DuckDuckGo (free)| `{ quality: "balanced", maxUsdPer1K: 1 }` |

`WORLD_GEN_REQUIRE_LIVE=true` makes `search_web` throw instead of
returning zero hits when no backend works.

## Usage

```ts
import { ResearchAgent } from "@praetor/research-agent";
import { LlmRouter } from "@praetor/router";
import { ToolRegistry } from "@praetor/tools";

const router = new LlmRouter();
const tools = new ToolRegistry();
const agent = new ResearchAgent({ router, tools, toolContext: {} });

const r = await agent.run({
  goal: "Brief on the latest 3D world model open-source releases",
  outputs: [],
  budgetUsd: 0.5,
});
```

The agent's `kb` field exposes the knowledge base it ingests into; pass a
shared instance in production so multiple missions accumulate context.
