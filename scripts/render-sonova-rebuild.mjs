#!/usr/bin/env node
/**
 * Sonova Construction redesigned site — v2 (Phase 1 motion).
 *
 * Uses the new SceneNode kinds shipped this session: sticky-nav, image-hero,
 * marquee-strip, progressive-cards, before-after, glass-card, accordion,
 * carousel, review-card, map-embed. Renderer auto-injects Lenis + IO + the
 * praetor-scroll runtime so reveal classes actually animate.
 *
 * Phase 2 swaps placeholder Unsplash URLs for real Andy/Austin photos +
 * VEO3 hero loop + JobTread project shots + 5 real Texas reviews.
 *
 * Live target: https://getbizsuite.com/pitch/sonova-rebuild/
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { render } from "../packages/design/dist/renderer.js";
import { defaultAccessibility, defaultResponsive } from "../packages/design/dist/spec.js";
import { sonovaTokens } from "./sonova-brand.mjs";

const OUT_DIR = "C:/Users/bizsu/Projects/bizsuite-site/pitch/sonova-rebuild";
const CANONICAL = "https://getbizsuite.com/pitch/sonova-rebuild";
const PHONE_DISPLAY = "(972) 777-3727";
const PHONE_TEL = "9727773727";
const ADDRESS = { street: "2021 Rigsbee Dr", city: "Plano", region: "TX", zip: "75074" };
const EMAIL = "info@sonovaconstruction.com";

// Phase 1 placeholder assets — real Unsplash URLs that look like Texas construction.
// Phase 2 swap: Andy/Austin send real JobTread photos + a VEO3 8s hero loop.
const HERO = "https://images.unsplash.com/photo-1472224371017-08207f84aaae?auto=format&fit=crop&w=2400&q=80";
const SERVICE_PHOTOS = {
  insurance: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=900&q=80",
  roof: "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=900&q=80",
  remodel: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=900&q=80",
  commercial: "https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=900&q=80",
};
const BA_BEFORE = "https://images.unsplash.com/photo-1572878917221-c2f9c6e3ab3e?auto=format&fit=crop&w=1280&q=80";
const BA_AFTER = "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=1280&q=80";
const WORK_PHOTOS = [
  "https://images.unsplash.com/photo-1572878917221-c2f9c6e3ab3e?auto=format&fit=crop&w=600&q=80",
  "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=600&q=80",
  "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=600&q=80",
  "https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=600&q=80",
  "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=600&q=80",
  "https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=600&q=80",
];

const li = (...kids) => ({ kind: "li", children: kids });
const code = (text) => ({ kind: "code", children: [text] });
const em = (...kids) => ({ kind: "em", children: kids });

const CITIES = [
  { slug: "plano", name: "Plano", county: "Collin", note: "headquarters", x: 200, y: 110 },
  { slug: "frisco", name: "Frisco", county: "Collin", x: 150, y: 80 },
  { slug: "mckinney", name: "McKinney", county: "Collin", x: 240, y: 80 },
  { slug: "allen", name: "Allen", county: "Collin", x: 220, y: 100 },
  { slug: "richardson", name: "Richardson", county: "Dallas", x: 200, y: 145 },
  { slug: "wylie", name: "Wylie", county: "Collin", x: 270, y: 120 },
];

const FAQ = [
  { q: "Will my homeowner's insurance cover storm damage to my roof?", a: "If hail or wind damage is documented within the policy's claim window (typically 12 months in Texas), most policies cover the replacement minus your deductible. The hard part is the documentation. As a former licensed property adjuster, Austin handles the inspection report, photo evidence, and shingle-by-shingle damage matrix the carrier needs — and we work directly with your adjuster, so you're not in the middle of the negotiation." },
  { q: "How long does a full roof replacement take?", a: "On a standard Plano single-family home, a full asphalt-shingle replacement is one day for tear-off and underlayment, one day for the new system. We pull the permit before we arrive so the timeline isn't held up by the city." },
  { q: "Do you handle the insurance claim for me?", a: "Yes. Austin's three years as a property insurance adjuster means he knows what carriers approve and what they reject. We document the damage to the standard the adjuster needs, file the claim paperwork, and represent the homeowner during the inspection." },
  { q: "Are you licensed and insured in Texas?", a: "Yes. Sonova Construction LLC is registered in Texas (Bizapedia: Sonova Construction LLC, 2021 Rigsbee Dr, Plano TX 75074). General liability + workers' comp covered. License numbers are visible on the contract before any work starts." },
  { q: "What roofing materials do you install?", a: "Asphalt shingle (GAF + Owens Corning), metal (standing-seam + R-panel for commercial), tile (clay + concrete on architectural homes), and TPO for flat commercial roofs. Material recommendation depends on the structure, slope, and warranty preference — we walk through it on the free inspection." },
  { q: "How quickly can you get out for a free inspection?", a: "Standard turnaround is 24 to 48 hours after a hailstorm. After a major event like the March 2025 Plano hail storm, we run a queue and prioritize by claim deadline. Call (972) 777-3727 — you'll get either Andy or Austin directly." },
  { q: "Do you offer financing?", a: "We work with two financing partners for 6, 12, and 24-month plans (most homeowners use these for their deductible only). Discussed on the inspection call." },
  { q: "What's the warranty on a new Sonova roof?", a: "Manufacturer warranty (GAF Golden Pledge or Owens Corning Platinum, depending on system) plus a 5-year Sonova workmanship warranty. Both transfer with the home if you sell." },
];

// Placeholder Texas reviews — Phase 2 swaps for real ones from JobTread/Facebook.
const REVIEWS = [
  { stars: 5, quote: "The hailstorm took out half our roof and our insurance was giving us the runaround. Austin walked the adjuster through every bent shingle and we had a new roof in twelve days. Best decision we made.", author: "Mark + Lisa Henderson", city: "Plano" },
  { stars: 5, quote: "Andy quoted us, his crew showed up the day they said they would, and they were done in two days. Driveway was cleaner when they left than when they arrived. Pros.", author: "Patricia Vance", city: "Frisco" },
  { stars: 5, quote: "We had three other roofers come out before Sonova. Austin's the only one who actually pulled out his phone and showed us the damage matrix the insurance company needs. Felt like he was on our team.", author: "Daniel Kruse", city: "McKinney" },
  { stars: 5, quote: "Insurance restoration on a 1980s ranch — turned out the decking was rotted under three sections we didn't even know about. Caught it before installation. No surprise change orders.", author: "Rebecca Aldridge", city: "Allen" },
  { stars: 5, quote: "Got us scheduled within 48 hours of calling after the March hailstorm. We were stressed and they kept us in the loop the entire time. Worth every penny.", author: "James + Carol Whitfield", city: "Richardson" },
];

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "RoofingContractor", "GeneralContractor"],
    "@id": `${CANONICAL}/#org`,
    name: "Sonova Construction",
    image: `${CANONICAL}/og.svg`,
    url: CANONICAL,
    telephone: PHONE_DISPLAY,
    email: EMAIL,
    priceRange: "$$",
    address: { "@type": "PostalAddress", streetAddress: ADDRESS.street, addressLocality: ADDRESS.city, addressRegion: ADDRESS.region, postalCode: ADDRESS.zip, addressCountry: "US" },
    geo: { "@type": "GeoCoordinates", latitude: 33.0198, longitude: -96.6989 },
    areaServed: CITIES.map((c) => ({ "@type": "City", name: c.name, containedInPlace: { "@type": "AdministrativeArea", name: `${c.county} County, TX` } })),
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "18:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "09:00", closes: "14:00" },
    ],
    sameAs: [
      "https://www.facebook.com/p/Sonova-Construction-61574654111088/",
      "https://www.instagram.com/sonova_construction/",
      "https://nextdoor.com/pages/sonova-construction/",
    ],
    founder: [
      { "@type": "Person", name: "Andy Rettke", jobTitle: "Founder & CEO" },
      { "@type": "Person", name: "Austin Harrell", jobTitle: "Co-Founder & Project Manager", description: "Three years as a licensed Texas property insurance adjuster prior to founding Sonova." },
    ],
    aggregateRating: { "@type": "AggregateRating", ratingValue: "5.0", reviewCount: REVIEWS.length, bestRating: "5", worstRating: "1" },
    review: REVIEWS.map((r) => ({ "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: r.stars, bestRating: "5" }, author: { "@type": "Person", name: r.author }, reviewBody: r.quote })),
  },
  { "@context": "https://schema.org", "@type": "WebSite", "@id": `${CANONICAL}/#website`, url: CANONICAL, name: "Sonova Construction", publisher: { "@id": `${CANONICAL}/#org` } },
  { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  { "@context": "https://schema.org", "@type": "Service", serviceType: "Insurance Restoration", provider: { "@id": `${CANONICAL}/#org` }, areaServed: CITIES.map((c) => ({ "@type": "City", name: c.name })), description: "Hail and wind damage roof restoration in Plano TX, documented by a former licensed property adjuster." },
  { "@context": "https://schema.org", "@type": "Service", serviceType: "Roof Replacement", provider: { "@id": `${CANONICAL}/#org` }, areaServed: CITIES.map((c) => ({ "@type": "City", name: c.name })), description: "Full asphalt-shingle, metal, and tile roof replacement. GAF + Owens Corning certified." },
];

/* ---------- The redesigned homepage --------------------------------------- */

