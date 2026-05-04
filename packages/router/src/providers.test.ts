import { describe, it, expect, vi } from "vitest";
import { OpenRouterProvider, AnthropicProvider, OpenAIProvider, registerDefaultProviders, buildAnthropicBody, submitAnthropicBatch, getAnthropicBatch } from "./providers.js";
import { LlmRouter, DEFAULT_CATALOGUE, submitBatch, pollBatch } from "./index.js";

function mkResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OpenRouterProvider", () => {
  it("posts to /chat/completions with bearer auth and surfaces text + tokens + cost", async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        model: "xiaomi/mimo-v2.5-pro",
      }),
    ) as unknown as typeof fetch;
    const p = new OpenRouterProvider({ apiKey: "or-x", fetchImpl, catalogue: DEFAULT_CATALOGUE });
    const r = await p.chat("xiaomi/mimo-v2.5-pro", { messages: [{ role: "user", content: "hi" }] });
    expect(r.text).toBe("hello");
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(50);
    // 100/1000 * 0.5 + 50/1000 * 1.5 = 0.05 + 0.075 = 0.125
    expect(r.costUsd).toBeCloseTo(0.125, 6);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((call[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer or-x" });
  });

  it("throws on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const p = new OpenRouterProvider({ apiKey: "k", fetchImpl });
    await expect(p.chat("xiaomi/mimo-v2.5-pro", { messages: [] })).rejects.toThrow(/OpenRouter 429/);
  });
});

describe("AnthropicProvider", () => {
  it("hoists system messages and posts to /messages", async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: "claude-sonnet-4-6",
      }),
    ) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: "sk-ant", fetchImpl, catalogue: DEFAULT_CATALOGUE });
    const r = await p.chat("anthropic/claude-sonnet-4-6", {
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
    });
    expect(r.text).toBe("ok");
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.model).toBe("claude-sonnet-4-6"); // anthropic/ prefix stripped
    expect(body.system).toBe("be terse");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    // 10/1000 * 3 + 20/1000 * 15 = 0.03 + 0.3 = 0.33
    expect(r.costUsd).toBeCloseTo(0.33, 6);
  });
});

describe("OpenAIProvider", () => {
  it("strips openai/ prefix and posts to /chat/completions", async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({
        choices: [{ message: { content: "yo" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
        model: "gpt-5-mini",
      }),
    ) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: "sk-x", fetchImpl, catalogue: DEFAULT_CATALOGUE });
    const r = await p.chat("openai/gpt-5-mini", { messages: [{ role: "user", content: "hi" }] });
    expect(r.text).toBe("yo");
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.model).toBe("gpt-5-mini");
  });
});

describe("Prompt caching — Anthropic", () => {
  it("buildAnthropicBody: cache=true marks system + last tool with cache_control", () => {
    const body = buildAnthropicBody("anthropic/claude-sonnet-4-6", {
      messages: [
        { role: "system", content: "you are praetor" },
        { role: "user", content: "ok" },
      ],
      tools: [
        { type: "function", function: { name: "a", description: "first", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "b", description: "second", parameters: { type: "object", properties: {} } } },
      ],
      cache: true,
    });
    expect(Array.isArray(body.system)).toBe(true);
    const sysBlock = (body.system as { cache_control?: unknown }[])[0];
    expect(sysBlock.cache_control).toEqual({ type: "ephemeral" });
    const tools = body.tools as { name: string; cache_control?: unknown }[];
    expect(tools[0].cache_control).toBeUndefined();
    expect(tools[tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("buildAnthropicBody: cache=false (default) keeps system as plain string + no cache markers", () => {
    const body = buildAnthropicBody("anthropic/claude-sonnet-4-6", {
      messages: [{ role: "system", content: "x" }, { role: "user", content: "ok" }],
      tools: [{ type: "function", function: { name: "a" } }],
    });
    expect(typeof body.system).toBe("string");
    const tools = body.tools as { cache_control?: unknown }[];
    expect(tools[0].cache_control).toBeUndefined();
  });

  it("AnthropicProvider: parses cache_read + cache_creation tokens and applies discount/surcharge", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 100,                       // fresh
          cache_read_input_tokens: 800,            // 0.1× rate
          cache_creation_input_tokens: 200,        // 1.25× rate
          output_tokens: 50,
        },
        model: "claude-sonnet-4-6",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: "k", fetchImpl, catalogue: DEFAULT_CATALOGUE });
    const r = await p.chat("anthropic/claude-sonnet-4-6", {
      messages: [{ role: "system", content: "stable" }, { role: "user", content: "hi" }],
      cache: true,
    });
    expect(r.cachedInputTokens).toBe(800);
    expect(r.cacheWriteTokens).toBe(200);
    expect(r.inputTokens).toBe(1100); // total reported
    // Sonnet is $3/MTok input + $15/MTok output. Cost:
    //   100/1000 * 3 (fresh) +
    //   800/1000 * 3 * 0.10 (cache read) +
    //   200/1000 * 3 * 1.25 (cache write) +
    //   50/1000 * 15 (output)
    //   = 0.30 + 0.24 + 0.75 + 0.75 = 2.04
    expect(r.costUsd).toBeCloseTo(2.04, 4);
    // Confirms anthropic-beta header is present when cache=true.
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toContain("prompt-caching");
  });
});

