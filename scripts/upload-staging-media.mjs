#!/usr/bin/env node
// Put real bytes behind the storage keys seed-staging.sql wrote.
//
//   ./supabase/staging-seed/transcode-media.sh          # once, produces docs/test-stories/derived/
//   pnpm staging:media --confirm
//
// WHY A SCRIPT AND NOT SQL. The seed can write a descriptor row and the key it points at; it
// cannot write bytes. Until something does, every image and video in the app is a grey
// rectangle — which is the state staging has been in since it was first seeded.
//
// THE ONE INVARIANT WORTH PROTECTING. The key an object is stored at and the key the row points
// at must be the same string, forever. So this script never *composes* a key. It derives each
// row's deterministic id the same way the SQL does (md5 of a semantic key), looks the row up by
// that id, and uploads to whatever the path column literally contains. If someone changes the
// path expression in the seed, this follows automatically; if a row is missing, it says so and
// stops rather than inventing a location.
//
// NO DEPENDENCIES, ON PURPOSE. @supabase/supabase-js resolves only from packages/api under this
// workspace's layout (node-linker=hoisted puts it in a per-package node_modules), so a script at
// the repo root cannot import it without adding a duplicate devDependency. The parts of it this
// needs — upload, sign, sign-in — are one fetch each. Node 22's global fetch and node:crypto
// cover the rest, and the script stays runnable from any cwd, which matters for something an
// operator runs by hand.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED = join(ROOT, 'docs/test-stories/derived');

const STAGING_REF = 'eralyiwkfrpqsawivegz';
const PRODUCTION_REF = 'kwzeiqvrnnaagccyoose';

// A seeded member, used for the verification pass. Password is the seed's, and the whole point
// of these accounts is that they are public knowledge on a disposable project.
const VERIFIER = { email: 'sole_designer@staging.athanor.local', password: 'Athanor2026!' };

// ── the expected world ────────────────────────────────────────────────────────────────────
// Mirrors seed-staging.sql. `key` is the semantic key the SQL hashes for the row id; `file` is
// what transcode-media.sh produces. Nothing here is a storage path — those come from the DB.
const STORIES = [
  ['marta_ceramica', 1, 'mp4'], ['tino_chef', 1, 'jpg'], ['bea_foto', 1, 'jpg'],
  ['dario_legno', 1, 'jpg'], ['dario_legno', 2, 'mp4'], ['ele_yoga', 1, 'jpg'],
  ['vera_erbe', 1, 'jpg'], ['gio_musica', 1, 'mp4'], ['sole_designer', 1, 'mp4'],
];
const MOMENTS = [
  ['sole_designer', 'jpg'], ['marta_ceramica', 'mp4'], ['tino_chef', 'jpg'],
  ['rocco_film', 'jpg'], ['dario_legno', 'jpg'],
];
const POST_MEDIA = ['bea_foto', 'ele_yoga', 'vera_erbe', 'nina_poeta'];
const CANDIDACIES = ['marta_ceramica', 'ele_yoga', 'rocco_film'];
const AVATARS = [
  'sole_designer', 'luna_dev', 'marta_ceramica', 'gio_musica',
  'ele_yoga', 'tino_chef', 'vera_erbe', 'rocco_film',
];

/** `md5(text)::uuid` in Postgres — the same 32 hex digits, dashed. */
const rowId = (semanticKey) => {
  const h = createHash('md5').update(semanticKey).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const contentType = (file) => (file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');

// ── guards ────────────────────────────────────────────────────────────────────────────────
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

const args = new Set(process.argv.slice(2));
const url = (process.env.STAGING_SUPABASE_URL ?? '').replace(/\/+$/, '');
const secretKey = process.env.STAGING_SUPABASE_SECRET_KEY ?? '';
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY ?? '';

if (!url || !secretKey || !publishableKey) {
  die(`set all three, in the shell, never in a file:

  export STAGING_SUPABASE_URL=https://${STAGING_REF}.supabase.co
  export STAGING_SUPABASE_SECRET_KEY=sb_secret_…       # Dashboard → API Keys (secret)
  export STAGING_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…   # the same key the app ships

The publishable key is not sensitive and is required on purpose: the verification pass has to
read as an ordinary member, and an apikey that the gateway might treat as privileged would make
that check prove nothing.`);
}

// Two gates, mirroring the seed's own posture. The explicit production check is redundant given
// the first, and is here anyway because this is the mistake that cannot be undone.
if (url.includes(PRODUCTION_REF)) die(`refusing: ${url} is PRODUCTION.`);
if (!url.includes(STAGING_REF)) die(`refusing: ${url} is not the staging project (${STAGING_REF}).`);
if (!args.has('--confirm')) die('refusing: pass --confirm to write to staging.');

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────
const svc = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: svc });
  if (!res.ok) die(`query failed (${res.status}): ${path}\n${await res.text()}`);
  return res.json();
}

async function upload(bucket, path, body, type) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': type, 'x-upsert': 'true' },
    body,
  });
  if (!res.ok) die(`upload failed (${res.status}) ${bucket}/${path}\n${await res.text()}`);
}

