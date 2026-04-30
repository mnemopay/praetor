# Phase 4 SaaS Platform

This document describes the SaaS economy layer introduced in Phase 4.

## Packages

- `packages/api`: Express gateway with Supabase-backed multi-tenant mission APIs.
- `packages/dashboard`: Vite frontend with Supabase auth and SaaS views (Missions, Audit, Billing, Marketplace).

## API Endpoints

- `POST /api/v1/auth/session`: validates bearer token against Supabase auth.
- `GET /api/v1/missions`: tenant-scoped mission list.
- `POST /api/v1/missions`: creates and starts a mission.
- `GET /api/v1/missions/:id`: tenant mission details and logs.
- `GET /api/v1/marketplace/plugins`: plugin registry plus current installs.
- `POST /api/v1/marketplace/install`: install plugin for tenant.
- `GET /api/v1/billing`: billing threshold/spend snapshot.

## Supabase Setup

1. Create a Supabase project.
2. Run SQL migration from:
   - `packages/api/supabase/migrations/20260430_phase4_init.sql`
3. Confirm RLS is enabled on:
   - `missions`
   - `mission_logs`
   - `plugin_installs`
   - `billing_snapshots`

## Local Development

### API

1. Copy `packages/api/.env.example` to `packages/api/.env`.
2. Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Build and run:
   - `npm run build`
   - `node packages/api/dist/index.js`

### Dashboard

1. Copy `packages/dashboard/.env.example` to `packages/dashboard/.env`.
2. Fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL`.
3. Run:
   - `npm run dev --workspace @praetor/dashboard`

## Deployment

- Dashboard deploy target: Vercel or Cloudflare Pages.
- API deploy target: Render, Fly, Railway, or any Node host.
- Required production env vars:
  - API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PRAETOR_REPO_ROOT`
  - Dashboard: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`
