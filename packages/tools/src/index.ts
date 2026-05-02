/**
 * @praetor/tools — MCP-compatible tool registry.
 *
 * A charter declares `tools: ["weather", "stripe.charge"]`. The runtime resolves
 * those names through this registry, runs them with the matching JSON-schema
 * argument shape, and routes every call through MnemoPay's HITL fiscal gate
 * (when the tool declares a cost) so a poisoned MCP server cannot drain budget.
 */

export interface ToolSchema {
  type: "object";
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProp {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProp;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  /** Approximate per-call cost in USD. Used by MnemoPay HITL gate. 0 = no charge. */
  costUsd?: number;
  /** Tags help charters discover tools — e.g. ["weather", "free", "no-auth"]. */
  tags?: readonly string[];
  /** Roles that are allowed to execute this tool. If empty, all roles can. */
  allowedRoles?: readonly string[];
}

export type ToolHandler<I = Record<string, unknown>, O = unknown> = (input: I) => Promise<O>;

export interface FiscalGate {
  /** Called before a tool runs. Throws if the call is denied (out of budget, HITL rejected). */
  approve(call: { tool: string; estUsd: number; input: Record<string, unknown> }): Promise<void>;
  /** Called after the tool finishes (or throws) so spend can be settled. */
  settle(call: { tool: string; estUsd: number; actualUsd?: number; error?: string }): Promise<void>;
}

export interface ToolCallContext {
  audit?: { record: (type: string, data: Record<string, unknown>) => void };
  fiscal?: FiscalGate;
  role?: string;
}

interface RegisteredTool {
  def: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register<I extends Record<string, unknown>, O>(def: ToolDefinition, handler: ToolHandler<I, O>): void {
    if (this.tools.has(def.name)) {
      throw new Error(`tool '${def.name}' already registered`);
    }
    this.tools.set(def.name, { def, handler: handler as ToolHandler });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.def;
  }

  list(role?: string): ToolDefinition[] {
    const all = [...this.tools.values()].map((t) => t.def);
    if (!role) return all;
    return all.filter(t => !t.allowedRoles || t.allowedRoles.length === 0 || t.allowedRoles.includes(role));
  }

  search(query: string): ToolDefinition[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
    );
  }

  async call<O = unknown>(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolCallContext = {}
  ): Promise<O> {
    const reg = this.tools.get(name);
    if (!reg) throw new Error(`tool '${name}' not registered`);
    if (reg.def.allowedRoles?.length && (!ctx.role || !reg.def.allowedRoles.includes(ctx.role))) {
      throw new Error(`tool '${name}' is not allowed for role '${ctx.role ?? "unknown"}'`);
    }
    validateAgainstSchema(input, reg.def.schema, name);

    const estUsd = reg.def.costUsd ?? 0;
    if (estUsd > 0 && ctx.fiscal) {
      await ctx.fiscal.approve({ tool: name, estUsd, input });
    }
    ctx.audit?.record("tool.call.start", { name, estUsd, input: redact(input) });

    try {
      const out = (await reg.handler(input)) as O;
      ctx.audit?.record("tool.call.ok", { name, estUsd });
      if (estUsd > 0 && ctx.fiscal) {
        await ctx.fiscal.settle({ tool: name, estUsd, actualUsd: estUsd });
      }
      return out;
    } catch (e) {
      const error = (e as Error).message;
      ctx.audit?.record("tool.call.error", { name, error });
      if (estUsd > 0 && ctx.fiscal) {
        await ctx.fiscal.settle({ tool: name, estUsd, error });
      }
      throw e;
    }
  }
}

function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (/(api[_-]?key|token|secret|password|auth)/i.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function validateAgainstSchema(input: Record<string, unknown>, schema: ToolSchema, toolName: string): void {
  for (const req of schema.required ?? []) {
    if (!(req in input)) {
      throw new Error(`tool '${toolName}': missing required field '${req}'`);
    }
  }
  for (const [k, v] of Object.entries(input)) {
    const prop = schema.properties[k];
    if (!prop) {
      if (schema.additionalProperties === false) {
        throw new Error(`tool '${toolName}': unknown field '${k}'`);
      }
      continue;
    }
    if (!matchesType(v, prop)) {
      throw new Error(`tool '${toolName}': field '${k}' must be ${prop.type}`);
    }
    if (prop.enum && !prop.enum.includes(v)) {
      throw new Error(`tool '${toolName}': field '${k}' must be one of ${JSON.stringify(prop.enum)}`);
    }
  }
}

function matchesType(v: unknown, prop: JsonSchemaProp): boolean {
  switch (prop.type) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array":
      return Array.isArray(v);
  }
}

/**
 * Starter directory — a thin wrapper over public-apis (github.com/public-apis/public-apis).
 * Each entry registers as a charter-callable tool with no auth.
 */
export interface PublicApiEntry {
  name: string;
  description: string;
  url: string;
  tags?: readonly string[];
}

export function registerPublicApi(reg: ToolRegistry, entry: PublicApiEntry): void {
  reg.register(
    {
      name: entry.name,
      description: entry.description,
      schema: {
        type: "object",
        properties: { path: { type: "string", description: "Path appended to the base URL." } },
        required: [],
      },
      tags: entry.tags ?? ["public-api", "free"],
    },
    async ({ path }) => {
      const url = path ? `${entry.url}${path}` : entry.url;
      const res = await fetch(url);
      const ct = res.headers.get("content-type") ?? "";
      const body = ct.includes("application/json") ? await res.json() : await res.text();
      return { status: res.status, body };
    }
  );
}

/** A small starter set — Jerry can extend by sourcing from public-apis. */
export const STARTER_TOOLS: PublicApiEntry[] = [
  {
    name: "openweathermap.current",
    description: "Current weather by city (requires appid query param).",
    url: "https://api.openweathermap.org/data/2.5/weather",
    tags: ["weather"],
  },
  {
    name: "coingecko.simple_price",
    description: "Simple crypto price lookup. /price?ids=bitcoin&vs_currencies=usd",
    url: "https://api.coingecko.com/api/v3/simple",
    tags: ["finance", "crypto"],
  },
  {
    name: "rest_countries.name",
    description: "Look up a country by name. /name/{name}",
    url: "https://restcountries.com/v3.1",
    tags: ["geo"],
  },
];

export function defaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  for (const e of STARTER_TOOLS) registerPublicApi(reg, e);
  return reg;
}
