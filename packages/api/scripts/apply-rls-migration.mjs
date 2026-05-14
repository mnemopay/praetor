#!/usr/bin/env node
/**
 * Apply 0004_enable_rls.sql against Supabase via the SQL execution endpoint.
 *
 * Usage:
 *   SUPABASE_URL=https://awjqnxlslggxlfjmoubi.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key from Supabase dashboard> \
 *   node packages/api/scripts/apply-rls-migration.mjs
 *
 * Or pass via the .env in packages/api/ — the script reads it.
 *
 * Notes:
 *   - Supabase doesn't expose a public "run arbitrary SQL" REST endpoint;
 *     this uses the management API which requires a personal access token
 *     OR pgrest direct via the service_role + RPC.
 *   - Easiest path is paste the SQL into the SQL editor at
 *     https://supabase.com/dashboard/project/awjqnxlslggxlfjmoubi/sql/new
 *     and click "Run".
 *   - If you have a Supabase Personal Access Token (sbp_...), set
 *     SUPABASE_ACCESS_TOKEN and this script will use the management API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.resolve(__dirname, '../sql/0004_enable_rls.sql');

// Load .env if present
(function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

const PROJECT_REF = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const PAT = process.env.SUPABASE_ACCESS_TOKEN; // sbp_xxx — from supabase.com/dashboard/account/tokens
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = fs.readFileSync(SQL_PATH, 'utf8');
console.log(`Applying ${SQL_PATH} (${sql.length} bytes) to project ${PROJECT_REF || '<unset>'}...`);

if (PAT && PROJECT_REF) {
  // Supabase Management API — POST /v1/projects/{ref}/database/query
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const data = await r.text();
  console.log('HTTP', r.status);
  console.log(data);
  process.exit(r.ok ? 0 : 1);
}

console.error('');
console.error('No SUPABASE_ACCESS_TOKEN found. The Management API requires a Personal Access Token.');
console.error('');
console.error('Two options:');
console.error('');
console.error('1) FASTEST: paste the SQL directly into the Supabase SQL editor:');
console.error('   https://supabase.com/dashboard/project/awjqnxlslggxlfjmoubi/sql/new');
console.error('');
console.error('2) Get a Personal Access Token:');
console.error('   - Visit https://supabase.com/dashboard/account/tokens');
console.error('   - Generate a new token (e.g. "praetor-rls-fix")');
console.error('   - export SUPABASE_ACCESS_TOKEN=sbp_xxx');
console.error('   - re-run this script');
console.error('');
console.error('The SQL is also printed below for copy/paste convenience:');
console.error('-'.repeat(80));
console.error(sql);
process.exit(2);
