#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { parse as parseYamlReal } from "yaml";
import {
  validateCharter,
  runMission,
  MerkleAudit,
  buildArticle12Bundle,
  PolicyEngine,
  log,
  type ActivityBus,
  type ActivityEvent,
  type ArtifactFormat,
  type Charter,
  type MissionResult,
} from "@praetor/core";
import { MockPayments, MnemoPayAdapter, type PaymentsAdapter, type MnemoPayClient } from "@praetor/payments";
import { EchoAgent, LlmAgent, NativePraetorEngine, CoordinatorAgent, type AgentAdapter } from "@praetor/agents";
import { registerCodingTools } from "@praetor/coding-agent";
import { defaultRegistry, type FiscalGate } from "@praetor/tools";
import { defaultScraper, type ScrapeBackend } from "@praetor/scrape";
import { chunkText, defaultKnowledgeBase } from "@praetor/knowledge";
import { DEFAULT_CATALOGUE, LlmRouter, registerDefaultProviders, type RouteRequirements } from "@praetor/router";
import { DesignPack, type HtmlInCanvas3DSpec, type SplinePresetId } from "@praetor/design";
import { renderSite, submitIndexNow, extractGeoProfile, analyzeContentSeo, generateOutreachSequence, generateOgImageUrl, type SiteManifest } from "@praetor/seo";
import { defaultBusinessOps, auditedBusinessOps, type AuditSink } from "@praetor/business-ops";
import { SysadminModule } from "@praetor/sysadmin";
import { SandboxDispatcher, MockSandboxFactory, LocalSandboxFactory, DockerSandboxFactory } from "@praetor/sandbox";
import { capture_screen, analyze_image } from "@praetor/vision";
import { PraetorVoice, KokoroAdapter, AzureSpeechAdapter, type VoiceBackend } from "@praetor/voice";
import { PraetorBrowser, PlaywrightAdapter } from "@praetor/browser";
import { post_x_tweet, post_tiktok_video, schedule_cron_job } from "@praetor/social";
import {
  defaultSelector as worldGenSelector,
  generate_3d_model as worldGenModel,
  generate_3d_world as worldGenWorld,
  edit_3d_scene as worldGenEdit,
  publish_3d_scene as worldGenPublish,
} from "@praetor/world-gen";
import { defaultRenderer } from "@praetor/game-assets";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { ToolApproval, ToolOrigin, ToolProductionState, ToolRisk, ToolSandbox } from "@praetor/tools";

const ACTIVITY_PREFIX = "::praetor-activity::";

function loadDotenv(...candidates: string[]): void {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      if (process.env[k] !== undefined) continue;
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  }
}

class LiveMnemoPayClient implements MnemoPayClient {
  constructor(private apiKey: string, private baseUrl: string = "https://api.mnemopay.com") {}

