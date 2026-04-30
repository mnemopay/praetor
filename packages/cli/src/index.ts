#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { parse as parseYamlReal } from "yaml";
import {
  validateCharter,
  runMission,
  MerkleAudit,
  buildArticle12Bundle,
  PolicyEngine,
  type Charter,
  type MissionResult,
} from "@praetor/core";
import { MockPayments, MnemoPayAdapter, type PaymentsAdapter, type MnemoPayClient } from "@praetor/payments";
import { EchoAgent, LlmAgent, NativePraetorEngine, type AgentAdapter } from "@praetor/agents";
import { defaultRegistry, type FiscalGate } from "@praetor/tools";
import { defaultScraper, type ScrapeBackend } from "@praetor/scrape";
import { chunkText, defaultKnowledgeBase } from "@praetor/knowledge";
import { DEFAULT_CATALOGUE, LlmRouter, registerDefaultProviders, type RouteRequirements } from "@praetor/router";
import { DesignPack, type HtmlInCanvas3DSpec, type SplinePresetId } from "@praetor/design";
import { renderSite, submitIndexNow, extractGeoProfile, analyzeContentSeo, generateOutreachSequence, generateOgImageUrl, type SiteManifest } from "@praetor/seo";
import { defaultBusinessOps, auditedBusinessOps, type AuditSink } from "@praetor/business-ops";
import { SysadminModule } from "@praetor/sysadmin";
import { SandboxDispatcher, MockSandboxFactory } from "@praetor/sandbox";
import { capture_screen, analyze_image } from "@praetor/vision";
import { post_x_tweet, post_tiktok_video, schedule_cron_job } from "@praetor/social";
import { defaultRenderer } from "@praetor/game-assets";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

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

  return new NativePraetorEngine(router, registry, { fiscal, audit }, policy, route);
}

