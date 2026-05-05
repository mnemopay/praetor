/**
 * createActivityToolContext — bridges the ToolRegistry's audit hook to the
 * Praetor activity bus. Drop-in replacement for any existing
 * `ToolCallContext`: every `tool.call.start/ok/error` audit becomes a
 * `tool.start` / `tool.end` `ActivityEvent` on the supplied bus.
 *
 * Why: the dashboard's "see what the agent is doing" feed and the
 * upcoming dashboard-chat ↔ activity-stream wiring all consume
 * `ActivityEvent`s. Until now coding-agent tool calls weren't surfacing
 * onto that bus, so a running coding mission looked silent from the
 * outside.
 *
 * Returned context is fully composable with any existing audit / fiscal
 * hooks via the `wrap` parameter.
 */

import type { ActivityBus, ActivityEvent } from "@kpanks/core";
import type { ToolCallContext } from "@kpanks/tools";

export interface CreateActivityToolContextInput {
  missionId: string;
  bus: ActivityBus;
  /** Optional underlying context to compose with — its audit/fiscal hooks still run. */
  wrap?: ToolCallContext;
  /**
   * Whether to include the (potentially large) tool result in the
   * `tool.end` event payload. Defaults to `true`. Set false to keep the
   * bus payload small for chatty tools (e.g. read_file on a 1MB file).
   */
  includeResults?: boolean;
}

interface AuditPayload {
  eventId?: string;
  name?: string;
  estUsd?: number;
  role?: string;
  metadata?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export function createActivityToolContext(input: CreateActivityToolContextInput): ToolCallContext {
  const wrapped = input.wrap;
  const includeResults = input.includeResults ?? true;

  return {
    role: wrapped?.role,
    fiscal: wrapped?.fiscal,
    audit: {
      record: (type: string, data: Record<string, unknown>) => {
        // Forward to any underlying audit sink first so existing behavior
        // (logging, persistence) doesn't get dropped on the floor.
        wrapped?.audit?.record(type, data);

        const payload = data as AuditPayload;
        const ts = new Date().toISOString();
        const eventId = typeof payload.eventId === "string" ? payload.eventId : `evt_${Date.now().toString(36)}`;
        const toolName = String(payload.name ?? "");

        let event: ActivityEvent | null = null;
        if (type === "tool.call.start") {
          event = {
            kind: "tool.start",
            missionId: input.missionId,
            eventId,
            toolName,
            args: payload.input ?? {},
            ts,
          };
        } else if (type === "tool.call.ok") {
          event = {
            kind: "tool.end",
            missionId: input.missionId,
            eventId,
            ok: true,
            result: includeResults ? payload.result : undefined,
            costUsd: typeof payload.estUsd === "number" ? payload.estUsd : undefined,
            ts,
          };
        } else if (type === "tool.call.error") {
          event = {
            kind: "tool.end",
            missionId: input.missionId,
            eventId,
            ok: false,
            result: { error: payload.error ?? "unknown error" },
            costUsd: typeof payload.estUsd === "number" ? payload.estUsd : undefined,
            ts,
          };
        }

        if (event) input.bus.publish(event);
      },
    },
  };
}
