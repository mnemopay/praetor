#!/usr/bin/env node
/**
 * Emit the praetor.mnemopay.com landing — motion-first, self-contained.
 * Output: a single index.html + assets, deployable to Vercel.
 *
 * Sections:
 *   hero (HtmlInCanvas3D — 3 interactive cards in a THREE.js scene)
 *   manifesto (animated reveal)
 *   how-it-works (4-stage scroll-driven diagram)
 *   live-ledger (MnemoPay fiscal gate — animated transaction stream)
 *   code (tabbed install + charter sample)
 *   comparison (vs Agents, Assistants, LangGraph)
 *   cta (run your first charter)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { DesignPack } from "../packages/design/dist/index.js";

const out = resolve(process.argv[2] ?? "./examples-out/praetor-mnemopay-com");
mkdirSync(out, { recursive: true });

const pack = new DesignPack();

const heroCards = [
  {
    id: "charter",
    html: `<h2 style="margin:0 0 8px;font-size:22px;letter-spacing:-0.02em">Charters</h2>
<p style="color:#a5b4fc;font-size:13px;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.08em">Mission YAML</p>
<p style="font-size:14px;line-height:1.55;margin:0 0 14px;color:#cbd5e1">A mission, a budget, a fiscal gate. The runtime spawns an agent under MnemoPay metering and logs every byte.</p>
<a class="cta" href="#charters">Read the spec →</a>`,
  },
  {
    id: "design",
    html: `<h2 style="margin:0 0 8px;font-size:22px;letter-spacing:-0.02em">Design pack</h2>
<p style="color:#fde68a;font-size:13px;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.08em">Native motion</p>
<p style="font-size:14px;line-height:1.55;margin:0 0 14px;color:#cbd5e1">Spline, Hypeframes, Remotion, HTML-in-Canvas-3D, declarative UI. One charter, every surface.</p>
<a class="cta" href="#design">See it move →</a>`,
  },
  {
    id: "fiscal",
    html: `<h2 style="margin:0 0 8px;font-size:22px;letter-spacing:-0.02em">Fiscal gate</h2>
<p style="color:#86efac;font-size:13px;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.08em">MnemoPay metered</p>
<p style="font-size:14px;line-height:1.55;margin:0 0 14px;color:#cbd5e1">Agent FICO 300-850. Stripe + Paystack rails. HITL approval. Merkle audit chain. Article 12 ready.</p>
<a class="cta" href="https://mnemopay.com" style="background:#86efac">Open MnemoPay →</a>`,
  },
];

const heroArt = pack.renderHtmlInCanvas3D({
  title: "Praetor — the mission runtime",
  background: "radial-gradient(1200px 800px at 50% 20%, #1e1b4b 0%, #050510 70%)",
  rings: true,
  faceParallax: false,
  mouseParallax: true,
  dolly: { near: 7, far: 14 },
  cards: heroCards,
});

const heroHtml = heroArt.files.find((f) => f.path === "index.html").contents;
const heroBody = heroHtml.match(/<body>([\s\S]*?)<\/body>/)[1];
const heroHead = heroHtml.match(/<head>([\s\S]*?)<\/head>/)[1];

const landing = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Praetor — the mission runtime, on MnemoPay</title>
<meta name="description" content="Praetor is the mission runtime for autonomous agents. Charter-driven, fiscally gated by MnemoPay, audit-logged by default. Native design, video, scraping, knowledge, GEO/SEO, EU AI Act."/>
<meta property="og:title" content="Praetor — the mission runtime, on MnemoPay"/>
<meta property="og:description" content="Charter-driven autonomous agents. Fiscal gate by MnemoPay. EU AI Act Article 12 audit-ready."/>
<meta property="og:url" content="https://praetor.mnemopay.com"/>
<meta property="og:image" content="https://praetor.mnemopay.com/og.png"/>
<meta name="twitter:card" content="summary_large_image"/>
<link rel="canonical" href="https://praetor.mnemopay.com"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800;900&family=Newsreader:ital,wght@1,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --bg:#050510;--surface:#0b0b18;--surface2:#11112a;--border:#1d1d3a;
    --text:#e8e8f0;--muted:#7d7d9c;--accent:#a5b4fc;--accent2:#fde68a;--accent3:#86efac;
    --serif:"Newsreader",Georgia,serif;--sans:"Inter",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace;
  }
  html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  ::selection{background:var(--accent);color:#0a0a18}
  .wrap{max-width:1180px;margin:0 auto;padding:0 28px}
  .nav{position:fixed;inset:0 0 auto 0;z-index:50;background:rgba(5,5,16,.72);backdrop-filter:blur(14px);border-bottom:1px solid var(--border)}
  .nav .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
  .nav .brand{font-weight:800;letter-spacing:-0.02em}
  .nav .brand .dot{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--accent);margin-right:8px;vertical-align:middle;animation:pulse 2.4s ease-in-out infinite}
  .nav .links a{color:var(--muted);margin-left:24px;font-size:14px}
  .nav .links a:hover{color:var(--text)}
  .nav .cta{background:var(--accent);color:#0a0a18;padding:8px 14px;border-radius:999px;font-size:13px;font-weight:600;margin-left:24px}
  @keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}

  /* Hero — embed the HtmlInCanvas3D scene as a section, not a full-screen takeover */
  .hero{position:relative;height:100vh;min-height:680px;overflow:hidden}
  .hero #stage{position:absolute;inset:0}
  .hero #fallback{position:absolute;inset:auto 0 8% 0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px;padding:48px;pointer-events:auto}
  .hero #fallback.hidden{display:none}
  .hero .card{box-sizing:border-box;width:300px;height:340px;padding:22px;border-radius:18px;background:rgba(15,23,42,.78);backdrop-filter:blur(14px);border:1px solid rgba(165,180,252,.25);box-shadow:0 30px 80px rgba(0,0,0,.55)}
  .hero .card a.cta{display:inline-block;margin-top:10px;padding:9px 16px;border-radius:999px;background:var(--accent);color:#0a0a18;font-weight:600;font-size:13px}
  .hero .heroCopy{position:absolute;top:24%;left:0;right:0;text-align:center;pointer-events:none;padding:0 28px}
  .hero h1{font-family:var(--sans);font-weight:900;font-size:clamp(42px,7vw,88px);letter-spacing:-0.04em;line-height:1.02;margin:0 0 18px}
  .hero h1 em{font-family:var(--serif);font-style:italic;font-weight:500;background:linear-gradient(180deg,#fde68a 0%,#a5b4fc 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero .sub{color:var(--muted);font-size:clamp(15px,1.4vw,18px);max-width:680px;margin:0 auto}
  .hero .gate{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:rgba(134,239,172,.08);border:1px solid rgba(134,239,172,.25);color:#86efac;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:20px}

  /* Sections */
  section.s{padding:140px 0;border-top:1px solid var(--border)}
  .label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:0.16em;font-weight:600;margin-bottom:18px}
  h2.title{font-family:var(--sans);font-weight:900;font-size:clamp(32px,4.5vw,56px);letter-spacing:-0.03em;line-height:1.05;margin:0 0 18px;max-width:880px}
  h2.title em{font-family:var(--serif);font-style:italic;font-weight:500;color:var(--accent2)}
  .lede{color:var(--muted);font-size:18px;max-width:680px;line-height:1.55}

  /* manifesto */
  .manifesto blockquote{font-family:var(--serif);font-style:italic;font-weight:500;font-size:clamp(28px,3.8vw,52px);line-height:1.18;color:var(--text);margin:0;max-width:980px;letter-spacing:-0.01em}
  .manifesto blockquote span{color:var(--accent2)}
  .manifesto .source{color:var(--muted);font-size:14px;margin-top:32px}

  /* how-it-works */
  .stages{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:56px}
  @media (max-width:920px){.stages{grid-template-columns:1fr 1fr}}
  .stage{padding:28px;border:1px solid var(--border);border-radius:18px;background:linear-gradient(180deg,var(--surface) 0%,var(--surface2) 100%);position:relative;overflow:hidden;transition:transform .35s ease,border-color .35s ease}
  .stage:hover{transform:translateY(-4px);border-color:rgba(165,180,252,.35)}
  .stage .num{font-family:var(--mono);font-size:12px;color:var(--muted)}
  .stage h3{font-size:20px;font-weight:700;margin:8px 0 8px;letter-spacing:-0.02em}
  .stage p{font-size:14px;color:var(--muted);margin:0;line-height:1.55}
  .stage .icon{width:28px;height:28px;border-radius:999px;background:radial-gradient(circle at 30% 30%,var(--accent),#3b3b6e);margin-bottom:10px;box-shadow:0 0 24px rgba(165,180,252,.45)}

  /* live ledger */
  .ledger{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;margin-top:48px;align-items:center}
  @media (max-width:920px){.ledger{grid-template-columns:1fr}}
  .ledgerStream{font-family:var(--mono);font-size:13px;background:#080814;border:1px solid var(--border);border-radius:18px;padding:22px;height:380px;overflow:hidden;position:relative;mask-image:linear-gradient(180deg,transparent 0%,#000 12%,#000 88%,transparent 100%)}
  .ledgerStream .row{display:flex;align-items:center;gap:14px;padding:8px 0;border-bottom:1px dashed rgba(125,125,156,.18);opacity:0;animation:slideIn .6s ease forwards}
  .ledgerStream .row .t{color:var(--muted);width:62px;flex-shrink:0}
  .ledgerStream .row .e{color:var(--accent);width:88px;flex-shrink:0}
  .ledgerStream .row .a{color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ledgerStream .row .v{color:var(--accent3);font-variant-numeric:tabular-nums}
  @keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .ledgerCopy ul{list-style:none;padding:0;margin:24px 0 0}
  .ledgerCopy li{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--border)}
  .ledgerCopy li::before{content:"";width:6px;height:6px;border-radius:999px;background:var(--accent2);margin-top:9px;flex-shrink:0;box-shadow:0 0 12px rgba(253,230,138,.6)}

  /* code */
  .code{background:#080814;border:1px solid var(--border);border-radius:18px;overflow:hidden;margin-top:48px}
  .code .tabs{display:flex;gap:0;border-bottom:1px solid var(--border);background:rgba(255,255,255,.02)}
  .code .tab{padding:14px 20px;font-family:var(--mono);font-size:13px;color:var(--muted);cursor:pointer;border:none;background:transparent;border-right:1px solid var(--border)}
  .code .tab.on{color:var(--text);background:#0c0c1c}
  .code pre{margin:0;padding:24px 26px;font-family:var(--mono);font-size:13.5px;line-height:1.65;color:#cbd5e1;overflow-x:auto}
  .code pre .k{color:#a5b4fc}
  .code pre .s{color:#fde68a}
  .code pre .c{color:#5b5b78;font-style:italic}
  .code .pane{display:none}
  .code .pane.on{display:block}

  /* comparison */
  .compare{margin-top:40px;border:1px solid var(--border);border-radius:18px;overflow:hidden;background:var(--surface)}
  .compare table{width:100%;border-collapse:collapse;font-size:14px}
  .compare th,.compare td{padding:16px 20px;text-align:left;border-bottom:1px solid var(--border)}
  .compare th{background:rgba(255,255,255,.025);font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em}
  .compare td.feat{font-weight:600;color:var(--text)}
  .compare td.yes{color:var(--accent3)}
  .compare td.no{color:var(--muted)}
  .compare td.partial{color:var(--accent2)}
  .compare tr:last-child td{border-bottom:none}
  .compare .col-praetor{background:rgba(165,180,252,.06)}

  /* cta */
  .ctaBlock{margin-top:48px;padding:56px;border-radius:24px;background:radial-gradient(800px 400px at 30% 0%,rgba(165,180,252,.18) 0%,transparent 60%),linear-gradient(180deg,var(--surface) 0%,#080814 100%);border:1px solid var(--border);text-align:center}
  .ctaBlock h3{font-family:var(--sans);font-weight:900;font-size:clamp(28px,3.5vw,44px);letter-spacing:-0.02em;margin:0 0 16px}
  .ctaBlock p{color:var(--muted);max-width:600px;margin:0 auto 28px}
  .ctaBlock .row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
  .ctaBlock a.btn{display:inline-flex;align-items:center;gap:8px;padding:14px 22px;border-radius:999px;font-weight:600;font-size:14px;transition:transform .2s ease}
  .ctaBlock a.btn:hover{transform:translateY(-2px)}
  .ctaBlock a.btn.primary{background:var(--accent);color:#0a0a18}
  .ctaBlock a.btn.ghost{border:1px solid var(--border);color:var(--text)}

  footer{padding:48px 0;border-top:1px solid var(--border);color:var(--muted);font-size:13px}
  footer .wrap{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px}
  footer a{color:var(--muted)}
  footer a:hover{color:var(--text)}

  /* hero scene styles inherited from HtmlInCanvas3D's emitter */
  ${heroHead.match(/<style>([\s\S]*?)<\/style>/)[1]}
</style>
</head>
<body>
<nav class="nav"><div class="wrap">
  <div class="brand"><span class="dot"></span>Praetor</div>
  <div class="links">
    <a href="#how">How it works</a>
    <a href="#design">Design</a>
    <a href="#fiscal">Fiscal gate</a>
    <a href="#docs">Docs</a>
    <a href="https://github.com/jeromiah-omiagbo/praetor" class="cta">Get started</a>
  </div>
</div></nav>

<section class="hero">
  <div class="heroCopy">
    <div class="gate">▲ METERED BY MNEMOPAY</div>
    <h1>The mission runtime <em>that pays its own way.</em></h1>
    <p class="sub">Charter-driven autonomous agents. Every byte fiscally gated by MnemoPay's Agent FICO. Every action signed into a Merkle audit chain. EU AI Act Article 12 ready by default.</p>
  </div>
  ${heroBody}
</section>

<section class="s manifesto"><div class="wrap">
  <div class="label">The thesis</div>
  <blockquote>An agent without a budget is a <span>liability.</span> An agent without an audit log is a <span>lawsuit.</span> Praetor ships both — at runtime, not in the README.</blockquote>
  <p class="source">— Praetor STATE.md, 2026-04-28</p>
</div></section>

<section class="s" id="how"><div class="wrap">
  <div class="label">How it works</div>
  <h2 class="title">Four stages. <em>Every charter.</em></h2>
  <p class="lede">Praetor is not a framework, an orchestrator, or a wrapper. It is a runtime: declare a mission, open a budget, and the runtime spawns a metered agent under a Merkle-signed chain.</p>
  <div class="stages">
    <div class="stage"><div class="icon"></div><div class="num">01</div><h3>Charter</h3><p>One YAML file declares the mission, the budget, the agent pack, and the surfaces it touches. Versioned in git. Reviewed like code.</p></div>
    <div class="stage"><div class="icon"></div><div class="num">02</div><h3>Fiscal gate</h3><p>MnemoPay opens a budget. Every API call, render, scrape, and inference is metered. Hit the cap, the agent halts. Agent FICO updates in real time.</p></div>
    <div class="stage"><div class="icon"></div><div class="num">03</div><h3>Agent pack</h3><p>OpenClaw, Hermes, your own. Praetor wraps any agent with the same charter contract. Skills runnable inside Claude Code, Claude Agent SDK, MCP.</p></div>
    <div class="stage"><div class="icon"></div><div class="num">04</div><h3>Audit chain</h3><p>Every step Merkle-signed. Article 12 log bundle generated on demand. PDF + JSON-LD + cryptographic proof — for the regulator, the auditor, the lawyer.</p></div>
  </div>
</div></section>

<section class="s" id="fiscal"><div class="wrap">
  <div class="label">Fiscal gate</div>
  <h2 class="title">A live ledger. <em>For every agent.</em></h2>
  <p class="lede">Praetor binds <a href="https://mnemopay.com" style="color:var(--accent);text-decoration:underline;text-underline-offset:3px">MnemoPay</a> as its fiscal layer. Real Stripe + Paystack rails. Real escrow. Real Agent FICO 300-850. Not a mock — production payment infrastructure that 672 tests and 30K-stress-test prove out.</p>
  <div class="ledger">
    <div class="ledgerStream" id="ledger"></div>
    <div class="ledgerCopy">
      <ul>
        <li><strong>Metered every byte.</strong>&nbsp; Token + render + scrape + storage. Charter sees the bill before the agent sees the prompt.</li>
        <li><strong>HITL escrow.</strong>&nbsp; Spend over the threshold? Praetor pauses, fires a webhook, waits for human approval before unlocking.</li>
        <li><strong>Merkle proof.</strong>&nbsp; Every transaction signed into a chain. Tamper-evident. Audit-grade. Court-defensible.</li>
        <li><strong>Agent FICO.</strong>&nbsp; Behavioral score that follows the agent across charters. Bad agents lose access. Good ones unlock higher caps.</li>
      </ul>
    </div>
  </div>
</div></section>

<section class="s" id="design"><div class="wrap">
  <div class="label">Design pack</div>
  <h2 class="title">Native motion. <em>No build step.</em></h2>
  <p class="lede">Spline scenes, Hypeframes sequences, Remotion compositions, HTML-in-Canvas-3D heroes, declarative UI trees. A charter requests a surface; Praetor emits it. The page you're reading was rendered by the design pack itself.</p>
  <div class="code">
    <div class="tabs">
      <button class="tab on" data-pane="install">install</button>
      <button class="tab" data-pane="charter">charter.yaml</button>
      <button class="tab" data-pane="ugc">ugc render</button>
    </div>
    <div class="pane on" data-pane="install"><pre><span class="c"># clone, install, run your first charter</span>
<span class="k">git</span> clone https://github.com/jeromiah-omiagbo/praetor
<span class="k">cd</span> praetor && npm install && npm run build

<span class="c"># preview the design pack live</span>
<span class="k">node</span> packages/cli/dist/index.js design serve examples-out/bizsuite-godly-hero
<span class="c"># → http://127.0.0.1:&lt;port&gt;</span></pre></div>
    <div class="pane" data-pane="charter"><pre><span class="k">name</span>: ai-audit-997
<span class="k">budget</span>: <span class="s">"$25.00"</span>          <span class="c"># MnemoPay opens a real escrow</span>
<span class="k">surfaces</span>:
  - <span class="s">scrape</span>            <span class="c"># crawl the prospect's site</span>
  - <span class="s">knowledge</span>         <span class="c"># vector recall via MnemoPay-recall</span>
  - <span class="s">design.ugc</span>        <span class="c"># emit a 9:16 vertical ad</span>
<span class="k">audit</span>:
  <span class="k">article12</span>: <span class="s">true</span>     <span class="c"># EU AI Act bundle on completion</span>
<span class="k">agent</span>: openclaw      <span class="c"># or hermes, claude-code, custom</span></pre></div>
    <div class="pane" data-pane="ugc"><pre><span class="k">import</span> { defaultRenderer, specFromGoal } <span class="k">from</span> <span class="s">"@praetor/ugc"</span>;

<span class="k">const</span> r = defaultRenderer({ outDir: <span class="s">"out"</span> });
<span class="k">await</span> r.render(specFromGoal({
  id: <span class="s">"ai-audit-hook"</span>,
  goal: <span class="s">"Your agent stack is leaking $400 a week."</span>,
}), { portrait: <span class="s">"openai-image"</span>, motion: <span class="s">"luma-ray2"</span>, voice: <span class="s">"azure-neural"</span> });
<span class="c">// → out/ai-audit-hook.mp4 — metered through MnemoPay</span></pre></div>
  </div>
</div></section>

<section class="s"><div class="wrap">
  <div class="label">Comparison</div>
  <h2 class="title">Built different. <em>On purpose.</em></h2>
  <p class="lede">There are agent frameworks. There are payment SDKs. There are audit tools. Praetor is the only runtime that ships all three as one binary, with the fiscal gate at the kernel.</p>
  <div class="compare"><table>
    <thead><tr><th></th><th class="col-praetor">Praetor</th><th>Anthropic Agents</th><th>OpenAI Assistants</th><th>LangGraph</th></tr></thead>
    <tbody>
      <tr><td class="feat">Charter (YAML mission)</td><td class="yes col-praetor">native</td><td class="no">code only</td><td class="no">code only</td><td class="no">code only</td></tr>
      <tr><td class="feat">Fiscal gate (real $)</td><td class="yes col-praetor">MnemoPay 300-850</td><td class="no">none</td><td class="no">usage tracking</td><td class="no">none</td></tr>
      <tr><td class="feat">HITL escrow</td><td class="yes col-praetor">built-in</td><td class="no">DIY</td><td class="no">DIY</td><td class="partial">interrupts</td></tr>
      <tr><td class="feat">Merkle audit chain</td><td class="yes col-praetor">default</td><td class="no">none</td><td class="no">none</td><td class="no">none</td></tr>
      <tr><td class="feat">Article 12 bundle</td><td class="yes col-praetor">on demand</td><td class="no">DIY</td><td class="no">DIY</td><td class="no">DIY</td></tr>
      <tr><td class="feat">Native design + UGC</td><td class="yes col-praetor">design pack</td><td class="no">none</td><td class="no">none</td><td class="no">none</td></tr>
      <tr><td class="feat">GEO/SEO emitter</td><td class="yes col-praetor">native</td><td class="no">none</td><td class="no">none</td><td class="no">none</td></tr>
      <tr><td class="feat">Open source</td><td class="yes col-praetor">MIT</td><td class="partial">SDK only</td><td class="no">closed</td><td class="yes">MIT</td></tr>
    </tbody>
  </table></div>
</div></section>

<section class="s"><div class="wrap">
  <div class="ctaBlock">
    <h3>Run your first charter.</h3>
    <p>Open-source. MIT-licensed. Metered through MnemoPay so you only pay for what you actually run. Free until you ship something real.</p>
    <div class="row">
      <a class="btn primary" href="https://github.com/jeromiah-omiagbo/praetor">Star on GitHub →</a>
      <a class="btn ghost" href="https://mnemopay.com">Open MnemoPay →</a>
    </div>
  </div>
</div></section>

<footer><div class="wrap">
  <div>© 2026 J&amp;B Enterprise LLC · Praetor is open source under MIT</div>
  <div>
    <a href="https://mnemopay.com">mnemopay</a> ·
    <a href="https://gridstamp.com">gridstamp</a> ·
    <a href="https://getbizsuite.com">bizsuite</a> ·
    <a href="https://github.com/jeromiah-omiagbo/praetor">github</a>
  </div>
</div></footer>

<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
} }
</script>
${heroHtml.match(/<script type="module">([\s\S]*?)<\/script>/)[0]}

<script>
  // Tabs
  document.querySelectorAll(".code .tab").forEach((t) => {
    t.addEventListener("click", () => {
      const pane = t.dataset.pane;
      const code = t.closest(".code");
      code.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
      code.querySelectorAll(".pane").forEach((x) => x.classList.toggle("on", x.dataset.pane === pane));
    });
  });

  // Live ledger — synthesize a fake but plausible MnemoPay event stream
  const ledger = document.getElementById("ledger");
  const events = [
    ["02:14", "scrape", "GET prospect.com/pricing", "$0.0008"],
    ["02:14", "infer", "openai/gpt-image-1 portrait", "$0.0400"],
    ["02:15", "render", "luma/ray-2 9:16 5s", "$0.4000"],
    ["02:15", "tts", "azure/en-US-AndrewNeural 28w", "$0.0000"],
    ["02:15", "compose", "ffmpeg mux 9:16 24fps", "$0.0000"],
    ["02:15", "audit", "merkle leaf #f3a2 signed", "$0.0000"],
    ["02:16", "settle", "mnemopay charge $0.4408", "$0.4408"],
    ["02:16", "fico", "agent-7341 score 712 (+3)", "—"],
    ["02:17", "scrape", "GET docs.competitor.com", "$0.0006"],
    ["02:17", "infer", "anthropic/sonnet-4-6 1.2k tok", "$0.0036"],
    ["02:17", "store", "knowledge upsert 14 chunks", "$0.0001"],
    ["02:18", "render", "remotion 30s composition", "$0.0000"],
    ["02:18", "audit", "merkle leaf #f3a3 signed", "$0.0000"],
    ["02:18", "settle", "mnemopay charge $0.0043", "$0.0043"],
    ["02:19", "fico", "agent-7341 score 715 (+3)", "—"],
    ["02:19", "scrape", "POST x.com/syndication tweet", "$0.0000"],
    ["02:19", "infer", "openai/gpt-4o-mini 800 tok", "$0.0024"],
    ["02:20", "settle", "mnemopay charge $0.0024", "$0.0024"],
  ];
  let i = 0;
  function pushRow() {
    const e = events[i % events.length];
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = '<span class="t">' + e[0] + '</span><span class="e">' + e[1] + '</span><span class="a">' + e[2] + '</span><span class="v">' + e[3] + '</span>';
    ledger.appendChild(div);
    if (ledger.children.length > 14) ledger.children[0].remove();
    i++;
  }
  for (let k = 0; k < 8; k++) pushRow();
  setInterval(pushRow, 1400);
</script>
</body></html>`;

writeFileSync(join(out, "index.html"), landing);
writeFileSync(join(out, "vercel.json"), JSON.stringify({
  version: 2,
  cleanUrls: true,
  trailingSlash: false,
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "Cache-Control", value: "public, max-age=3600" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
  redirects: [],
}, null, 2));

writeFileSync(join(out, "robots.txt"), `User-agent: *
Allow: /

Sitemap: https://praetor.mnemopay.com/sitemap.xml

# AI crawler manifest
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
`);

writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://praetor.mnemopay.com/</loc><lastmod>2026-04-28</lastmod><priority>1.0</priority></url>
</urlset>
`);

writeFileSync(join(out, "llms.txt"), `# Praetor — the mission runtime

Praetor is a charter-driven runtime for autonomous agents. Every mission is fiscally gated by MnemoPay (Agent FICO 300-850, real Stripe + Paystack rails) and audit-logged into a Merkle chain. EU AI Act Article 12 bundle generation is built in.

## Key pages
- Home: https://praetor.mnemopay.com/
- GitHub: https://github.com/jeromiah-omiagbo/praetor
- MnemoPay (fiscal layer): https://mnemopay.com

## What Praetor does
- Charter-driven mission spec (YAML)
- MnemoPay fiscal gate — metered, escrowed, FICO-scored
- Native design pack — Spline, Hypeframes, Remotion, HTML-in-Canvas-3D
- Native UGC pipeline — OpenAI image, Luma Ray2, Azure TTS, ffmpeg
- Native scraper — fetch + Crawl4AI + Playwright + X.com syndication
- Native GEO/SEO — sitemap, robots, llms.txt, JSON-LD, hreflang
- Native compliance — EU AI Act Article 12 audit-log bundle generator
- Agent adapters — OpenClaw, Hermes, Claude Code, MCP

## License
MIT. Open source. © 2026 J&B Enterprise LLC.
`);

console.log("[praetor.mnemopay.com] wrote landing to " + out);
console.log("[deploy] cd " + out + " && vercel --prod");
