/**
 * PraetorVisualQA — diagnostic suite that runs against rendered output.
 *
 * Catches the regressions DESIGN.md §10 forbids:
 *   1. Voice violations (forbidden phrases)
 *   2. Ease-curve violations (any non-Praetor curve)
 *   3. Forbidden CSS frameworks (Tailwind utility classes, shadcn primitives)
 *   4. Forbidden font stacks (Roboto / Open Sans / system-ui-only)
 *   5. Square buttons (border-radius < pill threshold on a button)
 *   6. Missing reduced-motion override
 *   7. Light theme leaks (white/light surfaces in body CSS)
 *
 * Renderers and CI both call `audit(html)` and fail if any `severity:"fatal"`
 * finding is present.
 */

import { lintEase, lintVoice, type PraetorTokens, tokens as defaultTokens } from "./tokens.js";

export interface QaFinding {
  rule: string;
  severity: "fatal" | "warn" | "info";
  message: string;
  excerpt?: string;
}

export interface QaInput {
  /** Rendered HTML (or markdown / email-html / og-svg). */
  body: string;
  /** Token tree the renderer used. */
  tokens?: PraetorTokens;
  /** Source kind — affects which rules run. */
  kind: "html" | "markdown" | "email-html" | "og-svg" | "css";
}

export function audit(input: QaInput): QaFinding[] {
  const t = input.tokens ?? defaultTokens;
  const findings: QaFinding[] = [];

  // 1 — voice
  for (const phrase of lintVoice(input.body, t)) {
    findings.push({
      rule: "voice",
      severity: "fatal",
      message: `forbidden phrase per DESIGN.md §9: "${phrase}"`,
      excerpt: extractContext(input.body, phrase),
    });
  }

  // 2 — ease (skip on markdown / og-svg — no CSS in body)
  if (input.kind === "html" || input.kind === "email-html" || input.kind === "css") {
    for (const hit of lintEase(input.body)) {
      findings.push({
        rule: "ease",
        severity: "fatal",
        message: `non-Praetor ease curve. only var(--ease) or cubic-bezier(0.22, 1, 0.36, 1) allowed.`,
        excerpt: hit,
      });
    }
  }

  // 3 — forbidden frameworks
  if (input.kind === "html" || input.kind === "email-html" || input.kind === "css") {
    const tailwindUtility = /\bclass="[^"]*\b(?:flex|grid|p-\d|m-\d|text-(?:xs|sm|lg|xl|\dxl)|bg-(?:white|black|gray|slate|zinc|neutral)-\d|rounded-(?:sm|md|lg|xl|\dxl)|shadow-(?:sm|md|lg|xl)|space-[xy]-\d)\b/;
    if (tailwindUtility.test(input.body)) {
      findings.push({
        rule: "no-tailwind",
        severity: "fatal",
        message: "Tailwind utility classes detected. Praetor does not use Tailwind. Use PraetorTokens via tokensToCssVariables() and component classes.",
      });
    }
    const shadcnHints = /(?:data-(?:radix|state|orientation|side)=|@radix-ui|class-variance-authority|tailwind-merge|cn\(\s*['"`])/;
    if (shadcnHints.test(input.body)) {
      findings.push({
        rule: "no-shadcn",
        severity: "fatal",
        message: "shadcn/Radix primitives detected. Praetor builds components natively against PraetorTokens.",
      });
    }
  }

  // 4 — forbidden fonts (DESIGN.md §10.3)
  if (input.kind === "html" || input.kind === "email-html" || input.kind === "css") {
    const banned = ["Roboto", "Open Sans", "Lato", "Noto Sans"];
    for (const f of banned) {
      const re = new RegExp("font-family[^;]*['\"]" + f + "['\"]", "i");
      if (re.test(input.body)) {
        findings.push({
          rule: "no-roboto",
          severity: "fatal",
          message: `forbidden font "${f}" — DESIGN.md §10.3 mandates Inter / Source Serif 4 / JetBrains Mono only.`,
        });
      }
    }
    if (/font-family\s*:\s*(?:system-ui|sans-serif)\s*[;}]/i.test(input.body)) {
      findings.push({
        rule: "no-system-ui-only",
        severity: "warn",
        message: "system-ui or bare sans-serif as the only font — DESIGN.md mandates Inter Variable first.",
      });
    }
  }

  // 5 — square buttons
  if (input.kind === "html" || input.kind === "email-html" || input.kind === "css") {
    const buttonSquare = /button[^{}]*{[^}]*border-radius\s*:\s*(0|[1-7])(px)?\s*[;}]/i;
    if (buttonSquare.test(input.body)) {
      findings.push({
        rule: "pills-only",
        severity: "fatal",
        message: "square button detected. DESIGN.md §6 mandates pills only (border-radius: 999px or 9999px).",
      });
    }
  }

  // 6 — reduced motion compliance
  if (input.kind === "html" || input.kind === "css") {
    if (/transition\s*:/.test(input.body) && !/prefers-reduced-motion/.test(input.body)) {
      findings.push({
        rule: "reduced-motion",
        severity: "fatal",
        message: "transitions defined without a `@media (prefers-reduced-motion: reduce)` override. DESIGN.md §10.1 mandates honoring it.",
      });
    }
  }

  // 7 — light theme leak
  if (input.kind === "html" || input.kind === "css") {
    if (/background\s*:\s*(?:#fff|#ffffff|white)\s*[;}]/i.test(input.body)) {
      findings.push({
        rule: "dark-only",
        severity: "fatal",
        message: "light surface detected (background: white). DESIGN.md §10.4: dark palette only.",
      });
    }
  }

  return findings;
}

/** Convenience helper — returns true if no fatal findings. */
export function passes(input: QaInput): boolean {
  return audit(input).every((f) => f.severity !== "fatal");
}

/** Pretty-print findings as a single string for log output. */
export function formatFindings(findings: QaFinding[]): string {
  if (findings.length === 0) return "praetor visual-qa: clean";
  const lines = [`praetor visual-qa: ${findings.length} finding(s)`];
  for (const f of findings) {
    lines.push(`  [${f.severity}] ${f.rule}: ${f.message}`);
    if (f.excerpt) lines.push(`        ${f.excerpt.slice(0, 160)}`);
  }
  return lines.join("\n");
}

function extractContext(body: string, phrase: string): string {
  const i = body.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) return phrase;
  const start = Math.max(0, i - 24);
  const end = Math.min(body.length, i + phrase.length + 24);
  return body.slice(start, end);
}
