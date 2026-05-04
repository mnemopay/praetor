import { writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PraetorScreen } from "./screen.js";

export { PraetorScreen } from "./screen.js";
export type { ScreenAdapter, ScreenBackend, ScreenFrame, PraetorScreenOptions } from "./screen.js";

/**
 * `capture_screen` tool — captures the primary display via PraetorScreen
 * (native: PowerShell on Win, `screencapture` on Mac, grim/gnome-screenshot/
 * spectacle/import on Linux). Saves the PNG under `praetor-out/screens/`
 * and returns the absolute path so downstream tools can reference it.
 *
 * Per `feedback_praetor_native_tools.md` — every Praetor tool is custom-
 * native. The historical `screenshot-desktop` dep has been removed.
 */
export const capture_screen = {
  name: "capture_screen",
  description:
    "Captures a screenshot of the host operating system's primary display. Returns the absolute path to the saved PNG image.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  },
  costUsd: 0,
  metadata: {
    origin: "native" as const,
    capability: "computer_screen_capture",
    risk: ["browser", "filesystem"] as const,
    approval: "always" as const,
    sandbox: "host" as const,
    production: "ready" as const,
    costEffective: true,
  },
  execute: async () => {
    try {
      const screen = new PraetorScreen();
      const frame = await screen.capture();
      const dir = join(process.cwd(), "praetor-out", "screens");
      await mkdir(dir, { recursive: true });
      const filename = `screenshot-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}.png`;
      const path = join(dir, filename);
      await writeFile(path, frame.pngBuffer);
      return { ok: true, path, backend: frame.backend, ts: frame.ts };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
};

export const analyze_image = {
  name: "analyze_image",
  description:
    "Analyzes an image using a Vision LLM to extract text, describe UI, or answer questions about the visual content.",
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
    origin: "mock" as const,
    capability: "vision_image_analyze",
    risk: ["spend"] as const,
    approval: "on-cost" as const,
    sandbox: "remote-provider" as const,
    production: "stub" as const,
    costEffective: true,
  },
  execute: async (args: { path: string; prompt: string }) => {
    // V1 returns a stub until the router is upgraded for multi-modal payloads.
    return {
      ok: true,
      analysis: `[MOCK_VISION] Analyzed image at ${args.path}. Simulated result: The image contains standard desktop UI elements related to the query: "${args.prompt}".`,
    };
  }
};