function buildEnhancedRegistry(missionId: string, audit?: AuditSink) {
  const reg = defaultRegistry();
  const kb = defaultKnowledgeBase({ missionId });
  const design = new DesignPack();
  const outDir = resolve(process.cwd(), "praetor-out");
  
  const rawOps = defaultBusinessOps(process.env);
  const ops = audit ? auditedBusinessOps(rawOps, audit) : rawOps;
  const scraper = defaultScraper(process.env);
  const games = defaultRenderer({ outDir: join(outDir, "games") });

  // In real implementation this would use charter.sandbox.kind
  // For now we instantiate the MockSandbox by default if not native
  const sysadmin = new SysadminModule(); // Using native fallback until async sandbox init is wired in runMission

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
      tags: ["design", "3d", "landing_page"]
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
      tags: ["design", "3d", "landing_page"]
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
      }
      return { success: true, message: `Canvas3D files saved to: ${written.join(", ")}` };
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
      tags: ["seo", "geo", "sitemap", "generator"]
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
      tags: ["email", "outbound", "business"]
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
      tags: ["billing", "invoice", "stripe", "business"]
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
      tags: ["scheduling", "meeting", "cal.com", "business"]
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
      tags: ["crm", "contact", "business"]
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
      tags: ["scrape", "research", "crawl"]
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
      tags: ["game", "godot", "assets", "generation"]
    },
    async (spec) => {
      const res = await games.render(spec as any);
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
      tags: ["seo", "indexnow", "crawler"]
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
      tags: ["seo", "geo", "competitor", "analysis"]
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
      tags: ["seo", "content", "analysis"]
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
      tags: ["seo", "geo", "outreach", "email"]
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
      tags: ["seo", "social", "opengraph", "image"]
    },
    async ({ title, backgroundUrl }) => {
      const url = generateOgImageUrl(title as string, backgroundUrl as string | undefined);
      return { success: true, imageUrl: url };
    }
  );

  reg.register(
    {
      name: "run_command",
      description: "Execute a terminal command (PowerShell/Bash) on the host machine.",
      schema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" }
        },
        required: ["command"]
      },
      tags: ["sysadmin", "os", "terminal", "execute"]
    },
    async ({ command, cwd }) => {
      const res = await sysadmin.runCommand(command as string, cwd as string | undefined);
      return { success: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    }
  );

  reg.register(
    {
      name: "read_file",
      description: "Read the contents of a file on the local file system.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      },
      tags: ["sysadmin", "os", "file", "read"]
    },
    async ({ path }) => {
      const res = await sysadmin.readFile(path as string);
      if (res.error) return { success: false, error: res.error };
      return { success: true, content: res.content };
    }
  );

  reg.register(
    {
      name: "write_file",
      description: "Write or overwrite contents to a file on the local file system.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      },
      tags: ["sysadmin", "os", "file", "write"]
    },
    async ({ path, content }) => {
      const res = await sysadmin.writeFile(path as string, content as string);
      if (res.error) return { success: false, error: res.error };
      return { success: true };
    }
  );

  reg.register(
    {
      name: "list_dir",
      description: "List all files and directories in a given path.",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      },
      tags: ["sysadmin", "os", "file", "list"]
    },
    async ({ path }) => {
      const res = await sysadmin.listDir(path as string);
      if (res.error) return { success: false, error: res.error };
      return { success: true, items: res.items };
    }
  );

  // Vision
  reg.register({ name: capture_screen.name, description: capture_screen.description, schema: capture_screen.parameters as any }, capture_screen.execute);
  reg.register({ name: analyze_image.name, description: analyze_image.description, schema: analyze_image.parameters as any }, analyze_image.execute);

  // Social
  reg.register({ name: post_x_tweet.name, description: post_x_tweet.description, schema: post_x_tweet.parameters as any }, post_x_tweet.execute);
  reg.register({ name: post_tiktok_video.name, description: post_tiktok_video.description, schema: post_tiktok_video.parameters as any }, post_tiktok_video.execute);
  reg.register({ name: schedule_cron_job.name, description: schedule_cron_job.description, schema: schedule_cron_job.parameters as any }, schedule_cron_job.execute);

  return reg;
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
      process.stderr.write(JSON.stringify({ i: index, ts: event.ts, type: event.type, chain: chainHash.slice(0, 12), data: event.data }) + "\n");
    });
  }
  
  let payments: PaymentsAdapter;
  const mnemoKey = process.env.MNEMOPAY_API_KEY;
  if (mnemoKey) {
    if (verbose) process.stderr.write("[praetor] using live MnemoPay fiscal gate\\n");
    const baseUrl = process.env.MNEMOPAY_BASE_URL || "https://api.mnemopay.com";
    payments = new MnemoPayAdapter(new LiveMnemoPayClient(mnemoKey, baseUrl));
  } else {
    if (verbose) process.stderr.write("[praetor] using MockPayments fiscal gate (no MNEMOPAY_API_KEY)\\n");
    payments = new MockPayments();
  }

  const registry = buildEnhancedRegistry(charter.name, audit);
  const agent = pickAgent(charter, payments, audit, registry);
  if (verbose) process.stderr.write(JSON.stringify({ agent: agent.name }) + "\n");
  const result = await runMission({
    charter,
    payments,
    agents: { run: async (c, signal) => agent.run({ goal: c.goal, outputs: c.outputs, budgetUsd: c.budget.maxUsd, steps: c.steps, signal }) },
    audit,
  });

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

function usage(): never {
  console.error([
    "usage:",
    "  praetor run <charter.yaml> [--article12 <out-dir>] [--save <mission.json>] [--operator <id>] [--verbose]",
    "  praetor article12 --in <mission.json> --out <bundle-dir> [--operator <id>]",
    "  praetor ingest <url> [--mission <id>] [--backend fetch|crawl4ai|playwright-mcp|firecrawl] [--chunk <chars>]",
    "  praetor design serve <dir> [--port <n>] [--host <h>]",
  ].join("\n"));
  exit(1);
}

async function main() {
  const [, , cmd, ...rest] = argv;
  if (!cmd) usage();
  switch (cmd) {
    case "run": return cmdRun(rest);
    case "article12": return cmdArticle12(rest);
    case "ingest": return cmdIngest(rest);
    case "design": return cmdDesignServe(rest);
    default: usage();
  }
}

main().catch((e) => { console.error(e); exit(1); });
