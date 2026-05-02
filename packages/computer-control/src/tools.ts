import { ToolRegistry } from "@praetor/tools";
import { PraetorComputerSession, type PraetorComputerSessionOptions } from "./session.js";

export function registerComputerTools(reg: ToolRegistry, opts?: PraetorComputerSessionOptions): void {
  const session = new PraetorComputerSession(opts);
  const tags = ["computer", "native"] as const;
  const allowedRoles = ["native"] as const; // only the native agent should use these
  
  reg.register<Record<string, unknown>, { base64: string; width: number; height: number }>(
    {
      name: "computer_screenshot",
      description: "Take a screenshot of the primary display.",
      schema: { type: "object", properties: {}, required: [] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_control", risk: ["privacy"], approval: "never", sandbox: "host", production: "ready", costEffective: true },
    },
    async () => {
      return await session.screenshot();
    }
  );

  reg.register<{ x: number; y: number; button?: "left" | "right" | "middle" }, { success: boolean }>(
    {
      name: "computer_click",
      description: "Move the mouse to (x, y) and click the specified button.",
      schema: { 
        type: "object", 
        properties: { 
          x: { type: "number" }, 
          y: { type: "number" },
          button: { type: "string", enum: ["left", "right", "middle"] }
        }, 
        required: ["x", "y"] 
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_control", risk: ["system_mutation"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ x, y, button }) => {
      await session.click(x, y, button ?? "left");
      return { success: true };
    }
  );

  reg.register<{ text: string }, { success: boolean }>(
    {
      name: "computer_type",
      description: "Type the specified string of text using the keyboard.",
      schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_control", risk: ["system_mutation"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ text }) => {
      await session.type(text);
      return { success: true };
    }
  );

  reg.register<{ keys: string[] }, { success: boolean }>(
    {
      name: "computer_hotkey",
      description: "Press a combination of keys (e.g., ['CONTROL', 'C']).",
      schema: { type: "object", properties: { keys: { type: "array", items: { type: "string" } } }, required: ["keys"] },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "computer_control", risk: ["system_mutation"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ keys }) => {
      await session.hotkey(keys);
      return { success: true };
    }
  );
}