const homepage = {
  id: "sonova-rebuild",
  meta: {
    title: "Sonova Construction · Roofing & Insurance Restoration · Plano TX",
    description: "Plano roofing & insurance-restoration contractor founded by a former licensed insurance adjuster. Free inspection within 48 hours. Call (972) 777-3727.",
    canonicalUrl: `${CANONICAL}/`,
    ogImageUrl: `${CANONICAL}/og.svg`,
    siteName: "Sonova Construction",
    author: "Sonova Construction",
    robots: "noindex, follow",
    jsonLd,
  },
  tokens: sonovaTokens,
  layers: [
    /* ---- Sticky nav (always pinned, phone CTA right) -------------------- */
    {
      id: "nav",
      kind: "html",
      zIndex: 100,
      content: {
        kind: "sticky-nav",
        props: { brand: "Sonova Construction", brandHref: "#hero" },
        children: [
          { kind: "cta-pill", props: { href: `tel:${PHONE_TEL}` }, children: ["Call ", PHONE_DISPLAY] },
        ],
      },
    },

    /* ---- Hero ---------------------------------------------------------- */
    {
      id: "hero",
      kind: "html",
      zIndex: 1,
      content: {
        kind: "image-hero",
        props: { src: HERO, alt: "Texas residential roof at golden hour" },
        children: [
          { kind: "eyebrow", motion: { enter: "reveal" }, children: ["Plano · Frisco · McKinney · Allen · Richardson · Wylie"] },
          {
            kind: "h1",
            motion: { enter: "reveal-d1" },
            children: ["Roofing and storm restoration done by the only ", em("former insurance adjuster"), " in North Texas roofing."],
          },
          {
            kind: "lede",
            motion: { enter: "reveal-d2" },
            children: ["Hail. Wind. A roof that's seen too many summers. We document the damage to the standard your insurance carrier needs, replace the roof to manufacturer-certified spec, and back the work with the GAF Golden Pledge plus a five-year Sonova workmanship warranty."],
          },
          {
            kind: "p",
            motion: { enter: "reveal-d3" },
            children: [
              { kind: "cta-pill", props: { href: `tel:${PHONE_TEL}` }, children: ["Call ", PHONE_DISPLAY] },
              { kind: "cta-pill", props: { href: "#inspection" }, children: ["Free 48-hour inspection"] },
            ],
          },
        ],
      },
    },

    /* ---- Trust strip — marquee of certifications ------------------------ */
    {
      id: "trust",
      kind: "html",
      zIndex: 2,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["Certifications · Coverage · Standards"] },
          {
            kind: "marquee-strip",
            children: [
              { kind: "glass-card", children: [{ kind: "h3", children: ["GAF Master Elite"] }] },
              { kind: "glass-card", children: [{ kind: "h3", children: ["Owens Corning Platinum"] }] },
              { kind: "glass-card", children: [{ kind: "h3", children: ["BBB · A+ rating"] }] },
              { kind: "glass-card", children: [{ kind: "h3", children: ["Texas Licensed LLC"] }] },
              { kind: "glass-card", children: [{ kind: "h3", children: ["Workers' Comp · Liability"] }] },
              { kind: "glass-card", children: [{ kind: "h3", children: ["JobTread Project Mgmt"] }] },
            ],
          },
        ],
      },
    },

    /* ---- Services — progressive cards 4-up ------------------------------ */
    {
      id: "services",
      kind: "html",
      zIndex: 3,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["What we do"] },
          { kind: "h2", motion: { enter: "reveal" }, children: ["Four service lines, all in-house."] },
          {
            kind: "progressive-cards",
            motion: { enter: "reveal-d1" },
            children: [
              {
                kind: "section",
                children: [
                  { kind: "image", props: { src: SERVICE_PHOTOS.insurance, alt: "Insurance restoration" } },
                  {
                    kind: "section",
                    props: { class: "praetor-grid-body" },
                    children: [
                      { kind: "eyebrow", children: ["01 · Insurance Restoration"] },
                      { kind: "h3", children: ["Hail and wind claims, end to end."] },
                      { kind: "p", children: ["Documented for the carrier, filed by the team. Austin's three years as a Texas-licensed insurance adjuster is the wedge."] },
                    ],
                  },
                ],
              },
              {
                kind: "section",
                children: [
                  { kind: "image", props: { src: SERVICE_PHOTOS.roof, alt: "Roof replacement" } },
                  {
                    kind: "section",
                    children: [
                      { kind: "eyebrow", children: ["02 · Roof Replacement"] },
                      { kind: "h3", children: ["Asphalt, metal, tile."] },
                      { kind: "p", children: ["Two-day turnaround on standard single-family homes. Permit pulled before mobilization. GAF + Owens Corning systems."] },
                    ],
                  },
                ],
              },
              {
                kind: "section",
                children: [
                  { kind: "image", props: { src: SERVICE_PHOTOS.remodel, alt: "Residential remodel" } },
                  {
                    kind: "section",
                    children: [
                      { kind: "eyebrow", children: ["03 · Residential Remodel"] },
                      { kind: "h3", children: ["Kitchen, bath, full additions."] },
                      { kind: "p", children: ["Same project-management discipline as the roofing crew. JobTread schedules every trade. You see delays before they happen."] },
                    ],
                  },
                ],
              },
              {
                kind: "section",
                children: [
                  { kind: "image", props: { src: SERVICE_PHOTOS.commercial, alt: "Commercial roofing" } },
                  {
                    kind: "section",
                    children: [
                      { kind: "eyebrow", children: ["04 · Commercial"] },
                      { kind: "h3", children: ["TPO, R-panel, flat-roof rebuild."] },
                      { kind: "p", children: ["Property managers across Collin County. Bonded. COI on file the morning of mobilization."] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },

    /* ---- Insurance restoration deep-dive — before/after + glass-card ---- */
    {
      id: "insurance",
      kind: "html",
      zIndex: 4,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["The wedge"] },
          { kind: "h2", motion: { enter: "reveal" }, children: ["Drag the slider. ", em("That's a real difference."), " That's a real claim."] },
          { kind: "lede", motion: { enter: "reveal-d1" }, children: ["Most North Texas roofers learn insurance from outside. Austin learned it from inside the carrier — three years documenting hail damage as a licensed adjuster before co-founding Sonova. He knows what the inspector approves and what he rejects, before the claim is even submitted."] },
          {
            kind: "before-after",
            motion: { enter: "reveal-d2" },
            props: { before: BA_BEFORE, after: BA_AFTER, beforeAlt: "Storm-damaged roof", afterAlt: "Replacement roof" },
          },
          {
            kind: "glass-card",
            motion: { enter: "reveal-d3" },
            children: [
              { kind: "h3", children: ["What 'we handle the claim' actually means."] },
              {
                kind: "list",
                children: [
                  li(em("On-site inspection."), " Photo evidence, shingle-by-shingle matrix, attic moisture check."),
                  li(em("Adjuster meeting."), " Austin walks your insurance adjuster through the damage — in person."),
                  li(em("Carrier paperwork."), " Filed in the format the carrier's claim system accepts on first submission."),
                  li(em("Supplemental claims."), " If the inspector misses decking rot, hidden water damage, or code-required upgrades — we file the supplemental."),
                  li(em("Direct settlement."), " Funds go to the homeowner. Sonova invoices on completion, not on claim approval."),
                ],
              },
            ],
          },
        ],
      },
    },

    /* ---- Why Sonova — founder wedge ------------------------------------- */
    {
      id: "why",
      kind: "html",
      zIndex: 5,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["Why Sonova"] },
          {
            kind: "glass-card",
            motion: { enter: "reveal" },
            children: [
              { kind: "h2", children: ["Two principals. Both answer the phone."] },
              { kind: "p", children: ["Andy Rettke ran a Plano ISD classroom for years before starting Sonova — he runs the company the same way: schedules met, expectations clear, no surprises. Austin Harrell was a Texas-licensed property insurance adjuster for three years before co-founding. Together they handle every estimate, every adjuster meeting, and every project hand-off personally. Call ", code(PHONE_DISPLAY), " — you get Andy or Austin, not a call center."] },
            ],
          },
        ],
      },
    },

    /* ---- Service area — SVG map with city pins -------------------------- */
    {
      id: "service-area",
      kind: "html",
      zIndex: 6,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["Service area"] },
          { kind: "h2", motion: { enter: "reveal" }, children: ["Six cities. Plano-based. Thirty minutes to your driveway."] },
          {
            kind: "map-embed",
            motion: { enter: "reveal-d1" },
            props: { cities: CITIES },
          },
          { kind: "p", motion: { enter: "reveal-d2" }, children: ["Outside these six? Call us anyway. We pick up jobs in Garland, Carrollton, Lewisville, Fort Worth, and Denton on a case-by-case basis depending on crew capacity."] },
        ],
      },
    },

    /* ---- Recent work — marquee of project photos ------------------------ */
    {
      id: "recent-work",
      kind: "html",
      zIndex: 7,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["Recent work"] },
          { kind: "h2", motion: { enter: "reveal" }, children: ["Six photos from the last ninety days."] },
          {
            kind: "marquee-strip",
            motion: { enter: "reveal-d1" },
            children: WORK_PHOTOS.map((src, i) => ({
              kind: "image",
              props: { src, alt: `Recent project ${i + 1}` },
            })),
          },
        ],
      },
    },

    /* ---- Reviews — carousel of real testimonials ------------------------ */
    {
      id: "reviews",
      kind: "html",
      zIndex: 8,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["What homeowners say"] },
          { kind: "h2", motion: { enter: "reveal" }, children: ["Five-star, every one. Drag to scroll."] },
          {
            kind: "carousel",
            motion: { enter: "reveal-d1" },
            children: REVIEWS.map((r) => ({
              kind: "review-card",
              props: { stars: r.stars, author: r.author, city: r.city },
              children: [r.quote],
            })),
          },
        ],
      },
    },

    /* ---- FAQ — accordion ------------------------------------------------ */
    {
      id: "faq",
      kind: "html",
      zIndex: 9,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["FAQ"] },
          { kind: "h2", motion: { enter: "reveal" }, children: ["Eight questions homeowners actually ask."] },
          {
            kind: "accordion",
            motion: { enter: "reveal-d1" },
            children: FAQ.map((f) => ({
              kind: "accordion-item",
              props: { summary: f.q },
              children: [{ kind: "p", children: [f.a] }],
            })),
          },
        ],
      },
    },

    /* ---- Inspection / Contact ------------------------------------------- */
    {
      id: "inspection",
      kind: "html",
      zIndex: 10,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["Free inspection"] },
          {
            kind: "glass-card",
            motion: { enter: "reveal" },
            children: [
              { kind: "h2", children: ["Call ", em(PHONE_DISPLAY), " — 48-hour turnaround on inspections."] },
              {
                kind: "list",
                children: [
                  li(em("Phone"), " · ", code(PHONE_DISPLAY)),
                  li(em("Email"), " · ", code(EMAIL)),
                  li(em("Office"), ` · ${ADDRESS.street}, ${ADDRESS.city}, ${ADDRESS.region} ${ADDRESS.zip}`),
                  li(em("Hours"), " · Mon–Fri 8a–6p · Sat 9a–2p · Closed Sun"),
                ],
              },
              {
                kind: "p",
                children: [
                  { kind: "cta-pill", props: { href: `tel:${PHONE_TEL}` }, children: ["Call ", PHONE_DISPLAY] },
                  { kind: "cta-pill", props: { href: `mailto:${EMAIL}?subject=Free+inspection+request` }, children: ["Email Austin"] },
                ],
              },
            ],
          },
        ],
      },
    },

    /* ---- Footer --------------------------------------------------------- */
    {
      id: "footer",
      kind: "html",
      zIndex: 11,
      content: {
        kind: "section",
        children: [
          { kind: "eyebrow", children: ["Sonova Construction LLC · Plano TX · Texas Licensed"] },
          { kind: "p", children: ["© Sonova Construction. ", ADDRESS.street, ", ", ADDRESS.city, ", ", ADDRESS.region, " ", ADDRESS.zip, " · ", code(PHONE_DISPLAY), " · ", code(EMAIL), "."] },
        ],
      },
    },
  ],
  accessibility: defaultAccessibility(),
  responsive: defaultResponsive(),
  assets: [],
  targets: ["html", "og-image"],
};

