#!/usr/bin/env node
// scripts/apple-client-secret.mjs — mint the Apple client secret for Supabase's Apple provider (#79)
//
//   node scripts/apple-client-secret.mjs --key ~/Keys/AuthKey_XXXXXXXXXX.p8 \
//     --key-id XXXXXXXXXX --client-id world.athanor.signin [--team-id V299S78WM5] [--days 180]
//
//   (or APPLE_KEY_PATH / APPLE_KEY_ID / APPLE_SERVICES_ID / APPLE_TEAM_ID in the environment)
//
// WHAT IT IS. The app signs in with Apple through Supabase's browser OAuth flow
// (apps/native/src/lib/oauth.ts), so Supabase — not the app — talks to Apple, and Apple wants
// a "client secret": an ES256 JWT signed with the Sign in with Apple key (.p8), naming the Team
// ID, the Key ID and the Services ID. Apple accepts one for at most six months. When it lapses,
// every Apple sign-in fails at the callback, so the secret is re-minted with this script and
// pasted into BOTH projects' Auth → Providers → Apple. The due date lives in
// docs/RELEASE-RUNBOOK.md §6.1; update it at every rotation.
//
// SECRETS. The token goes to the macOS clipboard (pbcopy) and is never printed, never written
// to disk, never logged — only its expiry is printed. The .p8 is read from wherever the
// operator keeps it and nothing here copies it; keep it OUTSIDE the repo (`*.p8` is gitignored
// as a backstop, not as a place to store it). Paste the clipboard into the dashboard, then copy
// something else over it.
//
// NO DEPENDENCIES, ON PURPOSE — a repo-root script cannot import from the workspace under
// node-linker=hoisted (same reasoning as deploy-check.mjs), and node:crypto signs ES256.
//
// The pure half (everything above `main()`) is exported and unit-tested from
// `packages/api/src/apple-client-secret.test.ts`.

import { spawnSync } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const APPLE_AUDIENCE = 'https://appleid.apple.com';

/** Athanor's Apple Developer Team ID. Public: it appears in every provisioning profile. */
export const TEAM_ID = 'V299S78WM5';

/**
 * Apple's ceiling is 15777000 s (six months); 180 days is 15552000 s, under it with margin.
 * Minting at the ceiling keeps rotations as rare as Apple allows.
 */
export const MAX_DAYS = 180;

const APPLE_ID = /^[A-Z0-9]{10}$/;

const b64url = (value) => Buffer.from(value).toString('base64url');

/**
 * @param {{ privateKeyPem: string, keyId: string, teamId: string, clientId: string, now: Date, days?: number }} input
 * @returns {{ token: string, expiresAt: Date }}
 */
export function buildAppleClientSecret({
  privateKeyPem,
  keyId,
  teamId,
  clientId,
  now,
  days = MAX_DAYS,
}) {
  if (!APPLE_ID.test(keyId ?? '')) throw new Error('keyId must be the 10-character Apple Key ID');
  if (!APPLE_ID.test(teamId ?? ''))
    throw new Error('teamId must be the 10-character Apple Team ID');
  if (!clientId) throw new Error('clientId must be the Services ID (e.g. world.athanor.signin)');
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)
    throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}`);

  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('the key must be an EC P-256 key (a Sign in with Apple .p8)');

  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + days * 86_400;
  const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))}.${b64url(
    JSON.stringify({ iss: teamId, iat, exp, aud: APPLE_AUDIENCE, sub: clientId }),
  )}`;
  // A JWT carries the raw 64-byte r||s signature. node:crypto defaults to DER, which Apple
  // rejects as an invalid client — hence ieee-p1363.
  const signature = sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return {
    token: `${signingInput}.${signature.toString('base64url')}`,
    expiresAt: new Date(exp * 1000),
  };
}

const FLAGS = {
  '--key': 'keyPath',
  '--key-id': 'keyId',
  '--team-id': 'teamId',
  '--client-id': 'clientId',
  '--days': 'days',
};

/**
 * Flags win over APPLE_* env vars; the Team ID defaults to Athanor's. Every missing input is
 * named in one error, so a first run does not become four.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function resolveOptions(argv, env) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = FLAGS[argv[i]];
    if (!name)
      throw new Error(`unknown argument ${argv[i]} (known: ${Object.keys(FLAGS).join(' ')})`);
    flags[name] = argv[i + 1];
  }
  const options = {
    keyPath: flags.keyPath ?? env.APPLE_KEY_PATH,
    keyId: flags.keyId ?? env.APPLE_KEY_ID,
    teamId: flags.teamId ?? env.APPLE_TEAM_ID ?? TEAM_ID,
    clientId: flags.clientId ?? env.APPLE_SERVICES_ID,
    days: Number(flags.days ?? MAX_DAYS),
  };
  const missing = [
    ['keyPath', '--key (APPLE_KEY_PATH)'],
    ['keyId', '--key-id (APPLE_KEY_ID)'],
    ['clientId', '--client-id (APPLE_SERVICES_ID)'],
  ].filter(([k]) => !options[k]);
  if (missing.length) throw new Error(`missing ${missing.map(([, label]) => label).join(', ')}`);
  return options;
}

function main() {
  const options = resolveOptions(process.argv.slice(2), process.env);
  const { token, expiresAt } = buildAppleClientSecret({
    ...options,
    privateKeyPem: readFileSync(options.keyPath, 'utf8'),
    now: new Date(),
  });
  const copied = spawnSync('pbcopy', { input: token });
  if (copied.status !== 0) throw new Error('pbcopy failed — nothing was printed or saved');
  console.log(`Apple client secret copied to the clipboard (not printed).`);
  console.log(`Expires ${expiresAt.toISOString()} — record it in docs/RELEASE-RUNBOOK.md §6.1.`);
  console.log(
    `Paste into Auth → Providers → Apple → Secret Key on each project, then clear the clipboard.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
