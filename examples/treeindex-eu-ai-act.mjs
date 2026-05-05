#!/usr/bin/env node
/**
 * TreeIndexKnowledgeBase — vectorless RAG demo over an EU AI Act excerpt.
 *
 * The EU AI Act is a 100+ page regulation with deeply nested articles.
 * Vector RAG splits it into chunks and loses the section context;
 * tree-index keeps the heading hierarchy intact and lets the agent walk
 * it like a human reading the regulation.
 *
 * Run:
 *   node examples/treeindex-eu-ai-act.mjs
 *
 * The example uses the deterministic keyword chooser (no API key needed).
 * For production use, swap `makeKeywordTreeIndexLlm()` for an Anthropic /
 * OpenAI adapter — the TreeIndexLlm interface is a one-method seam:
 *
 *   const llm = {
 *     async pick({ question, trail, options }) {
 *       const res = await anthropic.messages.create({
 *         model: "claude-haiku-4-5-20251001",
 *         max_tokens: 100,
 *         messages: [{ role: "user", content: buildPrompt(question, trail, options) }],
 *       });
 *       return parseChoice(res.content[0].text);
 *     },
 *   };
 */

import {
  TreeIndexKnowledgeBase,
  makeKeywordTreeIndexLlm,
} from "../packages/knowledge/dist/index.js";

// Excerpt: EU AI Act, Title III Chapter 2 (high-risk AI requirements).
// Real text from the published Regulation (Articles 12, 13, 14, 15, 17).
const EU_AI_ACT = `# Regulation (EU) 2024/1689 — AI Act

The Regulation establishes harmonised rules for AI systems placed on the
market, put into service, or used in the Union.

## Article 12 — Record-keeping

High-risk AI systems shall be designed and developed with capabilities
enabling the automatic recording of events ('logs') over the lifetime of
the system.

### 12.1 — Logging requirements

Logs shall record at least: start date and time of each use, the
reference database against which input data has been checked, the input
data, and the identification of the natural persons involved in the
verification of the results.

### 12.2 — Retention period

Providers shall keep logs for a period appropriate to the intended
purpose of the high-risk AI system, of at least six months unless
otherwise required by applicable Union or national law, in particular
Union law on the protection of personal data.

## Article 13 — Transparency and provision of information to deployers

High-risk AI systems shall be designed and developed in such a way as to
ensure that their operation is sufficiently transparent to enable
deployers to interpret the system's output and use it appropriately.

### 13.1 — Instructions for use

High-risk AI systems shall be accompanied by instructions for use in an
appropriate digital format or otherwise that include concise, complete,
correct and clear information that is relevant, accessible and
comprehensible to deployers.

### 13.2 — Required information

The instructions for use shall contain at least: the identity and
contact details of the provider; the characteristics, capabilities and
limitations of performance of the high-risk AI system; the
specifications for the input data; and the human oversight measures.

## Article 14 — Human oversight

High-risk AI systems shall be designed and developed in such a way,
including with appropriate human-machine interface tools, that they can
be effectively overseen by natural persons during the period in which
they are in use.

### 14.4 — Oversight measures

Human oversight measures shall enable the natural persons to: properly
understand the relevant capacities and limitations of the system;
remain aware of the possible tendency of automatically relying on output
('automation bias'); correctly interpret the system's output; decide,
in any particular situation, not to use the system or otherwise
disregard, override or reverse the output; and intervene in the
operation of the system or interrupt the system through a 'stop'
button or a similar procedure.

## Article 15 — Accuracy, robustness and cybersecurity

High-risk AI systems shall be designed and developed in such a way that
they achieve an appropriate level of accuracy, robustness, and
cybersecurity, and that they perform consistently in those respects
throughout their lifecycle.

### 15.1 — Accuracy metrics

The levels of accuracy and the relevant accuracy metrics of high-risk AI
systems shall be declared in the accompanying instructions of use.

### 15.4 — Cybersecurity

High-risk AI systems shall be resilient against attempts by unauthorised
third parties to alter their use, outputs or performance by exploiting
system vulnerabilities. Technical solutions aimed at ensuring the
cybersecurity of high-risk AI systems shall be appropriate to the
relevant circumstances and the risks.

## Article 17 — Quality management system

Providers of high-risk AI systems shall put a quality management system
in place that ensures compliance with this Regulation. That system shall
be documented in a systematic and orderly manner in the form of written
policies, procedures and instructions.
`;

const QUESTIONS = [
  "How long must logs be kept under the AI Act?",
  "What information must instructions for use contain?",
  "What does human oversight require operators to be able to do?",
  "What does Article 15 require about cybersecurity?",
  "Does the AI Act require a quality management system?",
];

async function main() {
  const llm = makeKeywordTreeIndexLlm();
  const kb = new TreeIndexKnowledgeBase(llm, { summaryChars: 240 });
  await kb.ingest([
    { id: "eu-ai-act-2024-1689", text: EU_AI_ACT, source: "Regulation (EU) 2024/1689" },
  ]);

  console.log("Praetor TreeIndex demo · Regulation (EU) 2024/1689\n");
  console.log("Doc ingested: 1, tree depth: 3 (h1 → h2 → h3)\n");

  for (const q of QUESTIONS) {
    const [hit] = await kb.query(q, 1);
    console.log("Q:", q);
    if (!hit) {
      console.log("A: (no answer found)\n");
      continue;
    }
    const trail = (hit.chunk.metadata && hit.chunk.metadata.trail) || [];
    const title = hit.chunk.metadata && hit.chunk.metadata.title;
    console.log("Trail:", trail.join(" → "));
    console.log("Section:", title);
    const text = hit.chunk.text.split("\n").slice(0, 4).join("\n");
    console.log("Excerpt:");
    console.log(text.split("\n").map((l) => "  " + l).join("\n"));
    console.log();
  }
}

main().catch((err) => {
  console.error("[treeindex-eu-ai-act] error:", err);
  process.exit(1);
});
