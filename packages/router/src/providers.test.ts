import { describe, it, expect, vi } from "vitest";
import { OpenRouterProvider, AnthropicProvider, OpenAIProvider, registerDefaultProviders } from "./providers.js";
import { LlmRouter, DEFAULT_CATALOGUE } from "./index.js";

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
