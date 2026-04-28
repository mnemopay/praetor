/**
 * Real HTTP providers for Praetor's LLM router.
 *
 * Each provider:
 *   - implements `Provider` from index.ts
 *   - reads its key from env (or accepts it via constructor)
 *   - posts a chat completion to the vendor's REST API
 *   - returns text + token counts + computed USD cost using the matching
 *     ModelCard from the router catalogue (so the budget gate sees real numbers)
 *
 * No vendor SDKs are used — keeps Praetor dependency-light and lets the same
 * code run in browsers / edge runtimes.
 */

import type { ChatRequest, ChatResponse, ModelCard, Provider } from "./index.js";

export interface ProviderOpts {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Catalogue used to compute cost from input/output tokens. Defaults to DEFAULT_CATALOGUE. */
  catalogue?: ModelCard[];
}

function lookupCard(catalogue: ModelCard[] | undefined, modelId: string): ModelCard | undefined {
  return (catalogue ?? []).find((m) => m.id === modelId);
}

function costFor(card: ModelCard | undefined, inputTokens: number, outputTokens: number): number {
  if (!card) return 0;
  return (
    (inputTokens / 1000) * card.inputUsdPer1K +
    (outputTokens / 1000) * card.outputUsdPer1K
  );
}

/* ─────────── OpenRouter ─────────── */

export class OpenRouterProvider implements Provider {
  name = "openrouter";
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private catalogue?: ModelCard[];

  constructor(opts: ProviderOpts = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.catalogue = opts.catalogue;
    if (!this.apiKey) throw new Error("OpenRouterProvider: OPENROUTER_API_KEY not set");
  }

  async chat(modelId: string, req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: modelId,
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    };
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://praetor.dev",
        "X-Title": "Praetor",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const card = lookupCard(this.catalogue, modelId);
    return {
      text,
      model: data.model ?? modelId,
      inputTokens,
      outputTokens,
      costUsd: costFor(card, inputTokens, outputTokens),
    };
  }
}

/* ─────────── Anthropic ─────────── */

export class AnthropicProvider implements Provider {
  name = "anthropic";
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private catalogue?: ModelCard[];

  constructor(opts: ProviderOpts = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.catalogue = opts.catalogue;
    if (!this.apiKey) throw new Error("AnthropicProvider: ANTHROPIC_API_KEY not set");
  }

  async chat(modelId: string, req: ChatRequest): Promise<ChatResponse> {
    const id = modelId.replace(/^anthropic\//, "");
    const sys = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const body: Record<string, unknown> = {
      model: id,
      max_tokens: req.maxTokens ?? 1024,
      messages,
    };
    if (sys) body.system = sys;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    const res = await this.fetchImpl(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const text = (data.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const card = lookupCard(this.catalogue, modelId);
    return {
      text,
      model: data.model ?? modelId,
      inputTokens,
      outputTokens,
      costUsd: costFor(card, inputTokens, outputTokens),
    };
  }
}

/* ─────────── OpenAI ─────────── */

export class OpenAIProvider implements Provider {
  name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private catalogue?: ModelCard[];

  constructor(opts: ProviderOpts = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.catalogue = opts.catalogue;
    if (!this.apiKey) throw new Error("OpenAIProvider: OPENAI_API_KEY not set");
  }

  async chat(modelId: string, req: ChatRequest): Promise<ChatResponse> {
    const id = modelId.replace(/^openai\//, "");
    const isReasoning = /^gpt-5/.test(id) || /^o\d/.test(id);
    const body: Record<string, unknown> = {
      model: id,
      messages: req.messages,
    };
    if (req.temperature !== undefined && !isReasoning) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) {
      if (isReasoning) body.max_completion_tokens = req.maxTokens;
      else body.max_tokens = req.maxTokens;
    }
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const card = lookupCard(this.catalogue, modelId);
    return {
      text,
      model: data.model ?? modelId,
      inputTokens,
      outputTokens,
      costUsd: costFor(card, inputTokens, outputTokens),
    };
  }
}

/* ─────────── defaultProviders ─────────── */

import type { LlmRouter } from "./index.js";

/**
 * Register every provider for which the env has a key.
 * Returns the router so callers can chain. If no keys are found, the router
 * will still work for `pick()` (pure scoring) but `chat()` will fail with
 * "provider not registered".
 */
export function registerDefaultProviders(
  router: LlmRouter,
  env: NodeJS.ProcessEnv = process.env,
  opts: { catalogue?: ModelCard[]; fetchImpl?: typeof fetch } = {},
): LlmRouter {
  const shared = { catalogue: opts.catalogue, fetchImpl: opts.fetchImpl };
  if (env.ANTHROPIC_API_KEY) router.register(new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, ...shared }));
  if (env.OPENAI_API_KEY) router.register(new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, ...shared }));
  if (env.OPENROUTER_API_KEY) router.register(new OpenRouterProvider({ apiKey: env.OPENROUTER_API_KEY, ...shared }));
  return router;
}
