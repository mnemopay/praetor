import express from "express";
import { authMiddleware, type AuthedRequest } from "./auth.js";
import { buildCharter } from "./charter.js";
import {
  createMissionRow,
  getMissionForUser,
  getMissionLogs,
  installPlugin,
  listInstalledPlugins,
  listMissions,
} from "./db.js";
import { env } from "./env.js";
import { getPluginRegistry, validatePluginName } from "./marketplace.js";
import { newMissionId, startMissionRun } from "./runner.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/v1/auth/session", authMiddleware, (req: AuthedRequest, res) => {
    res.json({ ok: true, user: req.user });
  });

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

  return app;
}
