#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { DesignPack } from "../packages/design/dist/index.js";

const pack = new DesignPack();
const art = pack.renderHtmlInCanvas3D({
  title: "BizSuite — godly hero preview",
  background: "radial-gradient(circle at 50% 30%, #1e1b4b 0%, #000 70%)",
  rings: true,
  faceParallax: false,
  mouseParallax: true,
  dolly: { near: 6, far: 12 },
  cards: [
    {
      id: "starter",
      html: `<h2>Starter</h2><p style="color:#a5b4fc;font-size:14px">$2,500 + $500/mo</p>
<ul style="padding-left:18px;font-size:14px;line-height:1.7">
  <li>2 plugins shipped</li><li>Cold-email automation</li><li>Slack support</li>
</ul>
<a class="cta" href="https://getbizsuite.com/systems.html#starter">Buy</a>`,
    },
    {
      id: "growth",
      html: `<h2>Growth</h2><p style="color:#fde68a;font-size:14px">$5,000 + $1,000/mo</p>
<ul style="padding-left:18px;font-size:14px;line-height:1.7">
  <li>4 plugins shipped</li><li>Fractional-ops dashboard</li><li>1 weekly office hour</li>
</ul>
<a class="cta" href="https://getbizsuite.com/systems.html#growth">Buy</a>`,
    },
    {
      id: "scale",
      html: `<h2>Scale</h2><p style="color:#a5b4fc;font-size:14px">$10,000 + $2,000/mo</p>
<ul style="padding-left:18px;font-size:14px;line-height:1.7">
  <li>Unlimited plugins</li><li>Article 12 compliance bundle</li><li>Direct line</li>
</ul>
<a class="cta" href="https://getbizsuite.com/systems.html#scale">Buy</a>`,
    },
  ],
});

const out = resolve(process.argv[2] ?? "./examples-out/bizsuite-godly-hero");
mkdirSync(out, { recursive: true });
for (const f of art.files) {
  const target = join(out, f.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, f.contents);
}
console.log("[design] wrote " + art.files.length + " files to " + out);
