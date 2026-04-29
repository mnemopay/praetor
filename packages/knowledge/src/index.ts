export * from "./mnemopay.js";

/**
 * Praetor Knowledge pack — a vector knowledge base. Charters call
 * `kb.ingest(content)` with scraped or generated text and `kb.query(question)`
 * to retrieve the top-K most relevant chunks for downstream prompting.
 *
 * Two backends ship in the box:
 *
 *   1. `InMemoryKnowledgeBase` — character-bigram cosine similarity. Zero
 *      dependencies, fully synchronous, safe for unit tests and CLI demos.
 *   2. `MnemoPayKnowledgeBase` — wraps MnemoPay's recall engine (862 tests,
 *      Merkle integrity) for production. Charter-scoped namespaces so two
 *      missions cannot read each other's memory by accident.
 *
 * The interface is intentionally small (`ingest`, `query`, `forget`) so a
 * charter can swap backends without rewriting prompts.
 */
export interface KnowledgeChunk {
  id: string;
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeHit {
  chunk: KnowledgeChunk;
  score: number;
}

export interface KnowledgeBase {
  ingest: (chunks: KnowledgeChunk[]) => Promise<{ ingested: number }>;
  query: (q: string, k?: number) => Promise<KnowledgeHit[]>;
  forget: (id: string) => Promise<{ removed: boolean }>;
  size: () => Promise<number>;
}

/**
 * In-memory KB. Vector = character bigram histogram (length 729 for ASCII
 * lower-case + space). Cosine similarity. Perfectly adequate for charters
 * with under ~10K chunks; falls over above that.
 */
export class InMemoryKnowledgeBase implements KnowledgeBase {
  private chunks = new Map<string, { chunk: KnowledgeChunk; vec: Float32Array; norm: number }>();

  async ingest(chunks: KnowledgeChunk[]): Promise<{ ingested: number }> {
    for (const c of chunks) {
      const vec = bigramVector(c.text);
      const norm = vectorNorm(vec);
      this.chunks.set(c.id, { chunk: c, vec, norm });
    }
    return { ingested: chunks.length };
  }

  async query(q: string, k = 5): Promise<KnowledgeHit[]> {
    const qv = bigramVector(q);
    const qn = vectorNorm(qv);
    if (qn === 0) return [];
    const hits: KnowledgeHit[] = [];
    for (const { chunk, vec, norm } of this.chunks.values()) {
      if (norm === 0) continue;
      const score = cosine(qv, vec, qn, norm);
      hits.push({ chunk, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  async forget(id: string): Promise<{ removed: boolean }> {
    return { removed: this.chunks.delete(id) };
  }

  async size(): Promise<number> {
    return this.chunks.size;
  }
}

/**
 * MnemoPay-backed KB. Production charters get tamper-evident recall + Merkle
 * audit out-of-the-box. The constructor takes a thin recall client so this
 * package does not require `@mnemopay/sdk` at install time.
 */
export interface MnemoPayRecallClient {
  remember: (args: { id: string; text: string; namespace: string; metadata?: Record<string, unknown> }) => Promise<void>;
  recall: (args: { query: string; namespace: string; topK: number }) => Promise<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }[]>;
  forget: (args: { id: string; namespace: string }) => Promise<{ removed: boolean }>;
  size: (args: { namespace: string }) => Promise<number>;
}

export class MnemoPayKnowledgeBase implements KnowledgeBase {
  constructor(private readonly client: MnemoPayRecallClient, private readonly namespace: string) {}
  async ingest(chunks: KnowledgeChunk[]): Promise<{ ingested: number }> {
    for (const c of chunks) {
      await this.client.remember({
        id: c.id,
        text: c.text,
        namespace: this.namespace,
        metadata: { source: c.source, ...c.metadata },
      });
    }
    return { ingested: chunks.length };
  }
  async query(q: string, k = 5): Promise<KnowledgeHit[]> {
    const hits = await this.client.recall({ query: q, namespace: this.namespace, topK: k });
    return hits.map((h) => ({
      chunk: { id: h.id, text: h.text, metadata: h.metadata },
      score: h.score,
    }));
  }
  async forget(id: string): Promise<{ removed: boolean }> {
    return this.client.forget({ id, namespace: this.namespace });
  }
  async size(): Promise<number> {
    return this.client.size({ namespace: this.namespace });
  }
}

/**
 * Chunk a long string into approximately-`size`-character pieces, splitting
 * on the closest paragraph boundary. Trivial heuristic; works well enough for
 * scraped HTML + transcripts.
 */
export function chunkText(text: string, size = 1_200, overlap = 120): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    let cut = end;
    if (end < text.length) {
      const slice = text.slice(i, end);
      const breakPoint = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (breakPoint > size * 0.5) cut = i + breakPoint + 1;
    }
    out.push(text.slice(i, cut).trim());
    if (cut >= text.length) break;
    i = Math.max(0, cut - overlap);
  }
  return out;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz "; // 27 chars
const N = ALPHABET.length;
const INDEX = new Map(Array.from(ALPHABET, (c, i) => [c, i] as const));

function bigramVector(s: string): Float32Array {
  const v = new Float32Array(N * N);
  const norm = s.toLowerCase().replace(/[^a-z ]+/g, " ");
  for (let i = 0; i < norm.length - 1; i++) {
    const a = INDEX.get(norm[i]);
    const b = INDEX.get(norm[i + 1]);
    if (a === undefined || b === undefined) continue;
    v[a * N + b] += 1;
  }
  return v;
}
function vectorNorm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}
function cosine(a: Float32Array, b: Float32Array, na: number, nb: number): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (na * nb);
}
