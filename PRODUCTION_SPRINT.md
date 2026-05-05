# Praetor — production sprint plan

Status: **beta-ready for tech-savvy local users; NOT consumer-launchable yet.**
Goal of this sprint: get to "anyone with a credit card can sign up at
praetor.dev/api and start running charters."

Estimated total: **~1 sprint (1 focused week)** if Jerry runs the manual
steps as they come up, ~2 weeks if everything goes through async/Codex.

---

## Tracker

| # | Step | State | Blocker | Owner |
|---|---|---|---|---|
| 1 | Bump versions in lockstep | Script ready (`scripts/bump-versions.mjs`) | none | Codex |
| 2 | Freeze cli `*` deps to concrete versions | Script ready (`scripts/freeze-cli-deps.mjs`) | none | Codex |
| 3 | Add NPM_TOKEN to GitHub repo secrets | not done | **needs Jerry** | Jerry |
| 4 | First npm publish (one tier-0 leaf) | not done | step 3 | Codex |
| 5 | Publish all 28 packages in tier order | Script ready (`scripts/publish-all.mjs`) | step 4 | Codex |
| 6 | Real Supabase persistence | Adapter ready (`packages/api/src/supabase-real.ts`) | **needs Supabase project** | Jerry → Codex |
| 7 | Run schema migration in Supabase | SQL ready (`packages/api/sql/0001_init.sql`) | step 6 | Jerry |
| 8 | Set Fly secrets + redeploy api | not done | step 6 | Codex |
| 9 | Add Praetor as 3rd product to bizsuite-site portal | not done | none | Codex |
| 10 | Wire per-developer API keys (`pt_live_…`) | not done | step 9 | Codex |
| 11 | FiscalGate hook into bizsuite-site billing | not done | step 9 | Codex |
| 12 | Marketing site at praetor.mnemopay.com or praetor.dev | not done | none | Codex |
| 13 | Backfill 0-test packages (payments / sdk / social / sysadmin) | not done | none | Codex |
| 14 | Browser-in-docker full impl | scaffold only | needs published Praetor Chromium image | ops |

---

## Step-by-step playbook

### 1. NPM_TOKEN (Jerry, 5 min)

```
1. Go to https://www.npmjs.com/settings/<your-username>/tokens/granular
2. "Generate New Token" → "Granular Access Token"
3. Name: praetor-publish
4. Expiration: 365 days
5. Permissions: Read and write to packages and scopes
6. Scopes: select @praetor (or grant all-package access if @praetor scope
   doesn't exist yet — npm creates it on first publish)
7. Generate, copy the token (npm_xxxxx)

Then:
  gh secret set NPM_TOKEN -R mnemopay/praetor --body "<the npm_xxxxx token>"
```

### 2. Bump + freeze + tag (Codex, 5 min)

```bash
cd C:\Users\bizsu\Projects\praetor

# Pick the version. v0.1.0 is conventional for first public release.
node scripts/bump-versions.mjs 0.1.0

# Freeze cli's "*" deps to concrete ^0.1.0
node scripts/freeze-cli-deps.mjs

# Verify tests still pass
npm install --no-audit --no-fund
npm test

# Commit + tag + push
git add -A
git commit -m "release: v0.1.0 — first public npm publish"
git tag v0.1.0
git push --follow-tags
```

### 3. Test publish ONE leaf package (Codex, 5 min)

Before triggering the full forest, verify the workflow + token works
by manually running the workflow for a single tier-0 leaf:

```bash
gh workflow run publish.yml -f package=core -f tag=latest -R mnemopay/praetor
```

Watch at https://github.com/mnemopay/praetor/actions. Should succeed.
Then verify:
```bash
npm view @praetor/core version
# → 0.1.0
```

### 4. Publish all packages (Codex, ~30 min, mostly waiting)

```bash
node scripts/publish-all.mjs --tag latest
```

Triggers the workflow per package in tier order, polls npm between each
to wait for it to land. If any step fails, the script prints the resume
command. Total wait: ~30 min for 28 packages × ~60 sec each.

### 5. Supabase project (Jerry, 5 min)

```
1. Go to https://supabase.com/dashboard
2. New project → name: praetor-prod, region: us-east-1, password: secure
3. Wait ~2 min for provision
4. Settings → API → copy:
   - Project URL                         → SUPABASE_URL
   - service_role key (NOT anon key)     → SUPABASE_SERVICE_ROLE_KEY
5. SQL editor → paste packages/api/sql/0001_init.sql → Run
6. Verify: Table editor shows missions, mission_logs, mission_events, mission_audit
```

