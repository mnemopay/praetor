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
});