  private async post(path: string, body: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MnemoPay ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async chargeRequest(args: { amount: number; description: string }) {
    const r = await this.post("/v1/chargeRequest", args) as { id: string };
    return { id: r.id };
  }
  async settle(id: string, amount: number) {
    await this.post("/v1/settle", { id, amount });
  }
  async refund(id: string) {
    await this.post("/v1/refund", { id });
  }
}

function pickAgent(charter: Charter, payments: PaymentsAdapter, audit: MerkleAudit, registry = defaultRegistry()): AgentAdapter {
  const env = process.env;
  const haveAny = env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY;
  if (!haveAny) return new EchoAgent();

  const registered = new Set<string>();
  if (env.ANTHROPIC_API_KEY) registered.add("anthropic");
  if (env.OPENAI_API_KEY) registered.add("openai");
  if (env.OPENROUTER_API_KEY) registered.add("openrouter");
  const catalogue = DEFAULT_CATALOGUE.filter((m) => registered.has(m.provider));

  const charterRoute = (charter as { route?: RouteRequirements }).route;
  const route: RouteRequirements = charterRoute ?? { quality: "fast" };

  const router = registerDefaultProviders(new LlmRouter(catalogue), env, { catalogue });

  const holds = new Map<string, string>();
  const fiscal: FiscalGate = {
    async approve(call) {
      if (charter.budget.perToolMaxUsd !== undefined && call.estUsd > charter.budget.perToolMaxUsd) {
        throw new Error(`Tool '${call.tool}' estimated cost (${call.estUsd}) exceeds perToolMaxUsd (${charter.budget.perToolMaxUsd})`);
      }
      if (call.estUsd > 0) {
        const { holdId } = await payments.reserve(call.estUsd);
        holds.set(call.tool, holdId);
      }
    },
    async settle(call) {
      if (call.estUsd > 0) {
        const holdId = holds.get(call.tool);
        if (holdId) {
          if (call.error) await payments.release(holdId);
          else await payments.settle(holdId, call.actualUsd ?? call.estUsd);
          holds.delete(call.tool);
        }
      }
    }
  };

  const policy = new PolicyEngine([
    { tool: "*", action: "allow" } // Default allow for now, users can restrict via charter later
  ]);

  return new CoordinatorAgent(router, registry, { fiscal, audit }, policy, route);
}

function toolMeta(
  origin: ToolOrigin,
  capability: string,
  risk: readonly ToolRisk[],
  approval: ToolApproval,
  sandbox: ToolSandbox,
  production: ToolProductionState,
  note?: string,
) {
  return { origin, capability, risk, approval, sandbox, production, costEffective: true, note };
}

export async function buildEnhancedRegistry(charter: Charter, missionId: string, audit?: AuditSink, activity?: ActivityBus) {
  const reg = defaultRegistry();
  const kb = defaultKnowledgeBase({ missionId });
  const design = new DesignPack();
  const outDir = resolve(process.cwd(), "praetor-out");
  const repoRoot = resolve(process.env.PRAETOR_REPO_ROOT ?? process.cwd());

  // Coding-agent toolset (read/write/edit/apply_edit/list/grep/repo_map/find_symbol/
  // load_conventions/git_*/run_tests/run_command). Each tool is gated to
  // role="coding" via its own allowedRoles, so the LLM only sees them when
  // the charter declares an agent with that role.
  registerCodingTools(reg, repoRoot);
  
  const rawOps = defaultBusinessOps(process.env);
  const ops = audit ? auditedBusinessOps(rawOps, audit) : rawOps;
  const scraper = defaultScraper(process.env);
  const games = defaultRenderer({ outDir: join(outDir, "games") });

  // Dispatcher is wired with all native factories. Charters can declare
  // `sandbox: { kind: "auto" | "mock" | "local" | "docker" | "firecracker" }`.
  // `auto` (no kind set) probes Docker and falls back to mock — so any
  // user with Docker installed gets real container isolation transparently.
  const sandboxDispatcher = new SandboxDispatcher({
    mock: new MockSandboxFactory(),
    local: new LocalSandboxFactory({ cwd: repoRoot }),
    docker: new DockerSandboxFactory({
      // Hardening defaults: --memory 2g, --cpus 2.0, --pids-limit 256,
      // --read-only, --cap-drop ALL, --security-opt no-new-privileges,
      // refuse mounts of /, /var/run/docker.sock, /proc, etc.
      mounts: [{ host: repoRoot, container: "/work", readonly: true }],
    }),
  });
  const sandbox = await sandboxDispatcher.create(charter.sandbox?.kind ?? "auto");
  const sysadmin = new SysadminModule(sandbox);

  reg.register(
    {
      name: "search_knowledge",
      description: "Search the agent's persistent memory (Knowledge Base) for context.",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          limit: { type: "integer", description: "Max results to return (default 5)." },
        },
        required: ["query"],
      },
      tags: ["memory", "search"],
      metadata: toolMeta("native", "knowledge_search", ["none"], "never", "none", "needs-live-test"),
    },
    async ({ query, limit }) => {
      const hits = await kb.query(query as string, (limit as number) ?? 5);
      return { hits };
    }
  );

  reg.register(
    {
      name: "ingest_knowledge",
      description: "Save important text or context into the agent's persistent memory.",
      schema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to remember." },
          source: { type: "string", description: "Where the text came from (e.g. url, user input)." },
        },
        required: ["text"],
      },
      tags: ["memory", "ingest"],
      metadata: toolMeta("native", "knowledge_ingest", ["filesystem"], "never", "none", "needs-live-test"),
    },
    async ({ text, source }) => {
      const t = text as string;
      const chunks = chunkText(t, 1200).map((piece, i) => ({
        id: `${Date.now()}-${i}`,
        text: piece,
        source: (source as string) ?? "agent",
        metadata: { tier: "semantic" as const },
      }));
      const r = await kb.ingest(chunks);
      return { ingested: r.ingested };
    }
  );

  reg.register(
    {
      name: "design_spline_preset",
      description: "Generate a landing page using a 3D Spline preset.",
      schema: {
        type: "object",
        properties: {
          presetId: { type: "string", enum: ["godly-3d-orb", "fractional-ops-rings", "ai-audit-shield", "developer-portal-grid", "drone-proof-of-presence"] },
          title: { type: "string" }
        },
        required: ["presetId", "title"]
      },
      tags: ["design", "3d", "landing_page"],
      metadata: toolMeta("adapter", "design_3d_preset", ["network", "filesystem"], "on-side-effect", "remote-provider", "needs-native-rewrite", "Spline is an export/embed adapter; Praetor should own the scene spec.")
    },
    async ({ presetId, title }) => {
      const pId = presetId as SplinePresetId;
      const t = title as string;
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${t}</title>
  <style>body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }</style>
</head>
<body>
  ${design.renderSplinePreset(pId)}
</body>
</html>`;
      mkdirSync(outDir, { recursive: true });
      const f = join(outDir, `spline-${pId}.html`);
      writeFileSync(f, html);
      publishArtifact(activity, missionId, `design-spline-${pId}`, "text", f);
      return { success: true, message: `Landing page saved to ${f}` };
    }
  );

  reg.register(
    {
      name: "design_html_in_canvas_3d",
      description: "Generate a high-end 3D CSS parallax landing page with HTML cards.",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          background: { type: "string", description: "CSS background e.g. #0a0a0a" },
          cards: {
            type: "array",
            items: {
              type: "object",
              description: "Card spec {id: string, html: string}"
            }
          }
        },
        required: ["title", "cards"]
      },
      tags: ["design", "3d", "landing_page"],
      metadata: toolMeta("native", "design_html_canvas_3d", ["filesystem"], "on-side-effect", "repo", "needs-live-test")
    },
    async ({ title, background, cards }) => {
      const spec = { title, background, cards } as HtmlInCanvas3DSpec;
      const art = design.renderHtmlInCanvas3D(spec);
      mkdirSync(outDir, { recursive: true });
      const written = [];
      for (const file of art.files) {
        const path = join(outDir, `canvas3d-${file.path}`);
        writeFileSync(path, file.contents);
        written.push(path);
        publishArtifact(activity, missionId, `design-canvas3d-${file.path}`, "text", path);
      }
      return { success: true, message: `Canvas3D files saved to: ${written.join(", ")}` };
    }
  );

  // ---- @praetor/world-gen — native Mint replacement ---------------------
  // Selector resolves a backend at call time from env (HUNYUAN3D_ENDPOINT,
  // REPLICATE_API_TOKEN, TRIPO_API_KEY, FAL_API_KEY, WORLDLABS_API_KEY,
  // HYWORLD_ENDPOINT). Falls back to a deterministic mock so smoke tests pass
  // even without keys.
  const wgSelector = worldGenSelector();

  reg.register(
    {
      name: "generate_3d_model",
      description: "Generate a 3D model (GLB) from a text prompt or reference image. Backends: TRELLIS-2, Hunyuan3D 2.1, Tripo, fal sam-3 (auto-selected from env).",
      schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          referenceImageUrl: { type: "string", description: "Optional image URL — switches to image-to-3D mode." },
          detail: { type: "string", enum: ["draft", "standard", "high"] },
          backend: { type: "string", description: "Optional explicit backend: trellis2|hunyuan3d|tripo|fal-sam-3d|mock" },
          seed: { type: "integer" }
        },
        required: ["prompt"]
      },
      tags: ["design", "world-gen", "3d", "glb"],
      metadata: toolMeta("adapter", "world_gen_model", ["network", "spend", "filesystem"], "on-cost", "remote-provider", "needs-live-test")
    },
    async (args) => {
      const result = await worldGenModel(args as any, { selector: wgSelector, missionId, bus: activity });
      publishRemoteArtifacts(activity, missionId, "generate_3d_model", result as unknown as Record<string, unknown>);
      return { success: true, ...result };
    }
  );

  reg.register(
    {
      name: "generate_3d_world",
      description: "Generate an explorable 3D world (Gaussian splat + GLB mesh) from text/image/panorama/video. Backends: HY-World 2.0 (self-hosted), World Labs Marble.",
      schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          referenceImageUrl: { type: "string" },
          panoramaUrl: { type: "string", description: "Optional 360 equirectangular panorama URL." },
          videoUrl: { type: "string", description: "Optional reference video URL." },
          detail: { type: "string", enum: ["draft", "standard", "high"] },
          backend: { type: "string", description: "Optional: hyworld|worldlabs|mock" },
          seed: { type: "integer" }
        },
        required: ["prompt"]
      },
      tags: ["design", "world-gen", "3d", "splat"],
      metadata: toolMeta("adapter", "world_gen_scene", ["network", "spend", "filesystem"], "on-cost", "remote-provider", "needs-live-test")
    },
    async (args) => {
      const result = await worldGenWorld(args as any, { selector: wgSelector, missionId, bus: activity });
      publishRemoteArtifacts(activity, missionId, "generate_3d_world", result as unknown as Record<string, unknown>);
      return { success: true, ...result };
    }
  );

  reg.register(
    {
      name: "edit_3d_scene",
      description: "Open a generated splat scene in SuperSplat (browser-based MIT-licensed splat editor). Returns a deep-link URL with the asset preloaded.",
      schema: {
        type: "object",
        properties: {
          assetUrl: { type: "string", description: "PLY or SPZ asset URL." },
          title: { type: "string" },
          callbackUrl: { type: "string", description: "Optional URL the editor will POST the edited scene to." }
        },
        required: ["assetUrl"]
      },
      tags: ["design", "world-gen", "editor"],
      metadata: toolMeta("adapter", "world_gen_scene_edit", ["network", "browser"], "on-side-effect", "browser", "needs-live-test")
    },
    async (args) => {
      const result = worldGenEdit(args as any);
      return { success: true, ...result };
    }
  );

  reg.register(
    {
      name: "publish_3d_scene",
      description: "Write a self-contained viewer page (model-viewer for GLB, Spark 2.0 for splats) for a generated asset. Output drops onto any static host.",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          glbUrl: { type: "string" },
          splatUrl: { type: "string" },
          title: { type: "string" },
          background: { type: "string" }
        },
        required: ["id"]
      },
      tags: ["design", "world-gen", "viewer"],
      metadata: toolMeta("native", "world_gen_scene_publish", ["filesystem"], "on-side-effect", "repo", "needs-live-test")
    },
    async (args) => {
      const result = worldGenPublish({ ...(args as any), outDir: join(outDir, "scenes") });
      publishArtifact(activity, missionId, `world-viewer-${String((args as any).id ?? "scene")}`, "text", result.viewerPath);
      return { success: true, ...result };
    }
  );

  reg.register(
    {
      name: "generate_seo_site",
      description: "Generate an SEO/GEO optimized site structure (sitemap, llms.txt, schema.org).",
      schema: {
        type: "object",
        properties: {
          origin: { type: "string", description: "e.g. https://example.com" },
          pages: {
            type: "array",
            items: {
              type: "object",
              description: "Page spec {slug: string, title: string, description: string, aiDescription: string, bodyMarkdown: string}"
            }
          }
        },
        required: ["origin", "pages"]
      },
      tags: ["seo", "geo", "sitemap", "generator"],
      metadata: toolMeta("native", "seo_site_generate", ["filesystem"], "on-side-effect", "repo", "needs-live-test")
    },
    async ({ origin, pages }) => {
      const site = { origin, pages } as SiteManifest;
      const art = renderSite(site);
      const seoDir = join(outDir, "seo");
      mkdirSync(seoDir, { recursive: true });
      writeFileSync(join(seoDir, "sitemap.xml"), art.sitemapXml);
      writeFileSync(join(seoDir, "robots.txt"), art.robotsTxt);
      writeFileSync(join(seoDir, "ai.txt"), art.aiTxt);
      writeFileSync(join(seoDir, "llms.txt"), art.llmsTxt);
      writeFileSync(join(seoDir, "schema.jsonld"), art.schemaJsonLd);
      for (const p of art.pages) {
        mkdirSync(join(seoDir, p.slug), { recursive: true });
        writeFileSync(join(seoDir, p.slug, "index.html"), p.html);
      }
      publishArtifact(activity, missionId, "seo-site-sitemap", "text", join(seoDir, "sitemap.xml"));
      publishArtifact(activity, missionId, "seo-site-index", "text", join(seoDir, art.pages[0]?.slug ?? ".", "index.html"));
      return { success: true, message: `SEO site generated at ${seoDir}` };
    }
  );

  reg.register(
    {
      name: "send_email",
      description: "Send an outbound email (via Maileroo).",
      schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          from: { type: "string" },
          subject: { type: "string" },
          text: { type: "string" },
          html: { type: "string" },
          replyTo: { type: "string" }
        },
        required: ["to", "from", "subject", "text"]
      },
      tags: ["email", "outbound", "business"],
      metadata: toolMeta("adapter", "business_email_send", ["network", "reputation", "external_publish"], "always", "remote-provider", "needs-live-test")
    },
    async (msg) => {
      const res = await ops.email.send(msg as any);
      return { success: true, id: res.id, status: res.status, provider: res.provider };
    }
  );

  reg.register(
    {
      name: "issue_invoice",
      description: "Issue a billing invoice (via Stripe).",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          customerEmail: { type: "string" },
          customerName: { type: "string" },
          lineItems: {
            type: "array",
            items: {
              type: "object",
              description: "LineItem spec {description: string, quantity: number, unitPriceUsd: number}"
            }
          },
          dueAt: { type: "string" },
          notes: { type: "string" }
        },
        required: ["id", "customerEmail", "lineItems"]
      },
      tags: ["billing", "invoice", "stripe", "business"],
      metadata: toolMeta("adapter", "business_invoice_issue", ["network", "payment", "spend"], "always", "remote-provider", "needs-live-test")
    },
    async (inv) => {
      const res = await ops.biller.issue(inv as any);
      return { success: true, paymentLink: res.paymentLink, totalUsd: res.totalUsd, provider: res.provider };
    }
  );

  reg.register(
    {
      name: "schedule_meeting",
      description: "Schedule a meeting (via Cal.com).",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          attendeeEmail: { type: "string" },
          attendeeName: { type: "string" },
          eventTypeSlug: { type: "string" },
          startAt: { type: "string" },
          durationMinutes: { type: "integer" },
          notes: { type: "string" }
        },
        required: ["title", "attendeeEmail", "eventTypeSlug"]
      },
      tags: ["scheduling", "meeting", "cal.com", "business"],
      metadata: toolMeta("adapter", "business_meeting_schedule", ["network", "identity", "external_publish"], "on-side-effect", "remote-provider", "needs-live-test")
    },
    async (req) => {
      const res = await ops.scheduler.schedule(req as any);
      return { success: true, bookingUrl: res.bookingUrl, id: res.id, provider: res.provider };
    }
  );

  reg.register(
    {
      name: "upsert_contact",
      description: "Add or update a contact in the CRM layer.",
      schema: {
        type: "object",
        properties: {
          email: { type: "string" },
          name: { type: "string" },
          company: { type: "string" },
          source: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["email"]
      },
      tags: ["crm", "contact", "business"],
      metadata: toolMeta("native", "business_contact_upsert", ["identity", "filesystem"], "on-side-effect", "none", "needs-live-test")
    },
    async (c) => {
      const res = await ops.contacts.upsert(c as any);
      return { success: true, contact: res };
    }
  );

  reg.register(
    {
      name: "scrape_url",
      description: "Scrape a webpage and return its textual content, markdown, or JSON-LD schema.",
      schema: {
        type: "object",
        properties: {
          url: { type: "string" }
        },
        required: ["url"]
      },
      tags: ["scrape", "research", "crawl"],
      metadata: toolMeta("native", "web_scrape", ["network"], "never", "remote-provider", "needs-live-test", "Praetor native fetch/extract path is default; hard-page adapters remain optional.")
    },
    async ({ url }) => {
      const res = await scraper.scrape({ url: url as string });
      return { success: true, status: res.status, text: res.text?.slice(0, 5000) };
    }
  );

  reg.register(
    {
      name: "generate_game_assets",
      description: "Generate an entire playable Godot 4.4 game project based on a concept.",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable project ID without spaces e.g. retro-pong" },
          goal: { type: "string", description: "One line idea of the game e.g. A retro platformer" },
          spriteFrames: { type: "integer" },
          textureTiles: { type: "integer" },
          sfxCues: { type: "integer" },
          audioMood: { type: "string" }
        },
        required: ["id", "goal"]
      },
      tags: ["game", "godot", "assets", "generation"],
      metadata: toolMeta("native", "game_asset_generate", ["filesystem", "network"], "on-side-effect", "repo", "needs-live-test")
    },
    async (spec) => {
      const res = await games.render(spec as any);
      publishArtifact(activity, missionId, `game-project-${String((spec as any).id ?? "project")}`, "text", res.outputDir);
      return { success: true, projectPath: res.outputDir, costUsd: res.costUsd };
    }
  );

  reg.register(
    {
      name: "submit_index_now",
      description: "Submit a list of URLs to the IndexNow protocol to force instant search engine crawling.",
      schema: {
        type: "object",
        properties: {
          host: { type: "string", description: "Your domain e.g. example.com" },
          key: { type: "string" },
          keyLocation: { type: "string", description: "e.g. https://example.com/key.txt" },
          urlList: {
            type: "array",
            items: { type: "string", description: "URL to submit" }
          }
        },
        required: ["host", "key", "keyLocation", "urlList"]
      },
      tags: ["seo", "indexnow", "crawler"],
      metadata: toolMeta("adapter", "seo_index_submit", ["network", "external_publish"], "on-side-effect", "remote-provider", "needs-live-test")
    },
    async ({ host, key, keyLocation, urlList }) => {
      const res = await submitIndexNow(host as string, key as string, keyLocation as string, urlList as string[]);
      return { success: true, status: res.status, ok: res.ok };
    }
  );

  reg.register(
    {
      name: "profile_geo_competitor",
      description: "Analyze a competitor's URL for Generative Engine Optimization (AI description, JSON-LD, headings).",
      schema: {
        type: "object",
        properties: {
          competitorUrl: { type: "string" }
        },
        required: ["competitorUrl"]
      },
      tags: ["seo", "geo", "competitor", "analysis"],
      metadata: toolMeta("native", "geo_competitor_profile", ["network"], "never", "remote-provider", "needs-live-test")
    },
    async ({ competitorUrl }) => {
      const res = await scraper.scrape({ url: competitorUrl as string });
      if (!res.text && !res.body) return { success: false, error: "Failed to scrape" };
      const profile = extractGeoProfile(res.body || res.text || "");
      return { success: true, profile };
    }
  );

  reg.register(
    {
      name: "analyze_content_seo",
      description: "Analyze text content for SEO readability, keyword density, and Flesch-Kincaid score.",
      schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          targetKeyword: { type: "string" }
        },
        required: ["text"]
      },
      tags: ["seo", "content", "analysis"],
      metadata: toolMeta("native", "seo_content_analyze", ["none"], "never", "none", "ready")
    },
    async ({ text, targetKeyword }) => {
      const analysis = analyzeContentSeo(text as string, targetKeyword as string | undefined);
      return { success: true, analysis };
    }
  );

  reg.register(
    {
      name: "geo_outreach_sequence",
      description: "Generate a 3-step personalized backlink outreach email sequence.",
      schema: {
        type: "object",
        properties: {
          targetSite: { type: "string" },
          authorName: { type: "string" },
          niche: { type: "string" }
        },
        required: ["targetSite", "authorName", "niche"]
      },
      tags: ["seo", "geo", "outreach", "email"],
      metadata: toolMeta("native", "geo_outreach_draft", ["reputation"], "never", "none", "needs-live-test")
    },
    async ({ targetSite, authorName, niche }) => {
      const sequence = generateOutreachSequence(targetSite as string, authorName as string, niche as string);
      return { success: true, sequence };
    }
  );

  reg.register(
    {
      name: "generate_og_images",
      description: "Dynamically generate a 1200x630 OpenGraph social share image URL using Pollinations AI.",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          backgroundUrl: { type: "string" }
        },
        required: ["title"]
      },
      tags: ["seo", "social", "opengraph", "image"],
      metadata: toolMeta("native", "og_image_generate", ["none"], "never", "none", "ready")
    },
    async ({ title, backgroundUrl }) => {
      const url = generateOgImageUrl(title as string, backgroundUrl as string | undefined);
      publishArtifact(activity, missionId, `og-image-${slugId(title as string)}`, "image", url);
      return { success: true, imageUrl: url };
    }
  );

  // Sandbox-routed sysadmin tools — distinct from the coding-agent's native
  // repo file/exec tools. These use SysadminModule(sandbox) so a charter
  // running under a microvm sandbox can do file/command ops inside the
  // sandbox rather than against the host repo. Renamed to `sandbox_*` to
  // disambiguate from coding-agent's `read_file` / `write_file` / `run_command`.
  reg.register(
    {
      name: "sandbox_run_command",
      description: "Execute a terminal command (PowerShell/Bash) inside the configured sandbox.",
      schema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" }
        },
        required: ["command"]
      },
      tags: ["sysadmin", "os", "terminal", "execute", "sandbox"],
      allowedRoles: ["coding"],
      metadata: toolMeta("native", "sandbox_command_run", ["shell", "filesystem", "network"], "on-side-effect", "microvm", "needs-live-test")
    },
    async ({ command, cwd }) => {
      const res = await sysadmin.runCommand(command as string, cwd as string | undefined);
      return { success: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    }
  );

  reg.register(
    {
      name: "sandbox_read_file",
      description: "Read the contents of a file inside the configured sandbox.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      },
      tags: ["sysadmin", "os", "file", "read", "sandbox"],
      allowedRoles: ["coding"],
      metadata: toolMeta("native", "sandbox_file_read", ["filesystem"], "never", "microvm", "needs-live-test")
    },
    async ({ path }) => {
      const res = await sysadmin.readFile(path as string);
      if (res.error) return { success: false, error: res.error };
      return { success: true, content: res.content };
    }
  );

  reg.register(
    {
      name: "sandbox_write_file",
      description: "Write or overwrite a file inside the configured sandbox.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      },
      tags: ["sysadmin", "os", "file", "write", "sandbox"],
      allowedRoles: ["coding"],
      metadata: toolMeta("native", "sandbox_file_write", ["filesystem"], "on-side-effect", "microvm", "needs-live-test")
    },
    async ({ path, content }) => {
      const res = await sysadmin.writeFile(path as string, content as string);
      if (res.error) return { success: false, error: res.error };
      return { success: true };
    }
  );

  reg.register(
    {
      name: "sandbox_list_dir",
      description: "List all files and directories in a path inside the configured sandbox.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      },
      tags: ["sysadmin", "os", "file", "list", "sandbox"],
      allowedRoles: ["coding"],
      metadata: toolMeta("native", "sandbox_file_list", ["filesystem"], "never", "microvm", "needs-live-test")
    },
    async ({ path }) => {
      const res = await sysadmin.listDir(path as string);
      if (res.error) return { success: false, error: res.error };
      return { success: true, items: res.items };
    }
  );

  // Vision
  reg.register({ name: capture_screen.name, description: capture_screen.description, schema: capture_screen.parameters as any, metadata: toolMeta("adapter", "computer_screen_capture", ["browser", "filesystem"], "always", "host", "needs-live-test") }, capture_screen.execute);
  reg.register({ name: analyze_image.name, description: analyze_image.description, schema: analyze_image.parameters as any, costUsd: analyze_image.costUsd, metadata: toolMeta("mock", "vision_image_analyze", ["spend"], "on-cost", "remote-provider", "stub") }, analyze_image.execute);

  // Voice — Praetor-native runtime; Kokoro 82M default, Azure Speech adapter
  // when AZURE_SPEECH_KEY is in env. Audio is written to praetor-out/voice/
  // and the absolute path is returned so downstream tools (compositor, social
  // poster) can pick it up.
  const voiceRuntime = new PraetorVoice();
  voiceRuntime.attach("kokoro", new KokoroAdapter());
  if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
    voiceRuntime.attach("azure-speech", new AzureSpeechAdapter({
      subscriptionKey: process.env.AZURE_SPEECH_KEY,
      region: process.env.AZURE_SPEECH_REGION,
    }));
  }
  reg.register<{ text: string; voice?: string; backend?: VoiceBackend; rate?: string }, { success: boolean; audioPath: string; backend: string; licenseFamily: string; durationMs?: number }>(
    {
      name: "voice_synthesize",
      description: "Synthesize speech from text via PraetorVoice. Default backend is Kokoro 82M (Apache 2.0). Pass backend='azure-speech' to opt into proprietary high-quality VO. Returns the absolute path to the produced audio file.",
      schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          voice: { type: "string", description: "Backend-specific voice id (e.g. af_bella for Kokoro, en-US-AndrewNeural for Azure)." },
          backend: { type: "string", enum: ["kokoro", "azure-speech"] },
          rate: { type: "string", description: "SSML rate. Defaults to +0%." },
        },
        required: ["text"],
      },
      tags: ["voice", "tts", "audio"],
      metadata: toolMeta("native", "voice_synthesize", ["filesystem", "spend"], "on-cost", "host", "needs-live-test", "Praetor-native runtime; Kokoro is Apache, Azure adapter is proprietary."),
    },
    async ({ text, voice, backend, rate }) => {
      const result = await voiceRuntime.synthesize({ text: String(text), voice, backend, rate });
      const dir = join(outDir, "voice");
      mkdirSync(dir, { recursive: true });
      const ext = result.mime === "audio/mpeg" ? "mp3" : "wav";
      const filename = `voice-${Date.now().toString(36)}.${ext}`;
      const filePath = join(dir, filename);
      writeFileSync(filePath, result.audioBuffer);
      publishArtifact(activity, missionId, `voice-${filename}`, "text", filePath);
      return {
        success: true,
        audioPath: filePath,
        backend: result.backend,
        licenseFamily: result.licenseFamily,
        durationMs: result.durationMs,
      };
    },
  );

  // Browser — Praetor-native, lazy-loads playwright-core. Single shared
  // session per mission so charters can navigate then click then snapshot
  // without re-launching Chromium.
  const browserSession = new PraetorBrowser({
    adapter: new PlaywrightAdapter(),
    bus: activity,
    missionId,
  });

  reg.register<{ url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number }, { success: boolean; url: string }>(
    {
      name: "browser_navigate",
      description: "Navigate the headless browser to a URL. Lazy-launches Chromium on first call. Subsequent browser_* tools reuse the same page.",
      schema: {
        type: "object",
        properties: {
          url: { type: "string" },
          waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
          timeoutMs: { type: "integer" },
        },
        required: ["url"],
      },
      tags: ["browser", "navigation"],
      metadata: toolMeta("native", "browser_navigate", ["network", "browser"], "on-side-effect", "browser", "needs-live-test"),
    },
    async ({ url, waitUntil, timeoutMs }) => {
      await browserSession.navigate(String(url), { waitUntil, timeoutMs });
      return { success: true, url: String(url) };
    },
  );

  reg.register<{ selector: string; button?: "left" | "right" | "middle"; timeoutMs?: number }, { success: boolean }>(
    {
      name: "browser_click",
      description: "Click an element by CSS / role-name selector. Pair with browser_snapshot to discover selectors.",
      schema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          button: { type: "string", enum: ["left", "right", "middle"] },
          timeoutMs: { type: "integer" },
        },
        required: ["selector"],
      },
      tags: ["browser", "input"],
      metadata: toolMeta("native", "browser_click", ["browser"], "on-side-effect", "browser", "needs-live-test"),
    },
    async ({ selector, button, timeoutMs }) => {
      await browserSession.click(String(selector), { button, timeoutMs });
      return { success: true };
    },
  );

  reg.register<{ selector: string; value: string; timeoutMs?: number }, { success: boolean }>(
    {
      name: "browser_fill",
      description: "Fill a form field by selector. Use for inputs, textareas, contenteditable.",
      schema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          value: { type: "string" },
          timeoutMs: { type: "integer" },
        },
        required: ["selector", "value"],
      },
      tags: ["browser", "input"],
      metadata: toolMeta("native", "browser_fill", ["browser"], "on-side-effect", "browser", "needs-live-test"),
    },
    async ({ selector, value, timeoutMs }) => {
      await browserSession.fill(String(selector), String(value), { timeoutMs });
      return { success: true };
    },
  );

  reg.register<{ keys: string; timeoutMs?: number }, { success: boolean }>(
    {
      name: "browser_press",
      description: "Press a key combination on the active page (e.g. 'Enter', 'Control+A').",
      schema: {
        type: "object",
        properties: {
          keys: { type: "string" },
          timeoutMs: { type: "integer" },
        },
        required: ["keys"],
      },
      tags: ["browser", "input"],
      metadata: toolMeta("native", "browser_press", ["browser"], "on-side-effect", "browser", "needs-live-test"),
    },
    async ({ keys, timeoutMs }) => {
      await browserSession.press(String(keys), { timeoutMs });
      return { success: true };
    },
  );

  reg.register<{ html?: boolean }, { url: string; title: string; a11y: string; html?: string; elements: { selector: string; label?: string }[] }>(
    {
      name: "browser_snapshot",
      description: "Capture the current page as a compact accessibility outline + actionable element refs. Cheap, structured, LLM-friendly.",
      schema: {
        type: "object",
        properties: {
          html: { type: "boolean", description: "Include raw HTML in the snapshot. Default false." },
        },
        required: [],
      },
      tags: ["browser", "context"],
      metadata: toolMeta("native", "browser_snapshot", ["browser"], "never", "browser", "needs-live-test"),
    },
    async ({ html }) => {
      const snap = await browserSession.snapshot({ html: !!html });
      return {
        url: snap.url,
        title: snap.title,
        a11y: snap.a11y,
        html: snap.html,
        elements: snap.elements.map((e) => ({ selector: e.selector, label: e.label })),
      };
    },
  );

  reg.register<{ fullPage?: boolean }, { success: boolean; path: string }>(
    {
      name: "browser_screenshot",
      description: "PNG screenshot of the current page. Saves to praetor-out/browser/ and returns the absolute path.",
      schema: {
        type: "object",
        properties: { fullPage: { type: "boolean" } },
        required: [],
      },
      tags: ["browser", "vision"],
      metadata: toolMeta("native", "browser_screenshot", ["browser", "filesystem"], "never", "browser", "needs-live-test"),
    },
    async ({ fullPage }) => {
      const buf = await browserSession.screenshot({ fullPage: !!fullPage });
      const dir = join(outDir, "browser");
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `screenshot-${Date.now().toString(36)}.png`);
      writeFileSync(filePath, buf);
      publishArtifact(activity, missionId, `browser-${Date.now().toString(36)}`, "image", filePath);
      return { success: true, path: filePath };
    },
  );

  // Social
  reg.register({ name: post_x_tweet.name, description: post_x_tweet.description, schema: post_x_tweet.parameters as any, costUsd: post_x_tweet.costUsd, allowedRoles: ["marketer", "developer"], metadata: toolMeta("mock", "social_x_post", ["reputation", "external_publish"], "always", "remote-provider", "stub") }, post_x_tweet.execute);
  reg.register({ name: post_tiktok_video.name, description: post_tiktok_video.description, schema: post_tiktok_video.parameters as any, costUsd: post_tiktok_video.costUsd, allowedRoles: ["marketer"], metadata: toolMeta("mock", "social_tiktok_post", ["reputation", "external_publish"], "always", "remote-provider", "stub") }, post_tiktok_video.execute);
  reg.register({ name: schedule_cron_job.name, description: schedule_cron_job.description, schema: schedule_cron_job.parameters as any, costUsd: schedule_cron_job.costUsd, allowedRoles: ["architect", "developer"], metadata: toolMeta("mock", "mission_schedule", ["external_publish"], "on-side-effect", "none", "stub") }, schedule_cron_job.execute);

  // Dynamic Plugin Loading
  if (charter.plugins && charter.plugins.length > 0) {
    for (const pluginName of charter.plugins) {
      try {
        const plugin = await import(pluginName);
        if (plugin.tools && Array.isArray(plugin.tools)) {
          for (const t of plugin.tools) {
             reg.register(t.def, t.execute);
          }
        } else if (plugin.default && typeof plugin.default === "function") {
          plugin.default(reg);
        }
      } catch (err: any) {
        console.warn(`Failed to load plugin ${pluginName}: ${err.message}`);
      }
    }
  }

  return reg;
}

function publishArtifact(activity: ActivityBus | undefined, missionId: string, artifactId: string, format: ArtifactFormat, url: string): void {
  if (!activity || !missionId || !url) return;
  activity.publish({
    kind: "artifact.done",
    missionId,
    artifactId,
    format,
    url,
    ts: new Date().toISOString(),
  });
}

function publishRemoteArtifacts(activity: ActivityBus | undefined, missionId: string, prefix: string, result: Record<string, unknown>): void {
  const glbUrl = typeof result.glbUrl === "string" ? result.glbUrl : "";
  const spzUrl = typeof result.spzUrl === "string" ? result.spzUrl : "";
  const splatUrl = typeof result.splatUrl === "string" ? result.splatUrl : spzUrl;
  const thumbUrl = typeof result.thumbUrl === "string" ? result.thumbUrl : "";
  if (glbUrl) publishArtifact(activity, missionId, `${prefix}-glb`, "glb", glbUrl);
  if (splatUrl) publishArtifact(activity, missionId, `${prefix}-splat`, "splat", splatUrl);
  if (thumbUrl) publishArtifact(activity, missionId, `${prefix}-thumb`, "image", thumbUrl);
}

function stdoutActivityBus(): ActivityBus {
  return {
    publish(e: ActivityEvent) {
      process.stdout.write(`${ACTIVITY_PREFIX}${JSON.stringify(e)}\n`);
    },
    subscribe() {
      return () => undefined;
    },
  };
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact";
}

function parseYaml(src: string): unknown {
  return parseYamlReal(src);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function writeBundle(outDir: string, charter: Charter, result: MissionResult, audit: MerkleAudit, operatorId?: string) {
  const bundle = buildArticle12Bundle({ charter, result, audit, operatorId });
  mkdirSync(outDir, { recursive: true });
  for (const f of bundle.files) {
    const target = join(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.body);
  }
  writeFileSync(join(outDir, "bundle.sha256"), bundle.bundleSha256 + "\n");
  return bundle;
}

async function cmdRun(args: string[]) {
  const charterPath = args[0];
  if (!charterPath) {
    console.error("usage: praetor run <charter.yaml> [--article12 <out-dir>] [--save <mission.json>]");
    exit(1);
  }
  const article12Out = flag(args, "--article12");
  const saveMission = flag(args, "--save");
  const operatorId = flag(args, "--operator");
  const verbose = args.includes("--verbose") || args.includes("-v");

  loadDotenv(
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "mnemopay-sdk", ".env"),
    resolve(process.cwd(), "..", "..", "mnemopay-sdk", ".env"),
  );

  const raw = readFileSync(charterPath, "utf8");
  const charter = validateCharter(parseYaml(raw));
  const audit = new MerkleAudit();
  if (verbose) {
    audit.on((event, chainHash, index) => {
      log.debug("audit.event", { i: index, ts: event.ts, type: event.type, chain: chainHash.slice(0, 12), data: event.data });
    });
  }
  
  let payments: PaymentsAdapter;
  const mnemoKey = process.env.MNEMOPAY_API_KEY;
  if (mnemoKey) {
    if (verbose) log.info("payments", { backend: "mnemopay-live" });
    const baseUrl = process.env.MNEMOPAY_BASE_URL || "https://api.mnemopay.com";
    payments = new MnemoPayAdapter(new LiveMnemoPayClient(mnemoKey, baseUrl));
  } else {
    if (verbose) log.info("payments", { backend: "mock" });
    payments = new MockPayments();
  }

  const missionId = process.env.PRAETOR_MISSION_ID || charter.name;
  const activity = stdoutActivityBus();
  activity.publish({ kind: "milestone", missionId, text: "Mission started", ts: new Date().toISOString() });
  const registry = await buildEnhancedRegistry(charter, missionId, audit, activity);
  const agent = pickAgent(charter, payments, audit, registry);
  if (verbose) log.info("agent.selected", { agent: agent.name });
  const result = await runMission({
    charter,
    payments,
    agents: { run: async (c, signal) => agent.run({ goal: c.goal, outputs: c.outputs, budgetUsd: c.budget.maxUsd, steps: c.steps, agents: c.agents, signal, role: c.agents[0]?.role }) },
    audit,
  });
  activity.publish({ kind: "milestone", missionId, text: result.status === "ok" ? "Mission completed" : "Mission failed", ts: new Date().toISOString() });

  if (saveMission) {
    const record = {
      charter,
      result,
      audit: audit.toJSON(),
      operatorId,
    };
    mkdirSync(dirname(resolve(saveMission)), { recursive: true });
    writeFileSync(saveMission, JSON.stringify(record, null, 2));
  }

  const wantArticle12 = article12Out || charter.compliance?.article12;
  if (wantArticle12) {
    const dir = article12Out ?? charter.compliance?.auditLogPath ?? "./article12-bundle";
    const bundle = writeBundle(dir, charter, result, audit, operatorId);
    console.error(`[praetor] wrote ${bundle.files.length} Article 12 files to ${resolve(dir)} (sha256=${bundle.bundleSha256.slice(0, 12)}…)`);
  }

  console.log(JSON.stringify(result, null, 2));
}

async function cmdArticle12(args: string[]) {
  const inPath = flag(args, "--in") ?? flag(args, "--mission");
  const outDir = flag(args, "--out");
  const operatorId = flag(args, "--operator");
  if (!inPath || !outDir) {
    console.error("usage: praetor article12 --in <mission.json> --out <bundle-dir> [--operator <id>]");
    exit(1);
  }
  const record = JSON.parse(readFileSync(inPath, "utf8")) as {
    charter: Charter;
    result: MissionResult;
    audit: { events: { ts: string; type: string; data: Record<string, unknown> }[]; chain: string[] };
    operatorId?: string;
  };
  const audit = MerkleAudit.fromJSON(record.audit);
  if (!audit.verify()) {
    console.error("[praetor] WARNING: chain verification failed for mission record at " + inPath);
  }
  const bundle = writeBundle(outDir, record.charter, record.result, audit, operatorId ?? record.operatorId);
  console.log(JSON.stringify({
    files: bundle.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    bundleSha256: bundle.bundleSha256,
    out: resolve(outDir),
  }, null, 2));
}

async function cmdIngest(args: string[]) {
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("usage: praetor ingest <url> [--mission <id>] [--backend fetch|crawl4ai|playwright-mcp|firecrawl] [--chunk <chars>]");
    exit(1);
  }
  const missionId = flag(args, "--mission") ?? "default";
  const backend = (flag(args, "--backend") as ScrapeBackend | undefined) ?? "fetch";
  const chunkChars = Number(flag(args, "--chunk") ?? "1200");

  const scraper = defaultScraper();
  const r = await scraper.scrape({ url, backend });
  if (r.status >= 400) {
    console.error(`[praetor] scrape returned ${r.status} for ${url}`);
    exit(2);
  }
  const text = r.text ?? r.body;
  const pieces = chunkText(text, chunkChars);

  const kb = defaultKnowledgeBase({ missionId });
  const chunks = pieces.map((piece, i) => ({
    id: `${urlHash(url)}-${i}`,
    text: piece,
    source: url,
    metadata: {
      url,
      contentType: r.contentType,
      backend: r.backend,
      fetchedAt: r.fetchedAt,
      tier: "semantic" as const,
      partIndex: i,
      partCount: pieces.length,
    },
  }));
  const ing = await kb.ingest(chunks);
  console.log(JSON.stringify({
    url,
    backend: r.backend,
    status: r.status,
    chunks: pieces.length,
    ingested: ing.ingested,
    missionId,
    jsonLd: r.jsonLd?.length ?? 0,
  }, null, 2));
}

function urlHash(u: string): string {
  return createHash("sha1").update(u).digest("hex").slice(0, 12);
}

async function cmdDesignServe(args: string[]) {
  const sub = args[0];
  if (sub !== "serve") {
    console.error("usage: praetor design serve <dir> [--port <n>] [--host <h>]");
    exit(1);
  }
  const dir = args[1] ?? ".";
  const port = Number(flag(args, "--port") ?? "0");
  const host = flag(args, "--host") ?? "127.0.0.1";
  const { startDesignServer } = await import("./serve.js");
  const handle = await startDesignServer({ dir, port, host });
  const stop = () => { handle.close().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`praetor design serve: ${handle.url}`);
}

async function cmdServe(args: string[]): Promise<void> {
  // Auto-set dev mode so the api boots without real Supabase credentials.
  if (!process.env.PRAETOR_DEV_MODE) {
    process.env.PRAETOR_DEV_MODE = "1";
  }

  // Load dotenv so ANTHROPIC_API_KEY and friends are available.
  loadDotenv(
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "mnemopay-sdk", ".env"),
    resolve(process.cwd(), "..", "..", "mnemopay-sdk", ".env"),
  );

  // Dynamic import avoids a circular tsconfig project reference (api→cli→api).
  // The import is typed via an explicit interface so the compiler is satisfied
  // without needing @praetor/api in the references array.
  interface ApiLib {
    createApp(): {
      listen(port: number, host: string, cb: () => void): { close(cb: () => void): void };
    };
    env: { port: number; host: string };
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — runtime-only dep; no tsconfig reference to avoid api↔cli cycle
  const { createApp, env } = await import("@praetor/api/lib") as unknown as ApiLib;
  const app = createApp();
  const portArg = flag(args, "--port");
  const port = portArg ? Number(portArg) : env.port;
  const host = flag(args, "--host") ?? env.host;

  const server = app.listen(port, host, () => {
    const base = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
    process.stdout.write(
      [
        `[praetor-api] listening on ${base}`,
        `[praetor-api] dev mode ON — any bearer token authenticates as dev-user`,
        ``,
        `  curl example:`,
        `    curl -X POST ${base}/api/v1/missions \\`,
        `      -H "Authorization: Bearer dev:any" \\`,
        `      -H "Content-Type: application/json" \\`,
        `      -d '{"goal":"hello world"}'`,
        ``,
      ].join("\n"),
    );
  });

  const stop = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Keep the process alive.
  await new Promise<never>(() => {});
}

function usage(): never {
  console.error([
    "usage:",
    "  praetor run <charter.yaml> [--article12 <out-dir>] [--save <mission.json>] [--operator <id>] [--verbose]",
    "  praetor article12 --in <mission.json> --out <bundle-dir> [--operator <id>]",
    "  praetor ingest <url> [--mission <id>] [--backend fetch|crawl4ai|playwright-mcp|firecrawl] [--chunk <chars>]",
    "  praetor design serve <dir> [--port <n>] [--host <h>]",
    "  praetor serve [--port <n>] [--host <h>]",
    "  praetor doctor",
    "  praetor tools [--role <role>]",
    "  praetor smoke [--live] [--include <substring>] [--exclude <substring>] [--out <path>]",
  ].join("\n"));
  exit(1);
}

/** Print install-health report. Verifies env, registers tools, dry-runs hello. */
async function cmdDoctor(): Promise<void> {
  const lines: string[] = [];
  const ok = (m: string) => lines.push(`  [ok] ${m}`);
  const warn = (m: string) => lines.push(`  [warn] ${m}`);
  const fail = (m: string) => lines.push(`  [fail] ${m}`);

  lines.push("praetor doctor");
  lines.push("");
  lines.push("runtime:");
  ok(`node ${process.version}`);
  ok(`platform ${process.platform}/${process.arch}`);

  lines.push("");
  lines.push("env:");
  const envs = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "MNEMOPAY_API_KEY", "REPLICATE_API_TOKEN", "FAL_KEY", "ELEVENLABS_API_KEY", "AZURE_SPEECH_KEY", "FIRECRAWL_API_KEY"];
  for (const k of envs) (process.env[k] ? ok : warn)(`${k}${process.env[k] ? "" : " (unset — provider unavailable)"}`);

  lines.push("");
  lines.push("registry:");
  try {
    const dummyCharter: Charter = { name: "doctor", goal: "probe", agents: [], outputs: [], budget: { maxUsd: 0, approvalThresholdUsd: 0 } };
    const reg = await buildEnhancedRegistry(dummyCharter, "doctor");
    const all = reg.list();
    const report = reg.productionReport();
    ok(`${all.length} tools registered`);
    ok(`origin: native=${report.byOrigin.native} adapter=${report.byOrigin.adapter} mock=${report.byOrigin.mock} experimental=${report.byOrigin.experimental}`);
    ok(`production: ready=${report.byState.ready} needs-live-test=${report.byState["needs-live-test"]} needs-native-rewrite=${report.byState["needs-native-rewrite"]} stub=${report.byState.stub}`);
    if (report.missingMetadata.length > 0) warn(`${report.missingMetadata.length} tools missing metadata: ${report.missingMetadata.slice(0, 5).join(", ")}${report.missingMetadata.length > 5 ? ", ..." : ""}`);
  } catch (e) {
    fail(`registry build error: ${(e as Error).message}`);
  }

  lines.push("");
  lines.push("hello-world dry run:");
  try {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const helloPath = path.join(process.cwd(), "charters", "hello.yaml");
    if (!fs.existsSync(helloPath)) {
      warn("charters/hello.yaml not found — skipping dry run");
    } else {
      ok(`charters/hello.yaml present`);
      ok(`run with: node packages/cli/dist/index.js run charters/hello.yaml`);
      ok(`output lands at: .praetor/sandbox/<mock-id>/hello.txt`);
    }
  } catch (e) {
    fail(`hello dry-run probe failed: ${(e as Error).message}`);
  }

  console.log(lines.join("\n"));
}

/** List registered tools, optionally filtered by role. Surfaces the
 * tags-vs-allowedRoles distinction that confused the hello.yaml author. */
async function cmdTools(args: string[]): Promise<void> {
  let role: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role") role = args[++i];
  }
  const dummyCharter: Charter = { name: "tools", goal: "list", agents: [], outputs: [], budget: { maxUsd: 0, approvalThresholdUsd: 0 } };
  const reg = await buildEnhancedRegistry(dummyCharter, "tools");
  const all = role ? reg.list(role) : reg.list();
  console.log(`${all.length} tools${role ? ` accessible to role '${role}'` : " registered"}:`);
  for (const t of all) {
    const roles = t.allowedRoles?.length ? `roles=[${t.allowedRoles.join(",")}]` : "roles=*";
    const cost = t.costUsd ? `$${t.costUsd}` : "free";
    const origin = t.metadata?.origin ?? "?";
    console.log(`  ${t.name.padEnd(36)} ${origin.padEnd(12)} ${cost.padEnd(8)} ${roles}`);
  }
}

// Re-exports so the API server, smoke tests, and embedders can build the same
// registry the CLI uses when running a charter.
export { defaultRegistry, MockPayments, MnemoPayAdapter, EchoAgent, NativePraetorEngine, CoordinatorAgent };
export { LiveMnemoPayClient };

async function main() {
  const [, , cmd, ...rest] = argv;
  if (!cmd) usage();
  switch (cmd) {
    case "run": return cmdRun(rest);
    case "article12": return cmdArticle12(rest);
    case "ingest": return cmdIngest(rest);
    case "design": return cmdDesignServe(rest);
    case "doctor": return cmdDoctor();
    case "tools": return cmdTools(rest);
    case "serve": return cmdServe(rest);
    case "smoke": {
      const mod = await import("./smoke.js");
      return mod.cmdSmoke(rest);
    }
    default: usage();
  }
}

// Only auto-run when invoked as a script — keeps `import` from triggering main().
const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (entry === self) {
  main().catch((e) => { console.error(e); exit(1); });
}
