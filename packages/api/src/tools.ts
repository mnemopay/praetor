import type { Charter } from "@kpanks/core";
import type { ToolProductionMetadata } from "@kpanks/tools";

// @kpanks/cli depends on @kpanks/api; we lazy-import via an indirected
// specifier to break the cycle for npm publish. tsc can't resolve
// "@kpanks/cli" through a string variable, so cli stays out of the
// build graph here. (Same pattern used by packages/desktop.)
type BuildEnhancedRegistry = typeof import("@kpanks/cli").buildEnhancedRegistry;
let _buildEnhancedRegistry: BuildEnhancedRegistry | null = null;
async function buildEnhancedRegistry(charter: Charter, missionId: string) {
  if (!_buildEnhancedRegistry) {
    const cliSpec = "@kpanks/cli";
    const mod = (await import(cliSpec)) as { buildEnhancedRegistry: BuildEnhancedRegistry };
    _buildEnhancedRegistry = mod.buildEnhancedRegistry;
  }
  return _buildEnhancedRegistry(charter, missionId);
}

export interface ToolCatalogItem {
  name: string;
  description: string;
  tags: readonly string[];
  allowedRoles: readonly string[];
  costUsd: number;
  metadata: ToolProductionMetadata | null;
}

const TOOL_CATALOG_CHARTER: Charter = {
  name: "Dashboard Tool Catalog",
  goal: "Inspect Praetor's registered tool governance metadata.",
  budget: {
    maxUsd: 0,
    approvalThresholdUsd: 0,
  },
  agents: [{ role: "auditor" }],
  outputs: ["tool-catalog"],
  sandbox: { kind: "mock" },
};

export async function getToolCatalog(): Promise<{
  ok: true;
  tools: ToolCatalogItem[];
  report: ReturnType<Awaited<ReturnType<typeof buildEnhancedRegistry>>["productionReport"]>;
}> {
  const registry = await buildEnhancedRegistry(TOOL_CATALOG_CHARTER, "dashboard-tool-catalog");
  const tools = registry.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    tags: tool.tags ?? [],
    allowedRoles: tool.allowedRoles ?? [],
    costUsd: tool.costUsd ?? 0,
    metadata: tool.metadata ?? null,
  }));
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: true,
    tools,
    report: registry.productionReport(),
  };
}
