import { describe, it, expect } from "vitest";
import {
  TreeIndexKnowledgeBase,
  parseMarkdownToTree,
  collectTreeText,
  walkTree,
  makeKeywordTreeIndexLlm,
  type TreeIndexLlm,
  type TreePickResult,
} from "./tree-index.js";

const SAMPLE_REG = `
# EU AI Act

The Regulation establishes harmonised rules for AI systems placed on the market.

## Article 12 — Record-keeping

High-risk AI systems shall be designed and developed with capabilities enabling
the automatic recording of events ('logs') over the lifetime of the system.

### 12.1 — Logging requirements

Logs shall record at least: start date and time of each use, the reference
database against which input data has been checked, the input data, and the
identification of the natural persons involved in the verification of the
results.

### 12.2 — Retention period

Providers shall keep logs for a period appropriate to the intended purpose of
the high-risk AI system, of at least six months unless otherwise required by
applicable Union or national law.

## Article 14 — Human oversight

High-risk AI systems shall be designed and developed in such a way that they
can be effectively overseen by natural persons during the period in which they
are in use.
`.trim();

describe("parseMarkdownToTree", () => {
  it("builds a hierarchical tree from headings", () => {
    const root = parseMarkdownToTree("eu-ai-act", SAMPLE_REG);
    expect(root.children).toHaveLength(1); // "EU AI Act" h1
    const act = root.children[0];
    expect(act.title).toBe("EU AI Act");
    expect(act.level).toBe(1);
    expect(act.children).toHaveLength(2); // Article 12 + Article 14
    const art12 = act.children[0];
    expect(art12.title).toBe("Article 12 — Record-keeping");
    expect(art12.children).toHaveLength(2); // 12.1 + 12.2
    expect(art12.children[0].title).toBe("12.1 — Logging requirements");
    expect(art12.children[1].title).toBe("12.2 — Retention period");
  });

  it("attaches body text under the right heading", () => {
    const root = parseMarkdownToTree("eu-ai-act", SAMPLE_REG);
    const art12 = root.children[0].children[0];
    expect(art12.content).toContain("automatic recording of events");
    const sec121 = art12.children[0];
    expect(sec121.content).toContain("Logs shall record at least");
    const sec122 = art12.children[1];
    expect(sec122.content).toContain("at least six months");
  });

  it("treats heading-less docs as a single root with body", () => {
    const root = parseMarkdownToTree("plain", "Just a paragraph. Nothing else.");
    expect(root.children).toHaveLength(0);
    expect(root.content).toBe("Just a paragraph. Nothing else.");
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = "# Real Heading\nbody\n```\n# not a heading\nstill code\n```\nmore body";
    const root = parseMarkdownToTree("d", md);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].title).toBe("Real Heading");
    expect(root.children[0].content).toContain("not a heading"); // it's text, not a node
  });

  it("handles a heading that skips a level", () => {
    const md = "# A\n## B\n#### D"; // h1 → h2 → h4 (skip h3)
    const root = parseMarkdownToTree("d", md);
    const a = root.children[0];
    const b = a.children[0];
    expect(b.title).toBe("B");
    expect(b.children[0].title).toBe("D");
    expect(b.children[0].level).toBe(4);
  });
});

describe("collectTreeText", () => {
  it("re-emits headings + content depth-first", () => {
    const root = parseMarkdownToTree("eu-ai-act", SAMPLE_REG);
    const text = collectTreeText(root.children[0].children[0]); // Article 12 subtree
    expect(text).toContain("# Article 12 — Record-keeping");
    expect(text).toContain("### 12.1 — Logging requirements");
    expect(text).toContain("### 12.2 — Retention period");
    expect(text).toContain("at least six months");
  });
});

