/**
 * TreeIndexKnowledgeBase — vectorless RAG via reasoning over a heading tree.
 *
 * Charters point at a long document (regulation, 10-K, internal policy) and
 * the index parses it into a hierarchical tree keyed on markdown headings.
 * At query time the LLM walks the tree like a human reading a book — it sees
 * each level's children with one-line summaries, picks the most relevant
 * branch, and recurses until it hits the leaf section that answers the
 * question.
 *
 * Inspired by VectifyAI's PageIndex (MIT). This is a native TS port: zero
 * Python deps, runs in the same process as every other Praetor pack, and
 * implements the standard KnowledgeBase interface so charters can A/B it
 * against the in-memory bigram and MnemoPay-recall backends without
 * rewriting prompts.
 *
 * Tradeoffs vs vector RAG:
 *  - Wins on long structured docs with a real heading hierarchy (regs, 10-Ks,
 *    SOPs). Hit rate measured at >>vector on FinanceBench-style benchmarks.
 *  - Each query costs N LLM calls (one per tree level descended), so plan on
 *    100-500x the cost of a single embedding lookup. Use for "agent reads a
 *    100-page doc and answers", not for high-volume retrieval.
 *  - Doesn't produce a similarity score. The picked leaf is the answer; rank
 *    by `level` (deeper = more specific) when comparing across docs.
 */

import type { KnowledgeBase, KnowledgeChunk, KnowledgeHit } from "./index.js";

/** A single picker option presented to the LLM. */
export interface TreePickOption {
  /** Stable node id within the tree. The LLM never sees this — it sees the
   * 1-based index in the options array — but the runtime needs the id back. */
  id: string;
  title: string;
  /** First ~200 chars of the section's text, used as the LLM-visible hint. */
  summary: string;
  /** True for leaf nodes (no children). The LLM may stop on a non-leaf. */
  leaf: boolean;
}

/** What the LLM returns at each hop. Choice 0 = stop (this node is good
 * enough); 1..options.length = descend into that child. */
export interface TreePickResult {
  choice: number;
  rationale?: string;
}

/** Pluggable LLM seam. Adapters (Anthropic, OpenAI, Ollama) implement this
 * elsewhere; tests inject a deterministic chooser. */
export interface TreeIndexLlm {
  pick: (input: { question: string; trail: string[]; options: TreePickOption[] }) => Promise<TreePickResult>;
}

export interface TreeNode {
  id: string;
  title: string;
  /** 0 = doc root, 1 = h1, 2 = h2, … */
  level: number;
  /** Body text under this heading, before any sub-heading. */
  content: string;
  children: TreeNode[];
}

export interface TreeIndexOptions {
  /** Hard cap on tree-walk depth. Default 8 — deep enough for any reg / 10-K. */
  maxHops?: number;
  /** Max chars of content used in the LLM-visible summary for each node. */
  summaryChars?: number;
  /** Include collected child text in a leaf's `chunk.text` (default true). */
  includeDescendantsInLeafText?: boolean;
}

/**
 * Build a TreeNode from a markdown string. Headings (`#`, `##`, …) anchor
 * each node; paragraphs / lists / code under a heading become its `content`.
 *
 * If the doc has no headings at all the whole text becomes a single root with
 * level 0 — the LLM picks it with `choice: 0` and the runtime returns it.
 */
export function parseMarkdownToTree(id: string, markdown: string, title?: string): TreeNode {
  const lines = markdown.split(/\r?\n/);
  const root: TreeNode = {
    id: `${id}#root`,
    title: title ?? id,
    level: 0,
    content: "",
    children: [],
  };

  // Stack tracks ancestors at each level so we attach new headings under the
  // most recent shallower parent. Index 0 = root.
  const stack: TreeNode[] = [root];
  // Buffer for text rolling into whichever node is on top of the stack.
  let buffer: string[] = [];
  let inFence = false;
  let nextNodeIdx = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length > 0) {
      const top = stack[stack.length - 1];
      top.content = top.content ? `${top.content}\n\n${text}` : text;
    }
    buffer = [];
  };

  for (const line of lines) {
    // Track triple-backtick code fences so a `## inside` a fence never starts
    // a new node.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    const headingMatch = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      flushBuffer();
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      // Pop ancestors at deeper-or-equal levels until we find the parent.
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const node: TreeNode = {
        id: `${id}#${++nextNodeIdx}`,
        title: heading,
        level,
        content: "",
        children: [],
      };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();

  // If a doc has zero headings, root.content holds the whole thing — that's a
  // valid one-node tree. Walk just returns the root in that case.
  return root;
}

/** Concatenate a node's own content with all descendant content, depth-first.
 * Used to assemble the final leaf-as-hit text. */
export function collectTreeText(node: TreeNode): string {
  const parts: string[] = [];
  const walk = (n: TreeNode, prefix = "") => {
    if (n.title && n.level > 0) {
      parts.push(`${"#".repeat(Math.max(1, n.level))} ${n.title}`);
    }
    if (n.content.trim().length > 0) parts.push(n.content.trim());
    for (const c of n.children) walk(c, prefix);
  };
  walk(node);
  return parts.join("\n\n").trim();
}

/** Walk the tree under `root` letting the LLM pick at each level. Returns the
 * deepest node the LLM committed to, or `null` if it picks `0` at the root. */
