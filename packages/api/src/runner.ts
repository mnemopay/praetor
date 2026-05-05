import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stringify } from "yaml";
import { env } from "./env.js";
import { appendMissionLog, updateMissionStatus } from "./db.js";
import type { ActivityEvent, Charter } from "@kpanks/core";
import { getActivityBus } from "./activity.js";

/**
 * Per-mission inbox path. Messages from the dashboard's "talk back" surface
 * are appended here as JSON-lines so a future hook on the running CLI can
 * ingest them between agent loop iterations. Today the inbox is a record-
 * only artifact — agent-loop ingestion is a follow-up task.
 */
export function missionInboxPath(missionId: string): string {
  return resolve(env.repoRoot, ".praetor", `inbox-${missionId}.jsonl`);
}

/**
 * Append a chat message to the per-mission inbox + publish a chat activity
 * event onto the bus so the dashboard re-renders the conversation. Returns
 * the canonical event so callers can echo the messageId back to the client.
 */
export async function recordMissionChatMessage(input: {
  missionId: string;
  text: string;
  role: "user" | "assistant";
}): Promise<{ event: ActivityEvent; inboxPath: string }> {
  const missionDir = resolve(env.repoRoot, ".praetor");
  await mkdir(missionDir, { recursive: true });
  const inboxPath = missionInboxPath(input.missionId);
  const messageId = randomUUID();
  const ts = new Date().toISOString();
  const event: ActivityEvent =
    input.role === "user"
      ? { kind: "chat.user", missionId: input.missionId, messageId, text: input.text, ts }
      : { kind: "chat.assistant", missionId: input.missionId, messageId, text: input.text, ts };
  await appendFile(inboxPath, JSON.stringify(event) + "\n", "utf-8");
  getActivityBus().publish(event);
  return { event, inboxPath };
}

export const activeMissionPids = new Map<string, number>();
const ACTIVITY_PREFIX = "::praetor-activity::";

export function toYaml(charter: Charter): string {
  return stringify({
    ...charter,
    plugins: charter.plugins && charter.plugins.length > 0 ? charter.plugins : ["@kpanks/seo"],
  });
}

export async function startMissionRun(missionId: string, charter: Charter): Promise<void> {
  await updateMissionStatus(missionId, "running");
  const missionDir = resolve(env.repoRoot, ".praetor");
  await mkdir(missionDir, { recursive: true });
  const charterPath = join(missionDir, `saas-${missionId}.yaml`);
  const logPath = join(missionDir, `saas-${missionId}.log`);
  await writeFile(charterPath, toYaml(charter), "utf-8");

  const logStream = createWriteStream(logPath, { flags: "a" });
  // Spawn the CLI directly. `npx praetor` triggers npm's bin-resolution
  // shim which races on Windows + fails when the global bin isn't linked
  // (which is the default when Praetor is consumed as a workspace dep).
  const cliPath = join(env.repoRoot, "packages", "cli", "dist", "index.js");
  const child = spawn(process.execPath, [cliPath, "run", charterPath], {
    cwd: env.repoRoot,
    env: { ...process.env, PRAETOR_MISSION_ID: missionId },
  });
  activeMissionPids.set(missionId, child.pid ?? 0);
  let stdoutCarry = "";

  child.stdout.on("data", async (chunk: Buffer) => {
    const text = chunk.toString();
    stdoutCarry = bridgeActivityLines(missionId, stdoutCarry + text);
    logStream.write(text);
    await appendMissionLog(missionId, text);
  });

  child.stderr.on("data", async (chunk: Buffer) => {
    const text = chunk.toString();
    logStream.write(text);
    await appendMissionLog(missionId, text);
  });

  child.on("close", async (code) => {
    activeMissionPids.delete(missionId);
    await updateMissionStatus(missionId, code === 0 ? "completed" : "failed");
    logStream.end();
  });
}

export function newMissionId(): string {
  return randomUUID();
}

function bridgeActivityLines(missionId: string, text: string): string {
  const lines = text.split(/\r?\n/);
  const carry = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith(ACTIVITY_PREFIX)) continue;
    try {
      const event = JSON.parse(line.slice(ACTIVITY_PREFIX.length)) as ActivityEvent;
      if (event.missionId !== missionId) continue;
      getActivityBus().publish(rewriteArtifactUrl(event));
    } catch {
      // Ignore malformed activity side-band lines; normal mission logging continues.
    }
  }
  return carry;
}

function rewriteArtifactUrl(event: ActivityEvent): ActivityEvent {
  if (event.kind !== "artifact.done") return event;
  const url = String(event.url ?? "");
  if (/^https?:\/\//i.test(url) || url.startsWith("/api/")) return event;
  const abs = resolve(url);
  const repoRoot = resolve(env.repoRoot);
  if (!abs.startsWith(repoRoot)) return event;
  return {
    ...event,
    url: `/api/v1/artifacts?path=${encodeURIComponent(abs)}`,
  };
}