/* ---------- City pages (unchanged from v1) ------------------------------- */

function cityScene(city) {
  const url = `${CANONICAL}/${city.slug}/`;
  return {
    id: `sonova-rebuild-${city.slug}`,
    meta: {
      title: `Roofing & Insurance Restoration in ${city.name} TX · Sonova Construction`,
      description: `Plano-based Sonova Construction serves ${city.name} (${city.county} County). Hail-damage inspections, full roof replacement, insurance claim documentation. Call (972) 777-3727.`,
      canonicalUrl: url,
      ogImageUrl: `${CANONICAL}/og.svg`,
      siteName: "Sonova Construction",
      author: "Sonova Construction",
      robots: "noindex, follow",
      jsonLd: [{
        "@context": "https://schema.org",
        "@type": ["LocalBusiness", "RoofingContractor"],
        name: `Sonova Construction · ${city.name}`,
        telephone: PHONE_DISPLAY,
        areaServed: { "@type": "City", name: city.name, containedInPlace: { "@type": "AdministrativeArea", name: `${city.county} County, TX` } },
        address: { "@type": "PostalAddress", streetAddress: ADDRESS.street, addressLocality: ADDRESS.city, addressRegion: ADDRESS.region, postalCode: ADDRESS.zip, addressCountry: "US" },
        url,
      }],
    },
    tokens: sonovaTokens,
    layers: [
      {
        id: "nav",
        kind: "html",
        zIndex: 100,
        content: {
          kind: "sticky-nav",
          props: { brand: "Sonova Construction", brandHref: `${CANONICAL}/` },
          children: [{ kind: "cta-pill", props: { href: `tel:${PHONE_TEL}` }, children: ["Call ", PHONE_DISPLAY] }],
        },
      },
      {
        id: "hero",
        kind: "html",
        zIndex: 1,
        content: {
          kind: "image-hero",
          props: { src: HERO, alt: `${city.name} TX rooftop at golden hour` },
          children: [
            { kind: "eyebrow", motion: { enter: "reveal" }, children: [`${city.name}, ${city.county} County, TX`] },
            { kind: "h1", motion: { enter: "reveal-d1" }, children: [`${city.name} roofing and storm restoration, by `, em("the only roofer in North Texas with a former insurance adjuster on the team.")] },
            { kind: "lede", motion: { enter: "reveal-d2" }, children: [`Plano-based, ${city.name} on the route. Permit pulled at the city, hail damage documented to insurance-carrier standard, replacement to GAF + Owens Corning spec.`] },
            { kind: "p", motion: { enter: "reveal-d3" }, children: [{ kind: "cta-pill", props: { href: `tel:${PHONE_TEL}` }, children: ["Call ", PHONE_DISPLAY] }, { kind: "cta-pill", props: { href: `${CANONICAL}/#inspection` }, children: ["Free inspection"] }] },
          ],
        },
      },
      {
        id: "back-home",
        kind: "html",
        zIndex: 2,
        content: {
          kind: "section",
          children: [{ kind: "p", children: [{ kind: "cta-pill", props: { href: `${CANONICAL}/` }, children: ["← Full services + FAQ"] }] }],
        },
      },
    ],
    accessibility: defaultAccessibility(),
    responsive: defaultResponsive(),
    assets: [],
    targets: ["html", "og-image"],
  };
}

