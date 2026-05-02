// @ts-ignore
import screenshot from "screenshot-desktop";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const capture_screen = {
  name: "capture_screen",
  description: "Captures a screenshot of the host operating system's primary display. Returns the absolute path to the saved PNG image.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  },
  costUsd: 0,
  metadata: {
    origin: "adapter",
    capability: "computer_screen_capture",
    risk: ["browser", "filesystem"],
    approval: "always",
    sandbox: "host",
    production: "needs-live-test",
    costEffective: true,
  },
  execute: async () => {
    try {
      const img = await screenshot({ format: 'png' });
      const filename = `screenshot-${randomBytes(4).toString("hex")}.png`;
      const path = join(process.cwd(), filename);
      await writeFile(path, img);
      return { ok: true, path };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
};

export const analyze_image = {
  name: "analyze_image",
  description: "Analyzes an image using a Vision LLM to extract text, describe UI, or answer questions about the visual content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the image file" },
      prompt: { type: "string", description: "What to look for in the image" }
    },
    required: ["path", "prompt"]
  },
  costUsd: 0.05,
  metadata: {
    origin: "mock",
    capability: "vision_image_analyze",
    risk: ["spend"],
    approval: "on-cost",
    sandbox: "remote-provider",
    production: "stub",
    costEffective: true,
  },
  execute: async (args: any) => {
    // In V1, this returns a mock analysis until the Router is upgraded to pass multi-modal Base64 tokens.
    // The user can inject their preferred Vision API (OpenRouter/Anthropic) here.
    return { 
      ok: true, 
      analysis: `[MOCK_VISION] Analyzed image at ${args.path}. Simulated result: The image contains standard desktop UI elements related to the query: "${args.prompt}".` 
    };
  }
};
