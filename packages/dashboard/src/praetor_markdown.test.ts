import { describe, it, expect } from "vitest";
import { renderMarkdown, praetorSanitize, escapeHtml } from "./praetor_markdown.js";

describe("escapeHtml", () => {
  it("escapes the five XSS-relevant chars", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      `&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;`,
    );
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("'sneaky'")).toBe("&#39;sneaky&#39;");
  });
});

describe("renderMarkdown — block features", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
    expect(renderMarkdown("### sub")).toContain("<h3>sub</h3>");
  });

  it("renders paragraphs separated by blank lines", () => {
    const out = renderMarkdown("first.\n\nsecond.");
    expect(out).toContain("<p>first.</p>");
    expect(out).toContain("<p>second.</p>");
  });

  it("renders unordered lists", () => {
    const out = renderMarkdown("- a\n- b");
    expect(out).toContain("<ul><li>a</li><li>b</li></ul>");
  });

  it("renders ordered lists", () => {
    const out = renderMarkdown("1. one\n2. two");
    expect(out).toContain("<ol><li>one</li><li>two</li></ol>");
  });

  it("renders blockquotes", () => {
    expect(renderMarkdown("> quoted")).toContain("<blockquote>quoted</blockquote>");
  });

  it("renders fenced code blocks with HTML escaped inside", () => {
    const out = renderMarkdown("```\n<script>x</script>\n```");
    expect(out).toContain("<pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>");
  });
});

describe("renderMarkdown — inline features", () => {
  it("renders bold + italic", () => {
    expect(renderMarkdown("**bold** and *italic*")).toContain(
      "<strong>bold</strong> and <em>italic</em>",
    );
  });

  it("renders inline code", () => {
    expect(renderMarkdown("call `foo()`")).toContain("<code>foo()</code>");
  });

  it("renders safe http links with rel + target enforced", () => {
    const out = renderMarkdown("see [docs](https://example.com)");
    expect(out).toContain('<a href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("autolinks bare URLs", () => {
    const out = renderMarkdown("see https://example.com for more");
    expect(out).toContain('<a href="https://example.com');
  });
});

describe("renderMarkdown — XSS resistance", () => {
  it("blocks javascript: hrefs", () => {
    const out = renderMarkdown("[click](javascript:alert(1))");
    // Unsafe scheme — link is left as raw text, not converted.
    expect(out).not.toContain("<a ");
    expect(out).toContain("[click](javascript:alert(1))");
  });

  it("strips <script> tags from the input", () => {
    const out = renderMarkdown(`<script>alert("xss")</script>`);
    expect(out).not.toContain("<script>");
  });

  it("escapes raw HTML in the markdown source", () => {
    const out = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("strips on-event attributes from any allowlisted tag", () => {
    expect(praetorSanitize(`<p onclick="alert(1)">x</p>`)).toBe("<p>x</p>");
  });

  it("rejects unknown tags entirely", () => {
    expect(praetorSanitize("<iframe src=x></iframe>x")).toBe("x");
    expect(praetorSanitize("<object data=x></object>")).toBe("");
  });

  it("preserves allowed tags + their allowed attrs", () => {
    expect(praetorSanitize(`<a href="https://safe.com">link</a>`)).toContain(
      `<a href="https://safe.com"`,
    );
  });
});
