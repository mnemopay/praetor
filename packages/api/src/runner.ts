import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stringify } from "yaml";
import { env } from "./env.js";
import { appendMissionLog, updateMissionStatus } from "./db.js";
import type { Charter } from "@praetor/core";

export const activeMissionPids = new Map<string, number>();

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
  const child = spawn("npx", ["praetor", "run", charterPath], { cwd: env.repoRoot, shell: true });
  activeMissionPids.set(missionId, child.pid ?? 0);

  child.stdout.on("data", async (chunk: Buffer) => {
    const text = chunk.toString();
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
