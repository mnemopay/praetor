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

function costFor(
  card: ModelCard | undefined,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
  cacheWriteTokens = 0,
): number {
  if (!card) return 0;
  // Cached reads are billed at 10% of input price; cache writes (Anthropic
  // ephemeral) at 125%. Net: a stable system prompt cached across N calls
  // pays 1× write + (N-1) × 0.1× = ≈10% of the uncached run cost at N≥10.
  const freshInput = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens);
  return (
    (freshInput / 1000) * card.inputUsdPer1K +
    (cachedInputTokens / 1000) * card.inputUsdPer1K * 0.10 +
    (cacheWriteTokens / 1000) * card.inputUsdPer1K * 1.25 +
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
      ...(req.tools && req.tools.length > 0 ? { tools: req.tools } : {}),
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
      choices?: { message?: { content?: string; tool_calls?: any[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      model?: string;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const toolCalls = data.choices?.[0]?.message?.tool_calls;
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const cachedInputTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const card = lookupCard(this.catalogue, modelId);
    return {
      text,
      ...(toolCalls ? { toolCalls } : {}),
      model: data.model ?? modelId,
      inputTokens,
      outputTokens,
      cachedInputTokens: cachedInputTokens || undefined,
      costUsd: costFor(card, inputTokens, outputTokens, cachedInputTokens),
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
    const body = buildAnthropicBody(modelId, req);
    const res = await this.fetchImpl(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.headers(req.cache),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string; tool_use?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
      model?: string;
    };
    const text = (data.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const cachedInputTokens = data.usage?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = data.usage?.cache_creation_input_tokens ?? 0;
    const card = lookupCard(this.catalogue, modelId);
    return {
      text,
      model: data.model ?? modelId,
      inputTokens: inputTokens + cachedInputTokens + cacheWriteTokens,
      outputTokens,
      cachedInputTokens: cachedInputTokens || undefined,
      cacheWriteTokens: cacheWriteTokens || undefined,
      costUsd: costFor(card, inputTokens + cachedInputTokens + cacheWriteTokens, outputTokens, cachedInputTokens, cacheWriteTokens),
    };
  }

  private headers(cache?: boolean): Record<string, string> {
    const h: Record<string, string> = {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
    if (cache) {
      // Prompt caching is GA in 2026; the beta header is harmless to include
      // for older orgs that haven't been migrated.
      h["anthropic-beta"] = "prompt-caching-2024-07-31";
    }
    return h;
  }
}

/**
 * Build the Anthropic /messages request body. Threads `cache_control` onto
 * the system block and the last tool definition when `req.cache === true`,
 * which is the canonical pattern for caching the stable prompt prefix.
 */
export function buildAnthropicBody(modelId: string, req: ChatRequest): Record<string, unknown> {
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
  if (sys) {
    body.system = req.cache
      ? [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }]
      : sys;
  }
  if (req.tools && req.tools.length > 0) {
    // Anthropic's tool schema differs from OpenAI's: name/description/input_schema at top level.
    const tools = req.tools.map((t, i) => {
      const tool: Record<string, unknown> = {
        name: t.function.name,
        description: t.function.description ?? "",
        input_schema: t.function.parameters ?? { type: "object", properties: {} },
      };
      // Mark the LAST tool with cache_control so everything before it
      // (system + all preceding tools) gets cached together.
      if (req.cache && i === (req.tools!.length - 1)) {
        tool.cache_control = { type: "ephemeral" };
      }
      return tool;
    });
    body.tools = tools;
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  return body;
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
    if (req.tools && req.tools.length > 0) body.tools = req.tools;
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
      choices?: { message?: { content?: string; tool_calls?: any[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      model?: string;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const toolCalls = data.choices?.[0]?.message?.tool_calls;
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const cachedInputTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const card = lookupCard(this.catalogue, modelId);
    return {
      text,
      ...(toolCalls ? { toolCalls } : {}),
      model: data.model ?? modelId,
      inputTokens,
      outputTokens,
      cachedInputTokens: cachedInputTokens || undefined,
      costUsd: costFor(card, inputTokens, outputTokens, cachedInputTokens),
    };
  }
}

/* ─────────── Anthropic Batch API ─────────── */

export interface BatchRequestItem {
  /** Caller-supplied id, echoed back in the result map. */
  customId: string;
  modelId: string;
  request: ChatRequest;
}

export interface BatchSubmitResult {
  /** Anthropic batch id. Use this with `getAnthropicBatch()` to poll. */
  batchId: string;
  /** Snapshot of the items submitted, indexed by customId. */
  itemCount: number;
}

export interface BatchPollResult {
  /** "in_progress" | "ended" | "canceling" | "canceled" — when "ended", `results` is populated. */
  processingStatus: string;
  /** Map of customId → response, only populated when status is "ended". */
  results?: Map<string, ChatResponse>;
}

/**
 * Submit a batch of chat requests to Anthropic's /v1/messages/batches API.
 * Async by design: results dribble in over minutes; the caller polls via
 * `getAnthropicBatch(batchId)`. 50% discount on input + output tokens.
 *
 * Use case: charters tagged `async: true` (overnight summarization, bulk
 * extraction, fan-out research) where individual-call latency doesn't
 * matter and the FiscalGate budget benefits from the discount.
 */
export async function submitAnthropicBatch(
  apiKey: string,
  items: BatchRequestItem[],
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<BatchSubmitResult> {
  const baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1";
  const f = opts.fetchImpl ?? fetch;
  const requests = items.map((item) => ({
    custom_id: item.customId,
    params: buildAnthropicBody(item.modelId, item.request),
  }));
  const res = await f(`${baseUrl}/messages/batches`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
      "content-type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic batch submit ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Anthropic batch submit: missing id in response");
  return { batchId: data.id, itemCount: items.length };
}

/**
 * Poll an Anthropic batch. When `processingStatus === "ended"`, fetches the
 * results jsonl and returns a Map<customId, ChatResponse> with cost
 * computed from the catalogue (Anthropic batch pricing is 50% off both
 * sides — applied here so the FiscalGate sees real numbers).
 */
export async function getAnthropicBatch(
  apiKey: string,
  batchId: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch; catalogue?: ModelCard[] } = {},
): Promise<BatchPollResult> {
  const baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1";
  const f = opts.fetchImpl ?? fetch;
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "message-batches-2024-09-24",
  };
  const meta = await f(`${baseUrl}/messages/batches/${batchId}`, { headers });
  if (!meta.ok) throw new Error(`Anthropic batch poll ${meta.status}: ${await meta.text()}`);
  const m = (await meta.json()) as { processing_status?: string; results_url?: string };
  const status = m.processing_status ?? "in_progress";
  if (status !== "ended" || !m.results_url) {
    return { processingStatus: status };
  }
  const resultsRes = await f(m.results_url, { headers });
  if (!resultsRes.ok) throw new Error(`Anthropic batch results ${resultsRes.status}`);
  const text = await resultsRes.text();
  const results = new Map<string, ChatResponse>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      custom_id?: string;
      result?: {
        type?: string;
        message?: {
          content?: { type: string; text?: string }[];
          model?: string;
          usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
        };
      };
    };
    if (!row.custom_id || row.result?.type !== "succeeded" || !row.result.message) continue;
    const msg = row.result.message;
    const inputTokens = msg.usage?.input_tokens ?? 0;
    const outputTokens = msg.usage?.output_tokens ?? 0;
    const cachedInputTokens = msg.usage?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = msg.usage?.cache_creation_input_tokens ?? 0;
    const card = lookupCard(opts.catalogue, msg.model ? `anthropic/${msg.model.replace(/^anthropic\//, "")}` : "");
    const totalInput = inputTokens + cachedInputTokens + cacheWriteTokens;
    const fullCost = costFor(card, totalInput, outputTokens, cachedInputTokens, cacheWriteTokens);
    results.set(row.custom_id, {
      text: (msg.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join(""),
      model: msg.model ?? "unknown",
      inputTokens: totalInput,
      outputTokens,
      cachedInputTokens: cachedInputTokens || undefined,
      cacheWriteTokens: cacheWriteTokens || undefined,
      // Batch is 50% off both input + output.
      costUsd: fullCost * 0.5,
    });
  }
  return { processingStatus: status, results };
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
