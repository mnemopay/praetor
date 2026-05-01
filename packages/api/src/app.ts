import express from "express";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { authMiddleware, type AuthedRequest } from "./auth.js";
import { buildCharter } from "./charter.js";
import {
  createMissionRow,
  getMissionForUser,
  getMissionLogs,
  getMissionOwner,
  installPlugin,
  listInstalledPlugins,
  listMissions,
} from "./db.js";
import { env } from "./env.js";
import { getPluginRegistry, validatePluginName } from "./marketplace.js";
import { newMissionId, startMissionRun } from "./runner.js";
import { mountActivityPersistence } from "./activity.js";
import { createActivityRouter } from "./routes/activity.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // CORS for the Vite dashboard. Allow any localhost origin in dev; tighten via env in prod.
  const allowedOrigins = (env.allowedOrigins ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    const isLocal = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isAllowed = origin && (isLocal || allowedOrigins.includes(origin) || allowedOrigins.includes("*"));
    if (origin && isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "praetor-api", time: new Date().toISOString() });
  });

  app.post("/api/v1/auth/session", authMiddleware, (req: AuthedRequest, res) => {
    res.json({ ok: true, user: req.user });
  });

  // SSE activity routes — must mount BEFORE the global auth middleware so
  // the per-route query-token auth path can run.
  mountActivityPersistence(getMissionOwner);
  app.use("/api/v1", createActivityRouter());

  app.use("/api/v1", authMiddleware);

  app.get("/api/v1/missions", async (req: AuthedRequest, res) => {
    const data = await listMissions(req.user!.id);
    res.json({ ok: true, missions: data });
  });

  app.post("/api/v1/missions", async (req: AuthedRequest, res) => {
    const goal = String(req.body?.goal ?? "").trim();
    if (!goal) {
      res.status(400).json({ ok: false, error: "goal is required" });
      return;
    }
    const missionId = newMissionId();
    const installed = await listInstalledPlugins(req.user!.id);
    const charter = buildCharter({
      goal,
      budgetUsd: Number(req.body?.budgetUsd ?? env.defaultBudgetUsd),
      outputs: Array.isArray(req.body?.outputs) ? req.body.outputs : undefined,
      plugins: installed,
      agent: typeof req.body?.agent === "string" ? req.body.agent : undefined,
    });
    await createMissionRow({
      id: missionId,
      userId: req.user!.id,
      goal,
      budget: charter.budget.maxUsd,
      charterJson: charter as unknown as Record<string, unknown>,
    });
    void startMissionRun(missionId, charter);
    res.status(202).json({ ok: true, missionId });
  });

  app.get("/api/v1/missions/:id", async (req: AuthedRequest, res) => {
    const missionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const mission = await getMissionForUser(missionId, req.user!.id);
    if (!mission) {
      res.status(404).json({ ok: false, error: "Mission not found" });
      return;
    }
    const logs = await getMissionLogs(mission.id);
    res.json({ ok: true, mission, logs });
  });

  app.get("/api/v1/marketplace/plugins", async (req: AuthedRequest, res) => {
    const installed = await listInstalledPlugins(req.user!.id);
    res.json({ ok: true, plugins: getPluginRegistry(), installed });
  });

  app.post("/api/v1/marketplace/install", async (req: AuthedRequest, res) => {
    const pluginName = String(req.body?.pluginName ?? "").trim();
    if (!validatePluginName(pluginName)) {
      res.status(400).json({ ok: false, error: "Invalid plugin name format" });
      return;
    }
    await installPlugin(req.user!.id, pluginName);
    const installed = await listInstalledPlugins(req.user!.id);
    res.json({ ok: true, installed });
  });

  app.get("/api/v1/billing", (_req: AuthedRequest, res) => {
    res.json({
      ok: true,
      thresholdUsd: env.defaultBudgetUsd,
      currentSpendUsd: 0,
    });
  });

  // ─── World-gen: list and serve scenes published via @praetor/world-gen ──────
  const worldGenRoot = resolve(env.worldGenOutDir ?? join(env.repoRoot, "praetor-out", "scenes"));

  app.get("/api/v1/world-gen/scenes", (_req: AuthedRequest, res) => {
    if (!existsSync(worldGenRoot)) {
      res.json({ ok: true, scenes: [], root: worldGenRoot });
      return;
    }
    const scenes: Array<Record<string, unknown>> = [];
    for (const entry of readdirSync(worldGenRoot)) {
      const dir = join(worldGenRoot, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
        const manifestPath = join(dir, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        scenes.push({
          id: manifest.id ?? entry,
          title: manifest.title ?? entry,
          glbUrl: manifest.glbUrl ?? null,
          splatUrl: manifest.splatUrl ?? null,
          publishedAt: manifest.publishedAt ?? null,
          viewerPath: `/api/v1/world-gen/scenes/${entry}/index.html`,
        });
      } catch {
        // Skip unreadable scene
      }
    }
    scenes.sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")));
    res.json({ ok: true, scenes, root: worldGenRoot });
  });

  app.get("/api/v1/world-gen/scenes/:id/:file", (req: AuthedRequest, res) => {
    const id = String(req.params.id ?? "").replace(/[^a-z0-9-_]/gi, "");
    const file = String(req.params.file ?? "").replace(/[^a-z0-9-_.]/gi, "");
    if (!id || !file) {
      res.status(400).json({ ok: false, error: "invalid scene path" });
      return;
    }
    const target = resolve(join(worldGenRoot, id, file));
    if (!target.startsWith(worldGenRoot) || !existsSync(target)) {
      res.status(404).json({ ok: false, error: "scene not found" });
      return;
    }
    if (file.endsWith(".html")) res.setHeader("content-type", "text/html; charset=utf-8");
    else if (file.endsWith(".json")) res.setHeader("content-type", "application/json");
    res.send(readFileSync(target));
  });

  return app;
}
