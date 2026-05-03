#!/usr/bin/env node
/**
 * Render the Sonova Construction pitch site via PraetorRenderer.
 *
 * First real-world charter rendered through @praetor/design.
 * Output: bizsuite-site/pitch/sonova/index.html (+ og.svg + email.html).
 * Deploy: bizsuite-site Fly machine (express.static auto-serves).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { tokens } from "../packages/design/dist/tokens.js";
import { render } from "../packages/design/dist/renderer.js";
import { defaultAccessibility, defaultResponsive } from "../packages/design/dist/spec.js";

const OUT_DIR = "C:/Users/bizsu/Projects/bizsuite-site/pitch/sonova";
const CANONICAL = "https://getbizsuite.com/pitch/sonova/";
const PHONE = "972-777-3727";
const EMAIL = "jeremiah@getbizsuite.com";
const CAL = "https://cal.com/getbizsuite";

const li = (...kids) => ({ kind: "li", children: kids });
const code = (text) => ({ kind: "code", children: [text] });

const meta = {
  title: "Sonova Construction · website audit + redesign · BizSuite",
  description:
    "A live alternate version of sonovaconstruction.com built for Austin Harrell. Five concrete findings from sonovaconstruction.com plus the redesign moves that fix them.",
  canonicalUrl: CANONICAL,
  ogImageUrl: `${CANONICAL}og.svg`,
  siteName: "BizSuite",
  author: "Jeremiah Omiagbo",
  robots: "noindex, follow",
  jsonLd: [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Sonova Construction · website audit + redesign",
      description:
        "Pitch artifact for Austin Harrell. Five SEO/GEO/perf findings on sonovaconstruction.com.",
      url: CANONICAL,
      author: { "@type": "Person", name: "Jeremiah Omiagbo", email: EMAIL },
      publisher: { "@type": "Organization", name: "BizSuite", url: "https://getbizsuite.com" },
    },
  ],
};

const scene = {
  id: "sonova-pitch",
  meta,
  tokens,
  layers: [
    /* ---------- Hero --------------------------------------------------- */
    {
      id: "hero",
      kind: "html",
      zIndex: 1,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["For Austin Harrell · Sonova Construction · Plano TX"] },
          {
            kind: "h1",
            children: [
              "Plano homeowners search after hailstorms. Right now your site doesn't ",
              { kind: "em", children: ["show up."] },
            ],
          },
          {
            kind: "lede",
            children: [
              "Jeremiah from the Lyft last night. Took an hour with sonovaconstruction.com this morning. Here's what I found, and here's what we'd build instead. No upsell pop-ups, no retargeting pixels, no follow-up nag. Read the page, then decide.",
            ],
          },
          {
            kind: "p",
            motion: { enter: "reveal-d2" },
            children: [
              { kind: "cta-pill", props: { href: "#findings" }, children: ["See the 5 findings"] },
              { kind: "cta-pill", props: { href: CAL }, children: ["Book the audit · $997"] },
            ],
          },
        ],
      },
    },

    /* ---------- Findings ------------------------------------------------ */
    {
      id: "findings",
      kind: "html",
      zIndex: 2,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["What I found"] },
          {
            kind: "h2",
            children: [
              "Five things — ",
              { kind: "em", children: ["verified."] },
            ],
          },
          { kind: "lede", children: ["Each one is a screenshot you can hand to whoever owns your site. Each fix is hours, not weeks."] },

          {
            kind: "stage-card",
            motion: { enter: "reveal-d1" },
            children: [
              { kind: "eyebrow", children: ["01 · Performance"] },
              { kind: "h2", children: ["Your homepage loads an 11.5 megabyte image."] },
              {
                kind: "p",
                children: [
                  "The file is ", code("Enscape_2025-03-05-13-53-20.png"),
                  " — an uncompressed PNG of a Richardson roof. WebP at quality 80 is about 200 KB. That single swap cuts six to ten seconds off your mobile load time and lifts your Lighthouse score by ~30 points overnight. We currently estimate your mobile Performance score at 28 to 42 out of 100. Top three Plano competitors all score above 80.",
                ],
              },
            ],
          },

          {
            kind: "stage-card",
            motion: { enter: "reveal-d2" },
            children: [
              { kind: "eyebrow", children: ["02 · Conversion"] },
              { kind: "h2", children: ["Your phone number isn't in the header on any page."] },
              {
                kind: "p",
                children: [
                  PHONE, " is plain text on the estimate page only. There are zero ",
                  code("tel:"),
                  " links anywhere on the site. For roofing and restoration, the call is the conversion. Elevated Roofing, Texas Star Roofing, and Dwell Roofing all lead with a tap-to-call phone in the header. You're sending storm-damage callers through a contact form instead — and the contact page itself has no address, no phone, and no map.",
                ],
              },
            ],
          },

          {
            kind: "stage-card",
            motion: { enter: "reveal-d3" },
            children: [
              { kind: "eyebrow", children: ["03 · AI search readiness"] },
              { kind: "h2", children: ["Zero structured data across all eight pages."] },
              {
                kind: "p",
                children: [
                  "No LocalBusiness schema. No Service schema. No FAQPage schema. Worse — your /sonova-faq/ page has zero actual Q&A content, just four section headers. ChatGPT, Perplexity, and Google AI Overviews need entity-rich JSON-LD to cite you. They can't, so they cite Elevated Roofing instead. This is the single biggest reason a homeowner asking 'who handles insurance roof restoration in Plano TX' never sees your name.",
                ],
              },
            ],
          },

          {
            kind: "stage-card",
            motion: { enter: "reveal-d4" },
            children: [
              { kind: "eyebrow", children: ["04 · Local SEO"] },
              { kind: "h2", children: ["No Google Business Profile, no city pages, no real testimonials."] },
              {
                kind: "p",
                children: [
                  "Three searches for your business — none returned a Google Maps listing. You're invisible in the map pack for your own headquarters city. You list 25 cities in body copy with zero dedicated city pages — Google reads that as keyword stuffing, not coverage. And the three testimonials on your homepage are credited to New York, Seattle, and LA — that's stock template content nobody replaced. For a Plano contractor with zero Texas testimonials, that's a credibility leak homeowners notice.",
                ],
              },
            ],
          },

          {
            kind: "stage-card",
            motion: { enter: "reveal-d4" },
            children: [
              { kind: "eyebrow", children: ["05 · Positioning"] },
              { kind: "h2", children: ["Your sharpest wedge is buried two clicks deep."] },
              {
                kind: "p",
                children: [
                  "You spent three years as a licensed property insurance adjuster before co-founding Sonova. That's the exact thing storm-damage homeowners care about — and right now it's hidden on the team page. Your homepage tagline is 'The Last Construction Company You'll Ever Call,' which could belong to any of 8,000 DFW remodelers. Lead with the adjuster background and you're the only roofer in Plano who can claim it.",
                ],
              },
            ],
          },
        ],
      },
    },

    /* ---------- Before / After ----------------------------------------- */
    {
      id: "before-after",
      kind: "html",
      zIndex: 3,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["What we'd build"] },
          {
            kind: "h2",
            children: [
              "Same business, same content. Engineered to ",
              { kind: "em", children: ["actually show up."] },
            ],
          },

          {
            kind: "stage-card",
            children: [
              { kind: "eyebrow", children: ["Before"] },
              {
                kind: "list",
                children: [
                  li("Lighthouse mobile Performance: ~35"),
                  li("11.5 MB image on every homepage visit"),
                  li("0 schema.org markup, 0 meta descriptions"),
                  li("0 dedicated city pages"),
                  li("Phone visible only on /get-a-free-estimate/"),
                  li("Testimonials credited to NY / Seattle / LA"),
                  li("Not in Google Maps for Plano"),
                ],
              },
            ],
          },

          {
            kind: "stage-card",
            children: [
              { kind: "eyebrow", children: ["After"] },
              {
                kind: "list",
                children: [
                  li("Lighthouse mobile Performance: 90+"),
                  li("WebP + AVIF + lazy-load below the fold"),
                  li("LocalBusiness + Service + FAQPage + Review JSON-LD"),
                  li("6 city pages: Plano, Frisco, McKinney, Allen, Richardson, Wylie"),
                  li("Sticky header with tap-to-call + insurance-restoration tag"),
                  li("Real Texas testimonials with first + last + city"),
                  li("Verified GBP with live review badge"),
                ],
              },
            ],
          },
        ],
      },
    },

    /* ---------- Audit offer + CTA -------------------------------------- */
    {
      id: "audit",
      kind: "html",
      zIndex: 4,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["The offer"] },
          { kind: "h2", children: ["$997. Five business days. No subscription, no retainer trap."] },
          {
            kind: "p",
            children: [
              "You get a written audit (every finding above plus the dozen smaller ones), a 30-minute Loom walkthrough you can hand to whoever owns your site, and a one-page action plan ranked by impact. If you want me to actually implement the fixes, that's a separate conversation — Growth tier is $299/month + a $997 setup fee, and after the audit walkthrough it'll be obvious whether that's a fit.",
            ],
          },
          { kind: "p", children: ["If the timing's not right, no follow-up pressure. Reply or don't."] },
          {
            kind: "p",
            children: [
              { kind: "cta-pill", props: { href: CAL }, children: ["Book the audit · cal.com/getbizsuite"] },
            ],
          },
          { kind: "eyebrow", children: ["— jeremiah omiagbo · jeremiah@getbizsuite.com · getbizsuite.com"] },
        ],
      },
    },
  ],
  accessibility: defaultAccessibility(),
  responsive: defaultResponsive(),
  assets: [],
  targets: ["html", "og-image", "email-html"],
};

/* ---------- Render --------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

const html = render(scene, "html");
const og = render(scene, "og-image");
const email = render(scene, "email-html");

for (const result of [html, og, email]) {
  for (const file of result.files) {
    const relative = file.path.replace(/^sonova-pitch\//, "");
    const abs = join(OUT_DIR, relative);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.contents, "utf8");
    console.log("wrote", abs, `(${file.contents.length} bytes)`);
  }
  if (result.warnings.length > 0) {
    console.log(`\n[${result.target}] warnings (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  - [${w.kind}] ${w.message}`);
  }
}

console.log("\ndone.");