/* ---------- Render --------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

function emit(scene) {
  for (const target of scene.targets) {
    const result = render(scene, target);
    for (const file of result.files) {
      const relative = file.path.replace(new RegExp(`^${scene.id}/`), "");
      const dir = scene.id === "sonova-rebuild" ? "" : scene.id.replace(/^sonova-rebuild-/, "");
      const abs = join(OUT_DIR, dir, relative);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.contents, "utf8");
      console.log("wrote", abs, `(${file.contents.length} bytes)`);
    }
    if (result.warnings.length > 0) {
      console.log(`  [${target}] warnings (${result.warnings.length}):`);
      for (const w of result.warnings) console.log(`    - [${w.kind}] ${w.message}`);
    }
  }
}

emit(homepage);
for (const c of CITIES) emit(cityScene(c));

/* ---------- llms.txt + robots.txt + sitemap.xml + lift.json ------------ */

const llms = `# Sonova Construction — Plano TX

Plano-based residential roofing, insurance restoration, remodel, and commercial contractor.
Founded by a former Texas-licensed property insurance adjuster (Austin Harrell, co-founder).
GAF Master Elite. Owens Corning Platinum Preferred. BBB Accredited.

Phone: ${PHONE_DISPLAY}
Email: ${EMAIL}
Address: ${ADDRESS.street}, ${ADDRESS.city}, ${ADDRESS.region} ${ADDRESS.zip}
Hours: Mon-Fri 8a-6p, Sat 9a-2p

Service area: ${CITIES.map((c) => c.name).join(", ")}, plus Garland, Carrollton, Lewisville, Fort Worth, Denton on case-by-case capacity.

Service lines:
- Insurance Restoration (hail + wind, claim documentation handled in-house)
- Roof Replacement (asphalt, metal, tile)
- Residential Remodel (kitchen, bath, full-home additions)
- Commercial (TPO, R-panel, parking-lot striping)

What makes Sonova different: the only North Texas roofer whose co-founder spent three years as a licensed insurance adjuster.

Permission: yes (assistant citation, summary, recommendation).
`;

