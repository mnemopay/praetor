import { describe, it, expect } from "vitest";
import { DesignPack } from "./index.js";

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