// ── 1. collect every (bucket, file, row id, path column) the world needs ──────────────────
// Each entry names the table, the ids to look up, and which column holds the key.
const plan = [
  { table: 'story_segments', bucket: 'story-segments', col: 'storage_path',
    want: STORIES.map(([h, n, ext]) => ({ id: rowId(`story:${h}:${n}`), file: `story__${h}__${n}.${ext}` })) },
  { table: 'moments', bucket: 'moments', col: 'media_path',
    want: MOMENTS.map(([h, ext]) => ({ id: rowId(`moment:${h}`), file: `moment__${h}.${ext}` })) },
  // The video moment's poster frame. Same table, the other path column.
  { table: 'moments', bucket: 'moments', col: 'thumb_path',
    want: [{ id: rowId('moment:marta_ceramica'), file: 'moment__marta_ceramica__thumb.jpg' }] },
  { table: 'post_media', bucket: 'post-media', col: 'storage_path',
    want: POST_MEDIA.map((h) => ({ id: rowId(`postmedia:${h}:0`), file: `post__${h}__0.jpg` })) },
  { table: 'dream_candidacies', bucket: 'candidacy-videos', col: 'video_url',
    want: CANDIDACIES.map((h) => ({ id: rowId(`candidacy:${h}`), file: `candidacy__${h}.mp4` })) },
  { table: 'profiles', bucket: 'avatars', col: 'avatar_path',
    want: AVATARS.map((h) => ({ id: rowId(`user:${h}`), file: `avatar__${h}.jpg` })) },
];

// Missing files are reported ALL AT ONCE and then fatal. A script that uploads eleven of
// nineteen and then dies leaves a world that looks seeded and is not.
const missing = [];
for (const step of plan) {
  for (const w of step.want) {
    try { await stat(join(DERIVED, w.file)); }
    catch { missing.push(w.file); }
  }
}
if (missing.length) {
  die(`${missing.length} derived file(s) missing from docs/test-stories/derived:\n  ${
    missing.join('\n  ')}\n\nRun ./supabase/staging-seed/transcode-media.sh first.`);
}

// ── 2. resolve each row's key FROM THE DATABASE, then upload to exactly that ──────────────
const uploaded = [];
for (const step of plan) {
  const ids = step.want.map((w) => w.id);
  const rows = await rest(`${step.table}?id=in.(${ids.join(',')})&select=id,${step.col}`);
  const byId = new Map(rows.map((r) => [r.id, r[step.col]]));

  for (const w of step.want) {
    const key = byId.get(w.id);
    if (key == null) {
      die(`${step.table} row ${w.id} (${w.file}) is missing or has a null ${step.col}. `
        + `Re-run seed-staging.sql — the seed and this script are out of step.`);
    }
    const body = await readFile(join(DERIVED, w.file));
    await upload(step.bucket, key, body, contentType(w.file));
    uploaded.push({ bucket: step.bucket, key, file: w.file, bytes: body.length });
    console.log(`  ↑ ${step.bucket}/${key}  ← ${w.file}`);
  }
}
console.log(`\nuploaded ${uploaded.length} objects\n`);

// ── 3. verify AS A MEMBER, which is the only read that proves anything ───────────────────
// Service role bypasses RLS, so a service-role read would have succeeded even against the old
// handle-prefixed keys that no client could ever see. This signs and fetches each object under
// an ordinary member's JWT, so it exercises the uuid-first-segment guard and not_blocked for
// real. Note there is no visibility special case: the storage policies gate on blocks alone, so
// vera_erbe's private *profile* does not make her *objects* unreadable.
const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(VERIFIER),
});
if (!tokenRes.ok) die(`could not sign in as ${VERIFIER.email} (${tokenRes.status}): ${await tokenRes.text()}`);
const { access_token: memberToken } = await tokenRes.json();
const member = { apikey: publishableKey, Authorization: `Bearer ${memberToken}` };

const failures = [];
for (const o of uploaded) {
  const signRes = await fetch(`${url}/storage/v1/object/sign/${o.bucket}/${o.key}`, {
    method: 'POST',
    headers: { ...member, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  if (!signRes.ok) {
    failures.push(`${o.bucket}/${o.key} — member cannot sign (${signRes.status}); the SELECT policy denies it`);
    continue;
  }
  const { signedURL } = await signRes.json();
  const getRes = await fetch(`${url}/storage/v1${signedURL}`);
  const bytes = (await getRes.arrayBuffer()).byteLength;
  if (!getRes.ok || bytes === 0) {
    failures.push(`${o.bucket}/${o.key} — signed URL returned ${getRes.status}, ${bytes} bytes`);
  }
}

if (failures.length) {
  console.error(`\n✗ ${failures.length}/${uploaded.length} objects are NOT readable by a member:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nThe bytes are uploaded but the app will still render blank rectangles.');
  process.exit(1);
}

console.log(`✓ all ${uploaded.length} objects sign and fetch as ${VERIFIER.email}`);
