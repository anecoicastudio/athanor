#!/usr/bin/env node
// Restore the staging world NOW, without waiting for the hourly cron.
//
//   pnpm staging:refresh --confirm
//
// Runs `select public.staging_refresh_world()` on the hosted staging project — the
// same function the `staging-refresh-world` pg_cron job runs at :07 every hour. The
// function is installed once by supabase/staging-seed/refresh-staging.sql (two-gate
// guarded, see its header); this script only invokes it, which is why no gate-2
// confirmation is needed here: the function is self-gated on the staging Vault
// marker and is restorative by design (it never deletes tester-created content).
//
// AUTH. There is no database password on this machine (the CLI authenticates with
// its own token and never stores one), so the call goes through the Supabase
// Management API — POST /v1/projects/<ref>/database/query — authenticated with the
// operator's own CLI credential: $SUPABASE_ACCESS_TOKEN if set, else the macOS
// keychain entry `supabase login` created. No service key, nothing to paste.
//
// NO DEPENDENCIES, ON PURPOSE — same reasoning as upload-staging-media.mjs: a repo-
// root script cannot import @supabase/supabase-js under node-linker=hoisted, and one
// fetch needs no library anyway.

import { execFileSync } from 'node:child_process';

const STAGING_REF = 'eralyiwkfrpqsawivegz';
const PRODUCTION_REF = 'kwzeiqvrnnaagccyoose';

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const args = new Set(process.argv.slice(2));

// Two gates, mirroring upload-staging-media.mjs. The ref is a constant, so the
// production check can only fail if someone edits this file — which is exactly the
// moment it should refuse.
const API = `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`;
if (API.includes(PRODUCTION_REF)) die(`refusing: ${API} is PRODUCTION.`);
if (!API.includes(STAGING_REF))
  die(`refusing: ${API} is not the staging project (${STAGING_REF}).`);
if (!args.has('--confirm')) die('refusing: pass --confirm to refresh the staging world.');

function accessToken() {
  const env = process.env.SUPABASE_ACCESS_TOKEN;
  if (env) return env.trim();
  if (process.platform === 'darwin') {
    try {
      return execFileSync(
        'security',
        ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'],
        { encoding: 'utf8' },
      ).trim();
    } catch {
      /* fall through to the hint */
    }
  }
  die(`no Management API token. Either:

  export SUPABASE_ACCESS_TOKEN=sbp_…       # from app.supabase.com/account/tokens
  supabase login                            # stores one in the macOS keychain

This is the operator's own account credential, not a project secret.`);
}

const res = await fetch(API, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken()}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: 'select public.staging_refresh_world() as result;' }),
});

const text = await res.text();

if (res.status === 401)
  die(
    `Management API rejected the token (401). Re-run \`supabase login\`, or refresh SUPABASE_ACCESS_TOKEN.\n${text}`,
  );
if (!res.ok) {
  if (/42883|does not exist/.test(text))
    die(
      `staging_refresh_world() is not installed. Run the installer once (see supabase/staging-seed/README.md):\n  psql "<staging pooler url>" -v ON_ERROR_STOP=1 -c "set app.settings.seed_confirm = 'yes'" -f supabase/staging-seed/refresh-staging.sql`,
    );
  die(`Management API error ${res.status}:\n${text}`);
}

// The endpoint returns the rows as JSON — defensively accept both the bare-array
// and the {result: [...]} shapes it has used.
let rows;
try {
  const parsed = JSON.parse(text);
  rows = Array.isArray(parsed) ? parsed : (parsed.result ?? parsed.rows ?? [parsed]);
} catch {
  die(`could not parse Management API response:\n${text}`);
}

const summary = rows?.[0]?.result;
if (!summary) die(`unexpected response shape:\n${text}`);
if (summary.skipped)
  die(
    `refresh skipped: ${summary.skipped}\nThe staging Vault marker or the seed is missing — see supabase/staging-seed/README.md.`,
  );

console.log('\n✓ staging world refreshed\n');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(24)} ${v}`);
console.log(
  '\nThe hourly cron job `staging-refresh-world` does the same at :07 — this was just sooner.\n',
);
