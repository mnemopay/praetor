import plugins from "./registry/plugins.json" with { type: "json" };
import type { PluginInfo } from "./types.js";

const pluginNamePattern = /^@[\w.-]+\/[\w.-]+$/;

export function getPluginRegistry(): PluginInfo[] {
  return plugins as PluginInfo[];
}

export function validatePluginName(name: string): boolean {
  return pluginNamePattern.test(name);
}