export async function walkTree(
  llm: TreeIndexLlm,
  question: string,
  root: TreeNode,
  opts: TreeIndexOptions = {},
): Promise<{ node: TreeNode; trail: string[]; rationale?: string } | null> {
  const maxHops = opts.maxHops ?? 8;
  const summaryChars = opts.summaryChars ?? 200;

  // The doc root (level 0) is a synthetic wrapper. If it has no body of its
  // own and exactly one child, auto-descend to that child without asking the
  // LLM — picking "the document" is not a real choice. Multi-h1 docs (root
  // with >1 children) still get the LLM pick at the top level.
  let current: TreeNode = root;
  const trail: string[] = [root.title];
  if (
    current.level === 0 &&
    current.content.trim().length === 0 &&
    current.children.length === 1
  ) {
    current = current.children[0];
    trail.push(current.title);
  }
  let lastRationale: string | undefined;

  for (let hop = 0; hop < maxHops; hop++) {
    if (current.children.length === 0) break; // leaf — no further descent
    const options: TreePickOption[] = current.children.map((c) => ({
      id: c.id,
      title: c.title,
      summary: summarize(c, summaryChars),
      leaf: c.children.length === 0,
    }));
    const { choice, rationale } = await llm.pick({ question, trail, options });
    lastRationale = rationale ?? lastRationale;
    if (choice === 0) break; // LLM is confident this node is the answer
    if (choice < 0 || choice > options.length) break; // bad pick → stop here
    current = current.children[choice - 1];
    trail.push(current.title);
  }

  // If the LLM stopped at the root and the root has no body of its own, treat
  // that as "no useful answer in this doc."
  if (current.id === root.id && current.content.trim().length === 0) return null;
  return { node: current, trail, rationale: lastRationale };
}

function summarize(n: TreeNode, max: number): string {
  // Always include a 2-level title outline when children exist — the LLM
  // (or keyword chooser) needs to see the section's territory, not just its
  // own intro paragraph, to decide whether to descend.
  const parts: string[] = [];
  if (n.content.trim().length > 0) {
    parts.push(truncate(n.content.trim(), Math.floor(max * 0.6)));
  }
  if (n.children.length > 0) {
    const outline: string[] = [];
    for (const c of n.children.slice(0, 8)) {
      outline.push(c.title);
      for (const gc of c.children.slice(0, 6)) outline.push(`  · ${gc.title}`);
    }
    parts.push(`subsections: ${outline.join(" · ")}`);
  }
  if (parts.length === 0) return "(empty)";
  return truncate(parts.join(" — "), max);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Vectorless RAG backend. Implements the standard KnowledgeBase interface so
 * it drops into any charter that already speaks `ingest` / `query` / `forget`.
 */
export class TreeIndexKnowledgeBase implements KnowledgeBase {
  private docs = new Map<string, { root: TreeNode; meta?: KnowledgeChunk["metadata"] }>();

  constructor(private readonly llm: TreeIndexLlm, private readonly opts: TreeIndexOptions = {}) {}

  async ingest(chunks: KnowledgeChunk[]): Promise<{ ingested: number }> {
    for (const c of chunks) {
      const root = parseMarkdownToTree(c.id, c.text, c.source ?? c.id);
      this.docs.set(c.id, { root, meta: c.metadata });
    }
    return { ingested: chunks.length };
  }

  /** Walk every ingested doc with the LLM and return up to `k` deepest leaves
   * the walker committed to. Tree-index has no native cosine score, so the
   * returned `score` is `1 - 1/(level+1)` — deeper picks rank higher.
   *
   * For single-doc charters (the common case) `k=1` is the right call. For
   * multi-doc indexes (e.g., a folder of regs) `k>1` returns one hit per doc
   * up to the cap. */
  async query(q: string, k = 1): Promise<KnowledgeHit[]> {
    const hits: KnowledgeHit[] = [];
    for (const [docId, { root, meta }] of this.docs) {
      const result = await walkTree(this.llm, q, root, this.opts);
      if (!result) continue;
      const node = result.node;
      const includeDescendants = this.opts.includeDescendantsInLeafText !== false;
      const text = includeDescendants ? collectTreeText(node) : node.content;
      hits.push({
        chunk: {
          id: node.id,
          text,
          source: docId,
          metadata: {
            ...meta,
            title: node.title,
            level: node.level,
            trail: result.trail,
            rationale: result.rationale,
          },
        },
        score: 1 - 1 / (node.level + 1),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  async forget(id: string): Promise<{ removed: boolean }> {
    return { removed: this.docs.delete(id) };
  }
  async size(): Promise<number> {
    return this.docs.size;
  }

  /** Raw access to the underlying tree for callers that want to render it
   * (e.g., a UI that shows the LLM's reasoning trail). */
  tree(id: string): TreeNode | undefined {
    return this.docs.get(id)?.root;
  }
}

/** Heuristic chooser useful as a default + as a deterministic test fixture.
 * Picks the child whose title or summary contains the most query terms. */
export function makeKeywordTreeIndexLlm(): TreeIndexLlm {
  return {
    async pick({ question, options }) {
      const terms = question
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3);
      if (terms.length === 0) return { choice: 0 };
      let best = 0;
      let bestScore = 0;
      options.forEach((opt, i) => {
        const blob = `${opt.title}\n${opt.summary}`.toLowerCase();
        let score = 0;
        for (const t of terms) if (blob.includes(t)) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = i + 1;
        }
      });
      return bestScore > 0 ? { choice: best, rationale: "keyword match" } : { choice: 0 };
    },
  };
}
