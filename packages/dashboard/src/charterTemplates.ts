// Twelve prebuilt charter templates for the gallery.
// "Use template" forks the YAML into a new mission with the goal pre-filled.

export interface CharterTemplate {
  id: string;
  title: string;
  category: "growth" | "engineering" | "compliance" | "research" | "ops";
  goal: string;
  description: string;
  estCostUsd: number;
  estDurationSec: number;
  tools: string[];
}

export const CHARTER_TEMPLATES: CharterTemplate[] = [
  {
    id: "competitor-price-watch",
    title: "Competitor price watch",
    category: "growth",
    goal: "Scrape pricing pages of 3 competitors, parse tier/price into structured JSON, and write a comparison report to ./out/pricing-watch.md.",
    description: "Daily standing brief on what competitors charge.",
    estCostUsd: 0.04,
    estDurationSec: 30,
    tools: ["scrape_url", "profile_geo_competitor", "write_file"],
  },
  {
    id: "geo-audit-mnemopay",
    title: "GEO/SEO audit (any URL)",
    category: "growth",
    goal: "Scrape a target URL, profile GEO surface (title, JSON-LD, headings, llms.txt), score AI-discoverability 0-100, and emit fix recommendations.",
    description: "Find every place an AI engine can't read your site.",
    estCostUsd: 0.02,
    estDurationSec: 20,
    tools: ["scrape_url", "profile_geo_competitor", "write_file"],
  },
  {
    id: "github-triage",
    title: "GitHub issue triage",
    category: "engineering",
    goal: "Pull 20 most recent open issues from a target repo, classify each (bug/feat/docs/chore), score severity 1-5, recommend assignee. Emit triage.csv.",
    description: "Inbox-zero your GitHub before standup.",
    estCostUsd: 0.06,
    estDurationSec: 45,
    tools: ["scrape_url", "write_file"],
  },
  {
    id: "ai-act-compliance-crawl",
    title: "EU AI Act Article 12 readiness",
    category: "compliance",
    goal: "Crawl public AI vendor pages (OpenAI, Anthropic, Mistral, Cohere, etc.), grep for Article 12 logging/audit-bundle commitments, score each, emit ai-act-readiness.md.",
    description: "Who's actually ready for the August 2 deadline?",
    estCostUsd: 0.08,
    estDurationSec: 60,
    tools: ["scrape_url", "write_file", "ingest_knowledge"],
  },
  {
    id: "lead-enrich",
    title: "Lead enrichment",
    category: "growth",
    goal: "Take a CSV of 25 company URLs, scrape each homepage + about page, extract decision-maker name, employee count signal, tech stack guess. Output enriched.csv.",
    description: "Take a CSV from \"name + url\" to outbound-ready in one charter.",
    estCostUsd: 0.12,
    estDurationSec: 90,
    tools: ["scrape_url", "upsert_contact", "write_file"],
  },
  {
    id: "outreach-sequence",
    title: "3-step outreach sequence",
    category: "growth",
    goal: "Given a target site URL and your value-prop, draft a 3-email outreach sequence (initial / day-4 / day-10) hand-tuned to the prospect.",
    description: "Specific, not template-feeling.",
    estCostUsd: 0.05,
    estDurationSec: 25,
    tools: ["scrape_url", "geo_outreach_sequence", "write_file"],
  },
  {
    id: "weekly-retro",
    title: "Weekly engineering retro",
    category: "engineering",
    goal: "Walk a git repo's commit log for the last 7 days, summarize what shipped, flag risky merges, propose 3 priorities for next week.",
    description: "Better than the standup template you keep ignoring.",
    estCostUsd: 0.05,
    estDurationSec: 30,
    tools: ["read_file", "list_files", "grep_codebase", "write_file"],
  },
  {
    id: "press-research",
    title: "Press / mention research",
    category: "research",
    goal: "Find every public mention of a target brand or person across HN, Reddit, X, dev.to in the last 30 days. Rank by reach. Emit mentions.csv.",
    description: "Every place you got mentioned, ranked.",
    estCostUsd: 0.07,
    estDurationSec: 50,
    tools: ["scrape_url", "ingest_knowledge", "write_file"],
  },
  {
    id: "competitor-feature-diff",
    title: "Competitor feature diff",
    category: "research",
    goal: "Compare your product page to 3 competitor product pages. Output a feature-matrix CSV showing who has what + where you're behind.",
    description: "Honest read on what's missing from your roadmap.",
    estCostUsd: 0.05,
    estDurationSec: 30,
    tools: ["scrape_url", "profile_geo_competitor", "write_file"],
  },
  {
    id: "incident-postmortem",
    title: "Incident post-mortem draft",
    category: "ops",
    goal: "Given a Sentry / Datadog incident URL + a code repo path, walk the stack trace, identify root cause file:line, draft a post-mortem document with 3 prevention recommendations.",
    description: "Skips the blame phase, gets to the fix.",
    estCostUsd: 0.06,
    estDurationSec: 35,
    tools: ["scrape_url", "read_file", "grep_codebase", "write_file"],
  },
  {
    id: "founder-daily-brief",
    title: "Founder daily brief",
    category: "ops",
    goal: "Pull yesterday's metrics from 3 dashboards (revenue / signups / errors), summarize the 3 things that need attention today. Output brief.md and email to me.",
    description: "What you'd ask an analyst to do every morning.",
    estCostUsd: 0.04,
    estDurationSec: 25,
    tools: ["scrape_url", "send_email", "write_file"],
  },
  {
    id: "knowledge-ingest",
    title: "Knowledge base ingest",
    category: "research",
    goal: "Take a list of 10 URLs, ingest each into the agent's long-term knowledge store with summaries + tags. Returns kb-manifest.json.",
    description: "Build an agent's reference library in 30 seconds.",
    estCostUsd: 0.03,
    estDurationSec: 20,
    tools: ["scrape_url", "ingest_knowledge"],
  },
];

export function templatesByCategory(): Record<CharterTemplate["category"], CharterTemplate[]> {
  const out: Record<string, CharterTemplate[]> = {};
  for (const t of CHARTER_TEMPLATES) {
    if (!out[t.category]) out[t.category] = [];
    out[t.category].push(t);
  }
  return out as Record<CharterTemplate["category"], CharterTemplate[]>;
}