describe("walkTree", () => {
  it("descends through the children the LLM picks", async () => {
    const root = parseMarkdownToTree("eu-ai-act", SAMPLE_REG);
    const calls: string[][] = [];
    const llm: TreeIndexLlm = {
      async pick({ trail, options }) {
        calls.push([...trail, options.map((o) => o.title).join("|")]);
        // Pick "EU AI Act" → "Article 12" → "12.2"
        const want = ["EU AI Act", "Article 12 — Record-keeping", "12.2 — Retention period"];
        const target = want[trail.length - 1];
        const idx = options.findIndex((o) => o.title === target);
        return idx >= 0 ? { choice: idx + 1 } : { choice: 0 };
      },
    };
    const result = await walkTree(llm, "how long are logs kept?", root);
    expect(result).not.toBeNull();
    expect(result!.node.title).toBe("12.2 — Retention period");
    expect(result!.trail).toEqual([
      root.title,
      "EU AI Act",
      "Article 12 — Record-keeping",
      "12.2 — Retention period",
    ]);
    // Synthetic root → "EU AI Act" is auto-descended (no LLM call); the LLM
    // only picks the two real branches (Article 12, then 12.2).
    expect(calls.length).toBe(2);
  });

  it("returns the auto-descended h1 when the LLM stops with choice=0", async () => {
    const root = parseMarkdownToTree("eu-ai-act", SAMPLE_REG);
    const llm: TreeIndexLlm = { async pick() { return { choice: 0 }; } };
    const result = await walkTree(llm, "anything", root);
    // Root is synthetic, auto-descend skips it → walker is at the EU AI Act h1
    // which has body content. choice=0 there is a valid stop, not a null.
    expect(result).not.toBeNull();
    expect(result!.node.title).toBe("EU AI Act");
  });

  it("respects maxHops cap", async () => {
    const md = "# l1\n## l2\n### l3\n#### l4\n##### l5\n###### l6";
    const root = parseMarkdownToTree("deep", md);
    const llm: TreeIndexLlm = { async pick({ options }) { return { choice: options.length === 0 ? 0 : 1 }; } };
    const result = await walkTree(llm, "?", root, { maxHops: 2 });
    expect(result).not.toBeNull();
    // root.title + auto-descended l1 + 2 LLM-driven hops = trail length 4.
    expect(result!.trail.length).toBeLessThanOrEqual(4);
  });

  it("treats out-of-range LLM picks as stop", async () => {
    const root = parseMarkdownToTree("eu-ai-act", SAMPLE_REG);
    const llm: TreeIndexLlm = { async pick() { return { choice: 99 }; } };
    const result = await walkTree(llm, "anything", root);
    // First pick is 99 (invalid) → stop. Auto-descent landed us at EU AI Act
    // which has body content, so the walker returns it as the leaf.
    expect(result).not.toBeNull();
    expect(result!.node.title).toBe("EU AI Act");
  });
});