### 6. Wire Supabase to praetor-api Fly app (Codex, 5 min)

```bash
fly secrets set \
  SUPABASE_URL=https://<your-project>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  -a praetor-api

fly secrets unset PRAETOR_DEV_MODE -a praetor-api

# Add @supabase/supabase-js to packages/api/package.json deps
cd packages/api && npm install @supabase/supabase-js && cd ../..
git add -A && git commit -m "feat(api): wire @supabase/supabase-js for prod persistence"
git push

# Redeploy
fly deploy --remote-only --config packages/api/fly.toml --dockerfile ./Dockerfile
```

Verify:
```bash
curl https://praetor-api.fly.dev/health           # 200
curl https://praetor-api.fly.dev/api/v1/missions \
  -H "Authorization: Bearer dev:any" -X POST \
  -d '{"goal":"test"}' -H "Content-Type: application/json"
# → 201 with mission persisted in Supabase (verify in Supabase Table editor)
```

### 7. Wire Praetor into bizsuite-site portal (Codex, 1-2 hr)

Add Praetor as a 3rd product alongside MnemoPay + GridStamp in
`C:/Users/bizsu/Projects/bizsuite-site/portal.js`:

```js
// In the genApiKey + on-signup loops:
for (const product of ["mnemopay", "gridstamp", "praetor"]) {  // add "praetor"
  const key = genApiKey(product);
  ...
}

function genApiKey(product) {
  const prefix =
    product === "gridstamp" ? "gs_live_"
    : product === "praetor"  ? "pt_live_"
    : "mp_live_";
  return prefix + crypto.randomBytes(24).toString("hex");
}
```

Then in `packages/api/src/auth.ts`, replace the dev-mode bearer parsing
with a call to `https://getbizsuite.com/portal/verify-key` (the
existing endpoint that MnemoPay + GridStamp MCP servers use).

### 8. Marketing site (Codex, 2-3 hr)

Use the same Fly + nginx pattern that linger-site already uses. New
Fly app: `praetor-site`. Domain: praetor.mnemopay.com (or buy
praetor.dev).

Page sections (use `od-saas-landing` skill):
- Hero: "The drop-in autonomy layer for any LLM"
- Live demo: paste your Anthropic key, run a charter
- Pricing: free for first 100 charters/month, $49/mo Plus, $299/mo
  Enterprise (mirrors MnemoPay tiers)
- Docs link → praetor-api.fly.dev/docs
- npm install card → `npm install -g @praetor/cli`
- Trust seal: 511 tests, MIT/Apache, EU AI Act Article 12 ready

### 9-13: deferred to v0.2 / ops

- Backfill tests for payments / sdk / social / sysadmin
- Browser-in-docker (needs Praetor Chromium image)
- Load testing harness
- SSO / team accounts

---

## What "consumer-ready" means after this sprint

- ✅ `npm install -g @praetor/cli` works
- ✅ `praetor run mission.yaml` works against the Fly api
- ✅ Missions persist in Supabase (survive restart)
- ✅ Authenticated by per-developer `pt_live_…` keys
- ✅ Billed through bizsuite-site portal (free tier 100 charters/mo,
  paid plans via Stripe)
- ✅ Marketing page at praetor.mnemopay.com explains what it is in
  one screen
- ✅ EU AI Act Article 12 audit bundles export per mission

What's NOT done by this sprint and is intentional v0.2 work:
- Browser-in-docker (needs published Chromium image)
- Marketplace of community charters
- Team accounts / RBAC
- Async charter resumption / pause-and-resume
- Charter cost optimizer

---

## Definition of done

```bash
# Anyone in the world can run:
npm install -g @praetor/cli
export PRAETOR_API_KEY=pt_live_xxx              # signed up at getbizsuite.com/developers
echo 'goal: "summarize hacker news today"' > mission.yaml
praetor run mission.yaml
# → mission persists in Supabase, charges $0.001-0.01 against the user's
#   account, returns the summary, audit bundle downloadable.
```

When that command works end-to-end with no human in the loop, Praetor
is consumer-launchable and we cut a v0.1.0 release announcement.
