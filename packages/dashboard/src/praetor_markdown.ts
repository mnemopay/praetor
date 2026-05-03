/**
 * PraetorMarkdown + PraetorSanitizer — native, dependency-free
 * markdown→safe-HTML pipeline. Replaces marked + DOMPurify in the
 * dashboard chat surface.
 *
 * Scope is intentionally narrow: the dashboard renders agent + user
 * chat messages, not arbitrary markdown documents. We support the
 * features chat actually uses:
 *   - paragraphs (blank-line separated)
 *   - headings #, ##, ###
 *   - **bold**, *italic*, `inline code`
 *   - ``` fenced code blocks (no language coloring)
 *   - lists: `- item` and `1. item`
 *   - blockquotes: `> quote`
 *   - links [text](url) — only http(s) and mailto: schemes pass
 *   - autolinked URLs in plain text (https://...)
 *
 * Anything unrecognized is escaped and rendered as text. The output is
 * passed through PraetorSanitizer which enforces a strict allowlist.
 *
 * No XSS surface: every string interpolation goes through escapeHtml,
 * link href is scheme-checked, and the sanitizer rejects unknown tags
 * + script/style/iframe/object/embed/on* attributes.
 */

const ALLOWED_TAGS = new Set([
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "code", "pre",
  "ul", "ol", "li",
  "blockquote",
  "a",
]);

const ALLOWED_ATTRS_BY_TAG: Record<string, Set<string>> = {
  a: new Set(["href", "rel", "target"]),
};

const SAFE_LINK_SCHEMES = /^(?:https?:|mailto:|#)/i;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

/** Render markdown to safe HTML. */
export function renderMarkdown(input: string): string {
  if (!input) return "";
  const blocks = splitBlocks(input);
  const html = blocks.map((b) => renderBlock(b)).filter(Boolean).join("\n");
  return praetorSanitize(html);
}

/** Public sanitize entry — use when you have raw HTML to allowlist. */
export function praetorSanitize(html: string): string {
  // Strip any closed/open tag not in the allowlist; strip on* attributes;
  // strip javascript:/data:/vbscript: hrefs. We don't run a full HTML
  // parser — the markdown emitter only produces a known set of tags, and
  // we treat the result as straight-line tokens.
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g, (raw, tag: string, attrs: string) => {
    const lc = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lc)) return ""; // drop unknown tag
    const allowed = ALLOWED_ATTRS_BY_TAG[lc];
    if (!allowed) return raw.replace(/\s+[^<>]*\/?>/, raw.endsWith("/>") ? " />" : ">"); // strip ALL attrs from tags that allow none
    // Filter attributes — allow only those in allowlist + safe schemes for href.
    const cleanedAttrs = (attrs.match(/\s+([\w-]+)\s*=\s*"([^"]*)"/g) ?? [])
      .map((m) => /\s+([\w-]+)\s*=\s*"([^"]*)"/.exec(m)!)
      .filter((m) => allowed.has(m[1].toLowerCase()))
      .map((m) => {
        const [, k, v] = m;
        if (k.toLowerCase() === "href" && !SAFE_LINK_SCHEMES.test(v)) return null;
        return ` ${k}="${escapeHtmlAttr(v)}"`;
      })
      .filter((s): s is string => s !== null)
      .join("");
    // Force rel=noopener noreferrer + target=_blank on external anchors.
    let extras = "";
    if (lc === "a" && /href="https?:/i.test(cleanedAttrs)) {
      if (!/rel=/i.test(cleanedAttrs)) extras += ' rel="noopener noreferrer"';
      if (!/target=/i.test(cleanedAttrs)) extras += ' target="_blank"';
    }
    return raw.startsWith("</") ? `</${lc}>` : `<${lc}${cleanedAttrs}${extras}>`;
  });
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/* ---------- Block parser ----------------------------------------------- */

function splitBlocks(input: string): string[] {
  // Normalize line endings + split on blank-line boundaries, but keep
  // fenced code blocks intact across blank lines.
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

function renderBlock(block: string): string {
  // Fenced code block.
  const fence = /^```(\w*)\n([\s\S]*?)\n?```$/.exec(block);
  if (fence) {
    return `<pre><code>${escapeHtml(fence[2].replace(/\n+$/, ""))}</code></pre>`;
  }
  // Heading.
  const heading = /^(#{1,6})\s+(.*)$/.exec(block);
  if (heading && !block.includes("\n")) {
    const level = heading[1].length;
    return `<h${level}>${renderInline(heading[2])}</h${level}>`;
  }
  // Blockquote.
  if (block.split("\n").every((l) => /^>\s?/.test(l))) {
    const inner = block.split("\n").map((l) => l.replace(/^>\s?/, "")).join("\n");
    return `<blockquote>${renderInline(inner.replace(/\n/g, " "))}</blockquote>`;
  }
  // Lists.
  if (block.split("\n").every((l) => /^\s*-\s+/.test(l))) {
    const items = block.split("\n").map((l) => `<li>${renderInline(l.replace(/^\s*-\s+/, ""))}</li>`).join("");
    return `<ul>${items}</ul>`;
  }
  if (block.split("\n").every((l) => /^\s*\d+\.\s+/.test(l))) {
    const items = block.split("\n").map((l) => `<li>${renderInline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("");
    return `<ol>${items}</ol>`;
  }
  // Default — paragraph with inline rendering. Newlines inside become <br>.
  return `<p>${renderInline(block).replace(/\n/g, "<br />")}</p>`;
}

/* ---------- Inline parser ---------------------------------------------- */

function renderInline(s: string): string {
  // Escape first, then replay markdown-syntax markers as tags. Order
  // matters: fenced > inline-code > link > bold > italic > autolink.
  let out = escapeHtml(s);

  // Inline `code`.
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);

  // Links [text](url) — url must pass scheme check after escapeHtml.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (raw, text, url) => {
    const decoded = url.replace(/&amp;/g, "&");
    if (!SAFE_LINK_SCHEMES.test(decoded)) return raw;
    return `<a href="${escapeHtmlAttr(decoded)}">${text}</a>`;
  });

  // Autolink bare https?:// urls (only when not inside an existing tag).
  out = out.replace(/(?<![">\/])\b(https?:\/\/[^\s<]+)/g, (url) => `<a href="${escapeHtmlAttr(url)}">${url}</a>`);

  // **bold** and *italic*. Bold first so ** isn't eaten by single-*.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");

  return out;
}
