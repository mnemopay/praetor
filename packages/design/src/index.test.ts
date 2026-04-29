import { describe, it, expect } from "vitest";
import { DesignPack, listSplinePresets, resolveSplinePreset } from "./index.js";

describe("DesignPack declarative UI", () => {
  const pack = new DesignPack();

  it("renders a simple node tree to HTML", () => {
    const html = pack.renderHtml({
      type: "section",
      props: { class: "hero" },
      children: [
        { type: "h1", children: ["Praetor"] },
        { type: "p", children: ["Mission runtime."] },
      ],
    });
    expect(html).toContain('<section class="hero">');
    expect(html).toContain("<h1>Praetor</h1>");
    expect(html).toContain("<p>Mission runtime.</p>");
  });

  it("escapes attribute and text content", () => {
    const html = pack.renderHtml({
      type: "div",
      props: { title: 'a"b' },
      children: ['<script>alert("x")</script>'],
    });
    expect(html).toContain('title="a&quot;b"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("emits a Spline viewer snippet", () => {
    const out = pack.renderSpline("https://prod.spline.design/abc/scene.splinecode");
    expect(out).toContain("<spline-viewer");
    expect(out).toContain("scene.splinecode");
  });

  it("renders a Remotion project artifact", async () => {
    const art = await pack.renderRemotion({
      id: "hello",
      durationInFrames: 60,
      fps: 30,
      width: 1920,
      height: 1080,
      scenes: [
        { type: "div", props: { style: "background:#000;color:#fff" }, children: ["Praetor"] },
      ],
    });
    expect(art.surface).toBe("remotion");
    const paths = art.files.map((f) => f.path);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/Root.tsx");
    expect(paths).toContain("src/scenes/Scene0.tsx");
    const root = art.files.find((f) => f.path === "src/Root.tsx")!.contents;
    expect(root).toContain('id="hello"');
    expect(root).toContain("durationInFrames={60}");
  });

  it("Spline preset library exposes the BizSuite hero preset", () => {
    const all = listSplinePresets();
    expect(all.map((p) => p.id)).toContain("godly-3d-orb");
    const orb = resolveSplinePreset("godly-3d-orb");
    expect(orb.sceneUrl).toContain("splinecode");
    expect(orb.background).toContain("radial-gradient");
  });

  it("renderSplinePreset emits a viewer with attributes from the preset", () => {
    const out = pack.renderSplinePreset("ai-audit-shield");
    expect(out).toContain("<spline-viewer");
    expect(out).toContain("loading-policy=\"lazy\"");
    expect(out).toContain("AuditShield");
  });

  it("toDeleVideo writes scenes under compositions/<id>/", () => {
    const art = pack.toDeleVideo({
      id: "praetor-spot",
      durationInFrames: 120,
      fps: 30,
      width: 1080,
      height: 1920,
      scenes: [{ type: "div", children: ["spot"] }],
    });
    const paths = art.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("dele-video/src/compositions/praetor-spot"))).toBe(true);
    expect(paths).toContain("dele-video/compositions/praetor-spot/manifest.json");
  });

  it("toUgcPipeline emits a job spec under ugc-pipeline/jobs/", () => {
    const art = pack.toUgcPipeline({
      id: "Article 12 Wedge",
      durationSec: 22,
      background: { type: "color", value: "#0a0a0a" },
      voiceover: { text: "Get Article 12 compliant in 1 hour.", provider: "edge" },
      textOverlays: [{ text: "Aug 2 deadline", startSec: 0, endSec: 3, position: "top" }],
      cta: { text: "praetor.dev", url: "https://praetor.dev" },
    });
    const job = art.files[0];
    expect(job.path).toBe("ugc-pipeline/jobs/article-12-wedge.json");
    const parsed = JSON.parse(job.contents);
    expect(parsed.renderer).toBe("kenburns-edge-tts");
    expect(parsed.aspect).toBe("9:16");
  });

  it("renderHtmlInCanvas3D emits a self-contained THREE+CSS3D hero with interactive HTML cards", () => {
    const art = pack.renderHtmlInCanvas3D({
      title: "BizSuite",
      background: "#000",
      rings: true,
      faceParallax: true,
      mouseParallax: true,
      cards: [
        { id: "starter", html: "<h2>Starter</h2><p>$2.5K</p><a class='cta' href='#buy'>Buy</a>" },
        { id: "growth", html: "<h2>Growth</h2><p>$5K</p>" },
        { id: "scale", html: "<h2>Scale</h2><p>$10K</p>" },
      ],
    });
    const idx = art.files.find((f) => f.path === "index.html")!.contents;
    expect(idx).toContain("<title>BizSuite</title>");
    expect(idx).toContain("CSS3DRenderer");
    expect(idx).toContain("TorusGeometry");
    expect(idx).toContain("FaceLandmarker");
    expect(idx).toContain("Starter");
    expect(idx).toContain('data-id="growth"');
    const fallback = art.files.find((f) => f.path === "spec.json")!.contents;
    expect(JSON.parse(fallback).cards).toHaveLength(3);
  });

  it("renderHtmlInCanvas3D omits face/rings code when disabled", () => {
    const art = pack.renderHtmlInCanvas3D({
      title: "Plain",
      faceParallax: false,
      rings: false,
      cards: [{ id: "a", html: "<h2>A</h2>" }],
    });
    const idx = art.files.find((f) => f.path === "index.html")!.contents;
    expect(idx).toContain("FACE_PARALLAX = false");
    expect(idx).toContain("RINGS = false");
  });

  it("renders a Hypeframes scene with embedded runtime", async () => {
    const art = await pack.renderHypeframes({
      loop: true,
      frames: [
        { delayMs: 800, node: { type: "h1", children: ["Frame 1"] } },
        { delayMs: 800, node: { type: "h1", children: ["Frame 2"] } },
      ],
    });
    expect(art.surface).toBe("hypeframes");
    const html = art.files.find((f) => f.path === "scene.html")!.contents;
    expect(html).toContain("Frame 1");
    expect(html).toContain("Frame 2");
    expect(html).toContain("class=\"frame\"");
  });
});
