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
import { praetorHttp, jsonBodyParser, type Handler, type PraetorApp } from "./http.js";
import { getPluginRegistry, validatePluginName } from "./marketplace.js";
import { newMissionId, recordMissionChatMessage, startMissionRun } from "./runner.js";
import { mountActivityPersistence } from "./activity.js";
import { createActivityRouter } from "./routes/activity.js";
import { getToolCatalog } from "./tools.js";
import { mountBilling, checkMissionCap, incrementMissionCount } from "./billing.js";

export function createApp(): PraetorApp {
  const app = praetorHttp();
  app.use(jsonBodyParser({ limit: "1mb" }));

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

  app.post("/api/v1/auth/session", authMiddleware, (req, res) => {
    res.json({ ok: true, user: (req as AuthedRequest).user });
  });

  // SSE activity routes — must mount BEFORE the global auth middleware so
  // the per-route query-token auth path can run.
  mountActivityPersistence(getMissionOwner);
  app.use("/api/v1", createActivityRouter());

  app.get("/api/v1/artifacts", artifactQueryTokenAuth, authMiddleware, (req, res) => {
    const rawPathQ = (req as AuthedRequest).query.path;
    const rawPath = typeof rawPathQ === "string" ? rawPathQ : "";
    const target = resolve(rawPath);
    const allowedRoots = [
      resolve(env.repoRoot, "praetor-out"),
      resolve(env.repoRoot, ".praetor"),
    ];
    const isAllowed = allowedRoots.some((root) => target === root || target.startsWith(root + "\\"));
    if (!rawPath || !isAllowed) {
      res.status(400).json({ ok: false, error: "invalid artifact path" });
      return;
    }
    if (!existsSync(target)) {
      res.status(404).json({ ok: false, error: "artifact not found" });
      return;
    }
    if (statSync(target).isDirectory()) {
      res.status(400).json({ ok: false, error: "artifact is a directory" });
      return;
    }
    res.sendFile(target);
  });

  app.use("/api/v1", authMiddleware);

  app.get("/api/v1/missions", async (req, res) => {
    const data = await listMissions((req as AuthedRequest).user!.id);
    res.json({ ok: true, missions: data });
  });

  app.post("/api/v1/missions", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const goal = String(body.goal ?? "").trim();
    if (!goal) {
      res.status(400).json({ ok: false, error: "goal is required" });
      return;
    }
    const missionId = newMissionId();
    const userId = (req as AuthedRequest).user!.id;

    // Tier-cap gate — free 5/mo, pro 100/mo, team unlimited
    const cap = await checkMissionCap(userId);
    if (!cap.allowed) {
      res.status(402).json({ ok: false, error: cap.reason, tier: cap.tier, cap: cap.cap, used: cap.used, upgradeUrl: "https://app.praetor.mnemopay.com/billing" });
      return;
    }

    const installed = await listInstalledPlugins(userId);
    const charter = buildCharter({
      goal,
      budgetUsd: Number(body.budgetUsd ?? env.defaultBudgetUsd),
      outputs: Array.isArray(body.outputs) ? (body.outputs as string[]) : undefined,
      plugins: installed,
      agent: typeof body.agent === "string" ? (body.agent as Parameters<typeof buildCharter>[0]["agent"]) : undefined,
    });
    await createMissionRow({
      id: missionId,
      userId,
      goal,
      budget: charter.budget.maxUsd,
      charterJson: charter as unknown as Record<string, unknown>,
    });
    void startMissionRun(missionId, charter);
    void incrementMissionCount(userId);
    res.status(202).json({ ok: true, missionId });
  });

  app.get("/api/v1/missions/:id", async (req, res) => {
    const missionId = String(req.params.id ?? "");
    const userId = (req as AuthedRequest).user!.id;
    const mission = await getMissionForUser(missionId, userId);
    if (!mission) {
      res.status(404).json({ ok: false, error: "Mission not found" });
      return;
    }
    const logs = await getMissionLogs(mission.id);
    res.json({ ok: true, mission, logs });
  });

  // EU AI Act Article 12 audit bundle as a downloadable JSON manifest.
  // For paid tiers (pro+) this includes Merkle-rooted event chain. Free tier
  // is gated at the billing layer (TIER_LIMITS.articleTwelveAuditAllowed).
  app.get("/api/v1/missions/:id/article12", async (req, res) => {
    const missionId = String(req.params.id ?? "");
    const userId = (req as AuthedRequest).user!.id;
    const mission = await getMissionForUser(missionId, userId);
    if (!mission) {
      res.status(404).json({ ok: false, error: "Mission not found" });
      return;
    }
    const logs = await getMissionLogs(mission.id);
    // Parse activity events out of the structured log lines (kind=praetor-activity).
    const events: unknown[] = [];
    for (const line of logs) {
      const m = /::praetor-activity::(.+)$/.exec(line);
      if (m) { try { events.push(JSON.parse(m[1])); } catch { /* skip malformed */ } }
    }
    const bundle = {
      bundleVersion: "praetor-article12/1",
      missionId: mission.id,
      generatedAt: new Date().toISOString(),
      retentionMonths: 6,
      mission: {
        id: mission.id,
        goal: mission.goal,
        status: mission.status,
        budget: mission.budget,
        createdAt: mission.created_at,
        updatedAt: mission.updated_at,
        charter: mission.charter_json,
      },
      events,
      logCount: logs.length,
      // Note: Merkle root + cryptographic sealing are produced by the runner's
      // packages/core Article 12 module when --article12 is passed at run time.
      // This endpoint surfaces the in-flight observable bundle. For sealed copies
      // see the runner's audit-bundle output directory.
    };
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="article12-${mission.id}.json"`);
    res.json(bundle);
  });

  // "Talk back" surface for the dashboard chat. Appends a message to the
  // per-mission inbox file AND publishes a chat.user / chat.assistant
  // activity event so the SSE stream re-renders the conversation in real
  // time. Agent-loop consumption of the inbox is a separate follow-up.
  app.post("/api/v1/missions/:id/messages", async (req, res) => {
    const missionId = String(req.params.id ?? "");
    const userId = (req as AuthedRequest).user!.id;
    const mission = await getMissionForUser(missionId, userId);
    if (!mission) {
      res.status(404).json({ ok: false, error: "Mission not found" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = String(body.text ?? "").trim();
    const role = body.role === "assistant" ? "assistant" : "user";
    if (!text) {
      res.status(400).json({ ok: false, error: "text is required" });
      return;
    }
    if (text.length > 8_000) {
      res.status(413).json({ ok: false, error: "text exceeds 8000 character cap" });
      return;
    }
    const { event } = await recordMissionChatMessage({ missionId, text, role });
    res.status(202).json({ ok: true, event });
  });

  app.get("/api/v1/marketplace/plugins", async (req, res) => {
    const userId = (req as AuthedRequest).user!.id;
    const installed = await listInstalledPlugins(userId);
    res.json({ ok: true, plugins: getPluginRegistry(), installed });
  });

  app.get("/api/v1/tools", async (_req, res) => {
    res.json(await getToolCatalog());
  });

  app.post("/api/v1/marketplace/install", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pluginName = String(body.pluginName ?? "").trim();
    if (!validatePluginName(pluginName)) {
      res.status(400).json({ ok: false, error: "Invalid plugin name format" });
      return;
    }
    const userId = (req as AuthedRequest).user!.id;
    await installPlugin(userId, pluginName);
    const installed = await listInstalledPlugins(userId);
    res.json({ ok: true, installed });
  });

  // Stripe checkout + webhook + billing endpoints (replaces the old stub)
  mountBilling(app);

  // ─── World-gen: list and serve scenes published via @kpanks/world-gen ──────
  const worldGenRoot = resolve(env.worldGenOutDir ?? join(env.repoRoot, "praetor-out", "scenes"));

  app.get("/api/v1/world-gen/scenes", (_req, res) => {
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

  app.get("/api/v1/world-gen/scenes/:id/:file", (req, res) => {
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

const artifactQueryTokenAuth: Handler = (req, _res, next) => {
  const tokenQ = req.query.token;
  const tokenStr = Array.isArray(tokenQ) ? tokenQ[0] : tokenQ;
  if (!req.headers.authorization && tokenStr) {
    req.headers.authorization = `Bearer ${tokenStr}`;
  }
  next();
};
