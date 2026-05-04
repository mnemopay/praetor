# Praetor — release process

This is the playbook for publishing Praetor packages to npm. Read this
before running the publish workflow.

## Why this doc exists

`@praetor/cli` depends on 19 sibling `@praetor/*` packages. The current
`package.json` declarations use `"*"` as the version specifier, which
means "any published version." That works at install time, but it has
two caveats:

1. **Every transitive dep must already be published.** If `@praetor/cli`
   ships before `@praetor/browser` is on npm, `npm install -g @praetor/cli`
   will fail.
2. **Reproducibility.** `"*"` resolves to whatever's latest at install
   time. Two installs a month apart can produce different runtimes.

The release process below addresses both — publishing in dependency
order, replacing `"*"` with concrete versions in the cli's
`package.json` at publish time, and tagging the cli release as the
canonical "what worked together."

## Dependency order (publish from top → down)

When publishing the workspace, order matters. Each row depends only on
rows above it.

### Tier 0 — leaves (no `@praetor/*` deps)

- `@praetor/core`
- `@praetor/tools`
- `@praetor/scrape`
- `@praetor/knowledge`
- `@praetor/router`
- `@praetor/seo`
- `@praetor/design`
- `@praetor/social`
- `@praetor/game`

### Tier 1 — depend on tier 0 only

- `@praetor/payments` (→ tools, possibly core)
- `@praetor/agents` (→ core, tools)
- `@praetor/sandbox` (→ tools)
- `@praetor/business-ops` (→ tools)
- `@praetor/game-assets` (→ tools)
- `@praetor/world-gen` (→ tools)
- `@praetor/vision` (→ tools)
- `@praetor/voice` (→ tools)
- `@praetor/mcp` (→ tools)

### Tier 2

- `@praetor/sysadmin` (→ sandbox)
- `@praetor/computer-control` (→ tools, core, vision)
- `@praetor/browser` (→ core, tools, vision)
- `@praetor/coding-agent` (→ agents, core, router, tools)
- `@praetor/research-agent` (→ tools, scrape)
- `@praetor/ugc` (→ tools, design)

### Tier 3

- `@praetor/api` (→ core, cli, tools)
- `@praetor/sdk` (→ aggregator)

### Tier 4

- `@praetor/cli` — depends on everything

### Special: `@praetor/desktop`

- Depends on `@praetor/api` + `@praetor/dashboard`. Currently a scaffold
  with no Electron binary builds wired. Don't publish until the
  Electron-builder pipeline lands.

## Publish a single package

The CI workflow at `.github/workflows/publish.yml` accepts the package
name (without the `@praetor/` prefix) and an npm dist-tag:

```bash
gh workflow run publish.yml -f package=router -f tag=latest
gh workflow run publish.yml -f package=router -f tag=next   # for prereleases
```

Pre-flight checks the workflow runs:

1. The directory `packages/<name>/package.json` exists.
2. The package is **not** marked `private: true`.
3. `npm ci` succeeds against the workspace.
4. `npm run build` succeeds.
5. `npm test` succeeds (current baseline: 489 tests across 41 files).

If any check fails, the publish step doesn't run and nothing leaks to
npm.

## Publish the whole workspace (release-all)

When cutting a coordinated release (e.g. v0.2.0 across the stack), the
sequence is:

```bash
# 1. Bump every package's version in lockstep
node scripts/bump-versions.mjs 0.2.0   # NOT YET IMPLEMENTED — write me

# 2. Commit + tag
git commit -am "release: v0.2.0"
git tag v0.2.0
git push --follow-tags

# 3. Publish in dependency order (one workflow run per package)
for pkg in core tools scrape knowledge router seo design social game \
           payments agents sandbox business-ops game-assets world-gen vision voice mcp \
           sysadmin computer-control browser coding-agent research-agent ugc \
           api sdk cli; do
  gh workflow run publish.yml -f package=$pkg -f tag=latest
  echo "Waiting for $pkg to land on npm..."
  while ! npm view @praetor/$pkg@0.2.0 version > /dev/null 2>&1; do sleep 10; done
done
```

This loop respects dependency order and waits for each package to
appear on npm before publishing the next.

## Concrete versions in `@praetor/cli`

Today, the cli's `package.json` uses `"*"` for every workspace dep.
Before the first npm publish:

**Option A — manual swap.** Before running `gh workflow run publish.yml -f package=cli`, edit
`packages/cli/package.json` and replace each `"*"` with the actual
version of the corresponding sibling that's already on npm.

**Option B — prepublish script.** Add a `scripts/freeze-versions.mjs`
that walks the cli's deps and replaces every `"*"` with the version
from each sibling's `package.json`. Wire it as `prepublishOnly` in the
cli's `package.json`. This is the right long-term answer.

The current state is option A.

## Versioning policy

- `0.x` — pre-1.0. Breaking changes allowed in MINOR bumps. We're here.
- `1.0` — first stable. Once a public consumer ships against `1.0`, we
  freeze the public API and breaking changes go to `2.0`.
- `next` dist-tag — preview / preview / release-candidate builds.
  Consumers opt in with `npm install @praetor/cli@next`.
- `latest` dist-tag — production. What `npm install @praetor/cli`
  resolves to.

## Provenance

The publish workflow runs `npm publish --provenance`, which uses
GitHub's OIDC to attest that the published artifact came from this
repo at this commit. Verify on npm:

```bash
npm view @praetor/cli --json | jq '.dist["npm-signature"]'
```

## Rolling back a bad release

```bash
# 1. Move the dist-tag away from the bad version
npm dist-tag add @praetor/<pkg>@<previous-version> latest

# 2. (Optional) Deprecate the bad version
npm deprecate @praetor/<pkg>@<bad-version> "use <previous-version>"

# 3. NEVER `npm unpublish` after 72 hours. npm forbids it for packages
#    other consumers depend on. Ship a patch instead.
```

## Pre-launch checklist

Before the first `@praetor/cli` publish:

- [ ] All 19 sibling packages have shipped tier 0 → tier 3 successfully
- [ ] The cli's `package.json` `"*"` deps are replaced with concrete versions matching the published siblings
- [ ] `package-lock.json` reflects the concrete versions
- [ ] `npm install -g .` from `packages/cli/` works locally before publish
- [ ] `praetor doctor` runs cleanly against a fresh `npm install -g @praetor/cli@<candidate-version>`
- [ ] CHANGELOG entry written for the cli's version
- [ ] README's "Quick start" command still produces a working `praetor serve`