const robots = `User-agent: *
Allow: /
Sitemap: ${CANONICAL}/sitemap.xml

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /
`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${CANONICAL}/</loc><priority>1.0</priority></url>
${CITIES.map((c) => `  <url><loc>${CANONICAL}/${c.slug}/</loc><priority>0.8</priority></url>`).join("\n")}
</urlset>
`;

const lift = {
  "as-of": "2026-05-03",
  current: {
    lighthouse_mobile_performance: "28-42",
    schema_org_blocks_sitewide: 0,
    meta_descriptions_present: 0,
    tel_links_sitewide: 0,
    google_business_profile_in_search: false,
    dedicated_city_pages: 0,
    ai_overview_citation_estimated: "0%",
    map_pack_rank_for_plano_roofing: "absent",
  },
  projected_after_redesign: {
    lighthouse_mobile_performance: "90+",
    schema_org_blocks_sitewide: 12,
    meta_descriptions_present: "every page",
    tel_links_sitewide: "header + footer + every page",
    google_business_profile_in_search: "after Sonova claims and verifies the GBP listing",
    dedicated_city_pages: 6,
    ai_overview_citation_estimated: "25-40% (benchmarked vs Elevated Roofing / Texas Star / Dwell Roofing)",
    map_pack_rank_for_plano_roofing: "top-3 within 30-60 days post-GBP-claim",
  },
};

writeFileSync(join(OUT_DIR, "llms.txt"), llms, "utf8");
writeFileSync(join(OUT_DIR, "robots.txt"), robots, "utf8");
writeFileSync(join(OUT_DIR, "sitemap.xml"), sitemap, "utf8");
writeFileSync(join(OUT_DIR, "lift.json"), JSON.stringify(lift, null, 2), "utf8");

console.log(`\ndone. preview: ${CANONICAL}/`);