describe("Prompt caching — OpenAI auto-cache discount", () => {
  it("parses prompt_tokens_details.cached_tokens and discounts cost", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: "yo" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 700 } },
        model: "gpt-5-mini",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: "k", fetchImpl, catalogue: DEFAULT_CATALOGUE });
    const r = await p.chat("openai/gpt-5-mini", { messages: [{ role: "user", content: "hi" }] });
    expect(r.cachedInputTokens).toBe(700);
    // gpt-5-mini: $0.6 input, $2.4 output per 1K. Cost:
    //   300/1000 * 0.6 (fresh) +
    //   700/1000 * 0.6 * 0.10 (cached) +
    //   50/1000 * 2.4 (output)
    //   = 0.18 + 0.042 + 0.12 = 0.342
    expect(r.costUsd).toBeCloseTo(0.342, 4);
  });
});

describe("Anthropic Batch API", () => {
  it("submitAnthropicBatch posts requests under custom_id and returns batch id", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { requests: { custom_id: string }[] };
      expect(body.requests).toHaveLength(2);
      expect(body.requests.map((r) => r.custom_id)).toEqual(["a", "b"]);
      return new Response(JSON.stringify({ id: "batch-xyz", processing_status: "in_progress" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await submitAnthropicBatch("k", [
      { customId: "a", modelId: "anthropic/claude-haiku-4-5", request: { messages: [{ role: "user", content: "1" }] } },
      { customId: "b", modelId: "anthropic/claude-haiku-4-5", request: { messages: [{ role: "user", content: "2" }] } },
    ], { fetchImpl });
    expect(r.batchId).toBe("batch-xyz");
    expect(r.itemCount).toBe(2);
  });

  it("getAnthropicBatch returns processingStatus when not ended", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ processing_status: "in_progress" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await getAnthropicBatch("k", "batch-xyz", { fetchImpl });
    expect(r.processingStatus).toBe("in_progress");
    expect(r.results).toBeUndefined();
  });

  it("getAnthropicBatch parses jsonl results when ended and applies 50% batch discount", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("batch-xyz")) {
        return new Response(JSON.stringify({ processing_status: "ended", results_url: "https://api.anthropic.com/v1/messages/batches/batch-xyz/results" }), { status: 200 });
      }
      const jsonl = [
        JSON.stringify({ custom_id: "a", result: { type: "succeeded", message: { content: [{ type: "text", text: "first" }], model: "claude-haiku-4-5", usage: { input_tokens: 100, output_tokens: 50 } } } }),
        JSON.stringify({ custom_id: "b", result: { type: "succeeded", message: { content: [{ type: "text", text: "second" }], model: "claude-haiku-4-5", usage: { input_tokens: 200, output_tokens: 25 } } } }),
      ].join("\n");
      return new Response(jsonl, { status: 200, headers: { "content-type": "application/jsonl" } });
    }) as unknown as typeof fetch;
    const r = await getAnthropicBatch("k", "batch-xyz", { fetchImpl, catalogue: DEFAULT_CATALOGUE });
    expect(r.processingStatus).toBe("ended");
    const aResult = r.results!.get("a")!;
    expect(aResult.text).toBe("first");
    // Haiku: $0.8 input + $4 output per 1K. Full cost = 100/1000*0.8 + 50/1000*4 = 0.08 + 0.2 = 0.28
    // Batch discount = 50% → 0.14
    expect(aResult.costUsd).toBeCloseTo(0.14, 4);
  });

  it("submitBatch via router rejects non-anthropic routes (today)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const router = new LlmRouter();
    await expect(submitBatch(router, "k", [
      { customId: "a", route: { quality: "fast", preferModel: "openai/gpt-5-mini" }, request: { messages: [{ role: "user", content: "x" }] } },
    ], { fetchImpl })).rejects.toThrow(/only anthropic batch supported/);
  });
});

describe("registerDefaultProviders", () => {
  it("registers only providers with env keys present", () => {
    const r = new LlmRouter();
    registerDefaultProviders(r, { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "" } as unknown as NodeJS.ProcessEnv);
    expect(() => r.pick({ quality: "balanced" })).not.toThrow();
  });

  it("no-op when env is empty (router still picks but chat will fail)", async () => {
    const r = new LlmRouter();
    registerDefaultProviders(r, {} as NodeJS.ProcessEnv);
    await expect(r.chat({ messages: [{ role: "user", content: "x" }] }, {})).rejects.toThrow(/provider .* not registered/);
  });
});