describe("TreeIndexKnowledgeBase", () => {
  it("ingests a doc and returns a leaf hit when the LLM walks it", async () => {
    const llm: TreeIndexLlm = {
      async pick({ question, options }) {
        // Deterministic chooser: score each option by how many query tokens
        // appear in its title (weighted 2×) plus summary (weighted 1×). Pick
        // the highest. Title-weighting matters because a section's body can
        // mention adjacent terms incidentally — the title is the stronger
        // signal of what the section is *about*.
        const tokens = question.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        let best = -1;
        let bestScore = 0;
        options.forEach((o, i) => {
          const title = o.title.toLowerCase();
          const summary = o.summary.toLowerCase();
          let score = 0;
          for (const t of tokens) {
            if (title.includes(t)) score += 2;
            if (summary.includes(t)) score += 1;
          }
          if (score > bestScore) { bestScore = score; best = i; }
        });
        return best >= 0 ? { choice: best + 1 } : { choice: 0 };
      },
    };
    const kb = new TreeIndexKnowledgeBase(llm);
    await kb.ingest([{ id: "eu-ai-act", text: SAMPLE_REG }]);
    expect(await kb.size()).toBe(1);
    const hits = await kb.query("retention period for logs", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.metadata?.title).toBe("12.2 — Retention period");
    expect(hits[0].chunk.text).toContain("at least six months");
    // trail must include the path the walker took
    expect((hits[0].chunk.metadata as { trail: string[] }).trail).toContain(
      "Article 12 — Record-keeping",
    );
  });

  it("returns deeper picks first when querying multiple docs", async () => {
    const llm: TreeIndexLlm = {
      async pick({ question, options }) {
        const tokens = question.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const idx = options.findIndex((o) =>
          tokens.some((t) => `${o.title} ${o.summary}`.toLowerCase().includes(t)),
        );
        return idx >= 0 ? { choice: idx + 1 } : { choice: 0 };
      },
    };
    const kb = new TreeIndexKnowledgeBase(llm);
    await kb.ingest([
      { id: "eu-ai-act", text: SAMPLE_REG },
      {
        id: "shallow",
        text: "# Records\nA flat doc with a single heading and the word retention in the body.",
      },
    ]);
    const hits = await kb.query("retention", 2);
    expect(hits.length).toBe(2);
    // EU AI Act's deep node (level 3) should outrank the shallow doc (level 1)
    expect(hits[0].chunk.source).toBe("eu-ai-act");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("forget() removes a doc and decrements size", async () => {
    const llm: TreeIndexLlm = { async pick() { return { choice: 0 }; } };
    const kb = new TreeIndexKnowledgeBase(llm);
    await kb.ingest([{ id: "x", text: "# X\nbody" }, { id: "y", text: "# Y\nbody" }]);
    expect(await kb.size()).toBe(2);
    expect(await kb.forget("x")).toEqual({ removed: true });
    expect(await kb.size()).toBe(1);
    expect(await kb.forget("missing")).toEqual({ removed: false });
  });

  it("tree() returns the parsed root for inspection", async () => {
    const llm: TreeIndexLlm = { async pick() { return { choice: 0 }; } };
    const kb = new TreeIndexKnowledgeBase(llm);
    await kb.ingest([{ id: "eu-ai-act", text: SAMPLE_REG }]);
    const root = kb.tree("eu-ai-act");
    expect(root).toBeDefined();
    expect(root!.children[0].title).toBe("EU AI Act");
  });

  it("includeDescendantsInLeafText=false returns only the picked node's body", async () => {
    const llm: TreeIndexLlm = {
      async pick({ trail }) {
        // Walk EU AI Act → Article 12 (then stop, so the leaf is Article 12).
        if (trail.length === 1) return { choice: 1 }; // EU AI Act
        if (trail.length === 2) return { choice: 1 }; // Article 12
        return { choice: 0 };
      },
    };
    const kb = new TreeIndexKnowledgeBase(llm, { includeDescendantsInLeafText: false });
    await kb.ingest([{ id: "eu-ai-act", text: SAMPLE_REG }]);
    const hits = await kb.query("logs", 1);
    expect(hits[0].chunk.metadata?.title).toBe("Article 12 — Record-keeping");
    // body of Article 12 is present, but children's text (12.1 / 12.2) is NOT
    expect(hits[0].chunk.text).toContain("automatic recording of events");
    expect(hits[0].chunk.text).not.toContain("at least six months"); // that's in 12.2
  });
});

describe("makeKeywordTreeIndexLlm — default deterministic chooser", () => {
  it("picks the child whose title/summary contains the most query terms", async () => {
    const llm = makeKeywordTreeIndexLlm();
    const root = parseMarkdownToTree("eu-ai-act", SAMPLE_REG);
    const kb = new TreeIndexKnowledgeBase(llm);
    await kb.ingest([{ id: "eu-ai-act", text: SAMPLE_REG }]);
    const hits = await kb.query("retention period", 1);
    expect(hits[0].chunk.metadata?.title).toBe("12.2 — Retention period");
  });

  it("returns choice=0 when no query term matches", async () => {
    const llm = makeKeywordTreeIndexLlm();
    const result = await llm.pick({
      question: "xyzzy quuxbar",
      trail: [],
      options: [
        { id: "a", title: "Logs", summary: "logs", leaf: true },
        { id: "b", title: "Oversight", summary: "oversight", leaf: true },
      ],
    });
    expect(result.choice).toBe(0);
  });
});
