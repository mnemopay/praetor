/**
 * @praetor/router — declarative LLM router.
 *
 * A charter declares its requirements:
 *   route: { quality: "high" | "fast", maxUsdPer1K: 5, sovereign: true, contextK: 128 }
 *
 * The router picks the best provider that satisfies all constraints and
 * routes the call. Providers are pluggable; callers register adapters
 * for the providers they have keys for. The "Provider" interface is
 * deliberately small so any vendor's SDK can be wrapped.
 *
 * Default model catalogue includes:
 *   - OpenAI / Anthropic / Google for the hot path
 *   - OpenRouter as universal fallback
 *   - Xiaomi MiMo-V2.5-Pro (1M-token context, MIT) for open-weight long-context
 *     and sovereign-mode deploys (run locally or on Together.ai / HF Inference)
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ModelCard {
  /** Provider-qualified model id, e.g. "anthropic/claude-opus-4-7" or "xiaomi/mimo-v2.5-pro". */
  id: string;
  provider: string;
  /** Effective context window in tokens. */
  contextTokens: number;
  /** USD per 1,000 input tokens. */
  inputUsdPer1K: number;
  /** USD per 1,000 output tokens. */
  outputUsdPer1K: number;
  /** Coarse quality bucket the router compares against charter requirements. */
  quality: "fast" | "balanced" | "high";
  /** True if model can be self-hosted / open-weight / runs in sovereign mode. */
  openWeight: boolean;
  tags?: readonly string[];
}

export interface RouteRequirements {
  /** Hard floor on quality. "fast" matches everything, "high" only matches high. */
  quality?: "fast" | "balanced" | "high";
  /** Hard ceiling on $/1K combined-token cost. */
  maxUsdPer1K?: number;
  /** Hard floor on context window in tokens. */
  minContextK?: number;
  /** If true, only open-weight models are eligible. */
  sovereign?: boolean;
  /** Optional preferred-tag bias. */
  preferTags?: readonly string[];
  /** Optional explicit model id override — bypasses scoring. */
  preferModel?: string;
}

export interface Provider {
  /** Provider identifier — must match ModelCard.provider. */
  name: string;
  /** Run a chat completion. Returns text + tokens + cost in USD. */
  chat(modelId: string, req: ChatRequest): Promise<ChatResponse>;
}

const QUALITY_RANK: Record<NonNullable<RouteRequirements["quality"]>, number> = {
  fast: 0,
  balanced: 1,
  high: 2,
};

/* ─────────── Default catalogue ─────────── */

export const DEFAULT_CATALOGUE: ModelCard[] = [
  // Anthropic
  { id: "anthropic/claude-opus-4-7", provider: "anthropic", contextTokens: 200_000, inputUsdPer1K: 15, outputUsdPer1K: 75, quality: "high", openWeight: false, tags: ["coding", "reasoning"] },
  { id: "anthropic/claude-sonnet-4-6", provider: "anthropic", contextTokens: 200_000, inputUsdPer1K: 3, outputUsdPer1K: 15, quality: "balanced", openWeight: false },
  { id: "anthropic/claude-haiku-4-5", provider: "anthropic", contextTokens: 200_000, inputUsdPer1K: 0.8, outputUsdPer1K: 4, quality: "fast", openWeight: false },
  // OpenAI
  { id: "openai/gpt-5", provider: "openai", contextTokens: 256_000, inputUsdPer1K: 8, outputUsdPer1K: 24, quality: "high", openWeight: false, tags: ["reasoning"] },
  { id: "openai/gpt-5-mini", provider: "openai", contextTokens: 256_000, inputUsdPer1K: 0.6, outputUsdPer1K: 2.4, quality: "fast", openWeight: false },
  // Google
  { id: "google/gemini-2.5-pro", provider: "google", contextTokens: 2_000_000, inputUsdPer1K: 2.5, outputUsdPer1K: 10, quality: "high", openWeight: false, tags: ["long-context"] },
  // Open-weight: Xiaomi MiMo-V2.5-Pro
  { id: "xiaomi/mimo-v2.5-pro", provider: "openrouter", contextTokens: 1_000_000, inputUsdPer1K: 0.5, outputUsdPer1K: 1.5, quality: "high", openWeight: true, tags: ["long-context", "agent", "coding", "open-weight", "sovereign"] },
  { id: "xiaomi/mimo-v2.5", provider: "openrouter", contextTokens: 1_000_000, inputUsdPer1K: 0.3, outputUsdPer1K: 0.9, quality: "balanced", openWeight: true, tags: ["omni", "open-weight", "sovereign"] },
  // OpenRouter fallback (cheap, generic)
  { id: "openrouter/auto", provider: "openrouter", contextTokens: 128_000, inputUsdPer1K: 1, outputUsdPer1K: 3, quality: "balanced", openWeight: false, tags: ["fallback"] },
];

/* ─────────── Router ─────────── */

export class LlmRouter {
  private providers = new Map<string, Provider>();
  constructor(private catalogue: ModelCard[] = DEFAULT_CATALOGUE) {}

  register(provider: Provider): void {
    this.providers.set(provider.name, provider);
  }

  /** Pure scoring — usable without making a network call. */
  pick(req: RouteRequirements): ModelCard {
    if (req.preferModel) {
      const exact = this.catalogue.find((m) => m.id === req.preferModel);
      if (exact) return exact;
    }
    const candidates = this.catalogue.filter((m) => {
      if (req.sovereign && !m.openWeight) return false;
      if (req.minContextK && m.contextTokens < req.minContextK * 1024) return false;
      if (req.maxUsdPer1K !== undefined && (m.inputUsdPer1K + m.outputUsdPer1K) / 2 > req.maxUsdPer1K) return false;
      if (req.quality && QUALITY_RANK[m.quality] < QUALITY_RANK[req.quality]) return false;
      return true;
    });
    if (candidates.length === 0) {
      throw new Error(`router: no model satisfies ${JSON.stringify(req)}`);
    }
    candidates.sort((a, b) => {
      // Prefer matching tags first, then higher quality, then lower cost.
      const tagBoost = (m: ModelCard) =>
        (req.preferTags ?? []).reduce((acc, tag) => acc + ((m.tags ?? []).includes(tag) ? 1 : 0), 0);
      const tdiff = tagBoost(b) - tagBoost(a);
      if (tdiff !== 0) return tdiff;
      const qdiff = QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality];
      if (qdiff !== 0) return qdiff;
      return (a.inputUsdPer1K + a.outputUsdPer1K) - (b.inputUsdPer1K + b.outputUsdPer1K);
    });
    return candidates[0];
  }

  async chat(req: ChatRequest, route: RouteRequirements): Promise<ChatResponse> {
    const card = this.pick(route);
    const provider = this.providers.get(card.provider);
    if (!provider) throw new Error(`router: provider '${card.provider}' not registered for model '${card.id}'`);
    return provider.chat(card.id, req);
  }
}

export * from "./providers.js";

/* ─────────── Mock provider for tests ─────────── */

export class MockProvider implements Provider {
  name: string;
  constructor(name = "mock") {
    this.name = name;
  }
  async chat(modelId: string, req: ChatRequest): Promise<ChatResponse> {
    const inputTokens = req.messages.reduce((a, m) => a + m.content.length / 4, 0);
    const outputTokens = 32;
    return {
      text: `mock(${modelId}): ${req.messages[req.messages.length - 1]?.content?.slice(0, 80) ?? ""}`,
      model: modelId,
      inputTokens: Math.round(inputTokens),
      outputTokens,
      costUsd: 0,
    };
  }
}
