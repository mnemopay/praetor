import { ToolRegistry } from "@praetor/tools";
import { PraetorComputerSession, noopInputAdapter, type ComputerInputAdapter, type PraetorComputerSessionOptions } from "./session.js";

export interface RegisterComputerToolsOptions extends PraetorComputerSessionOptions {
  /**
   * If true, register the input-mutating tools (click/type/scroll/hotkey)
   * even when no input adapter is provided. The tools will throw at call
   * time, but they'll appear in the registry. Default: false — only
   * register input tools when an adapter is wired in.
   */
  alwaysRegisterInput?: boolean;
}

export function registerComputerTools(reg: ToolRegistry, opts: RegisterComputerToolsOptions = {}): void {
  const session = new PraetorComputerSession(opts);
  const tags = ["computer", "native"] as const;
  const allowedRoles = ["native", "computer-use"] as const;
  const hasInput = !!opts.input || !!opts.alwaysRegisterInput;

  reg.register<Record<string, unknown>, { base64: string; ts: string; backend: string }>(
    {
      name: "computer_screenshot",
      description: "Capture a screenshot of the primary display via PraetorScreen.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_screen_capture", risk: ["browser", "filesystem"], approval: "always", sandbox: "host", production: "ready", costEffective: true },
    },
    async () => session.screenshot(),
  );

  if (!hasInput) return;

  reg.register<{ x: number; y: number; button?: "left" | "right" | "middle" }, { success: boolean }>(
    {
      name: "computer_click",
      description: "Move the mouse to (x, y) and click the specified button.",
      schema: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          button: { type: "string", enum: ["left", "right", "middle"] },
        },
        required: ["x", "y"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_input", risk: ["browser"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ x, y, button }) => {
      await session.click(x, y, button ?? "left");
      return { success: true };
    },
  );

  reg.register<{ text: string }, { success: boolean }>(
    {
      name: "computer_type",
      description: "Type the specified string of text using the keyboard.",
      schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_input", risk: ["browser"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ text }) => {
      await session.type(text);
      return { success: true };
    },
  );

  reg.register<{ amount: number; direction?: "up" | "down" }, { success: boolean }>(
    {
      name: "computer_scroll",
      description: "Scroll the active surface by `amount` ticks in the given direction.",
      schema: {
        type: "object",
        properties: {
          amount: { type: "number" },
          direction: { type: "string", enum: ["up", "down"] },
        },
        required: ["amount"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_input", risk: ["browser"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ amount, direction }) => {
      await session.scroll(amount, direction ?? "down");
      return { success: true };
    },
  );

  reg.register<{ keys: string[] }, { success: boolean }>(
    {
      name: "computer_hotkey",
      description: "Press a chord like ['control', 'c'].",
      schema: { type: "object", properties: { keys: { type: "array", items: { type: "string" } } }, required: ["keys"] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_input", risk: ["browser"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ keys }) => {
      await session.hotkey(keys);
      return { success: true };
    },
  );
}

export { noopInputAdapter };
export type { ComputerInputAdapter };
