#!/usr/bin/env node
// Create Stripe products + prices for Praetor SaaS billing.
// Idempotent — looks up products by name and skips/updates instead of duplicating.
//
// Reads STRIPE_SECRET_KEY from C:/Users/bizsu/Projects/mnemopay-sdk/.env
//
// Outputs: scripts/.stripe-praetor-prices.json with the canonical price IDs
// that the api server reads when issuing checkout sessions.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENV = readFileSync('C:/Users/bizsu/Projects/mnemopay-sdk/.env', 'utf8');
const env = Object.fromEntries(ENV.split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const SK = env.STRIPE_SECRET_KEY;
if (!SK) { console.error('STRIPE_SECRET_KEY missing'); process.exit(1); }

async function stripe(method, path, body) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-09-30.preview',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe ${method} ${path} ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

async function findProduct(name) {
  const r = await stripe('GET', `/products/search?query=name:'${encodeURIComponent(name)}'+active:'true'&limit=5`);
  return (r.data || [])[0] || null;
}

async function findPrice(productId, unitAmount, interval) {
  const r = await stripe('GET', `/prices?product=${productId}&active=true&limit=20`);
  return (r.data || []).find(p => p.unit_amount === unitAmount && p.recurring?.interval === interval) || null;
}

const PLANS = [
  {
    productName: 'Praetor Pro',
    description: '100 missions/month, $25 LLM spend cap, private charters, EU AI Act audit bundles. For solo devs and indie shops.',
    metadata: { tier: 'pro', missionCap: '100', llmCapUsd: '25', audit12: 'true', marketplace: 'false' },
    prices: [
      { name: 'Praetor Pro Monthly', amount: 2900, interval: 'month', lookupKey: 'praetor_pro_monthly' },
      { name: 'Praetor Pro Yearly',  amount: 29000, interval: 'year',  lookupKey: 'praetor_pro_yearly' },
    ],
  },
  {
    productName: 'Praetor Team',
    description: 'Unlimited missions, $100 LLM cap (BYOK above), 5 seats, marketplace publish, audit bundles. For agencies + scaleups.',
    metadata: { tier: 'team', missionCap: 'unlimited', llmCapUsd: '100', seats: '5', byok: 'true', audit12: 'true', marketplace: 'true' },
    prices: [
      { name: 'Praetor Team Monthly', amount: 9900,  interval: 'month', lookupKey: 'praetor_team_monthly' },
      { name: 'Praetor Team Yearly',  amount: 99000, interval: 'year',  lookupKey: 'praetor_team_yearly' },
    ],
  },
];

(async () => {
  const out = { generatedAt: new Date().toISOString(), tiers: {} };

  for (const plan of PLANS) {
    let product = await findProduct(plan.productName);
    if (!product) {
      product = await stripe('POST', '/products', {
        name: plan.productName,
        description: plan.description,
        ...Object.fromEntries(Object.entries(plan.metadata).map(([k, v]) => [`metadata[${k}]`, v])),
      });
      console.log(`+ product ${plan.productName} = ${product.id}`);
    } else {
      console.log(`= product ${plan.productName} = ${product.id} (exists)`);
    }

    out.tiers[plan.metadata.tier] = { productId: product.id, prices: {} };

    for (const p of plan.prices) {
      let price = await findPrice(product.id, p.amount, p.interval);
      if (!price) {
        price = await stripe('POST', '/prices', {
          product: product.id,
          unit_amount: p.amount,
          currency: env.STRIPE_CURRENCY || 'usd',
          'recurring[interval]': p.interval,
          nickname: p.name,
          lookup_key: p.lookupKey,
        });
        console.log(`  + price ${p.name} = ${price.id}`);
      } else {
        console.log(`  = price ${p.name} = ${price.id} (exists, $${price.unit_amount/100}/${p.interval})`);
      }
      out.tiers[plan.metadata.tier].prices[p.interval] = { id: price.id, lookupKey: p.lookupKey, amount: p.amount };
    }
  }

  // Free tier — no Stripe product needed (it's the default subscription state)
  out.tiers.free = { productId: null, prices: { virtual: { id: 'free', amount: 0 } } };
  // Enterprise — invoice-only, also no Stripe product (sales-managed)
  out.tiers.enterprise = { productId: null, prices: { virtual: { id: 'enterprise_invoice_only', amount: null } } };

  const outPath = join(__dirname, '.stripe-praetor-prices.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nDONE — wrote ${outPath}`);
  console.log(JSON.stringify(out, null, 2));
})();
