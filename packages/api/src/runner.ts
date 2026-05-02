import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stringify } from "yaml";
import { env } from "./env.js";
import { appendMissionLog, updateMissionStatus } from "./db.js";
import type { ActivityEvent, Charter } from "@praetor/core";
import { getActivityBus } from "./activity.js";

export const activeMissionPids = new Map<string, number>();
const ACTIVITY_PREFIX = "::praetor-activity::";

export function toYaml(charter: Charter): string {
  return stringify({
    ...charter,
    plugins: charter.plugins && charter.plugins.length > 0 ? charter.plugins : ["@praetor/seo"],
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
  const child = spawn("npx", ["praetor", "run", charterPath], {
    cwd: env.repoRoot,
    shell: true,
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
