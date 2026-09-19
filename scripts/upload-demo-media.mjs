#!/usr/bin/env node
// Uploads the demo world's media to STAGING — the companion of
// supabase/staging-seed/demo-world.sql, as upload-staging-media.mjs is of seed-staging.sql.
//
// Run AFTER `pnpm staging:media --confirm`: that one puts the base seed's bytes at every seeded
// key; this one overwrites the replaced ones (x-upsert) and adds the twelve new people's. Files
// come from docs/test-stories/demo (gitignored, Pexels-licensed originals transcoded to the
// seed's crops) — override with DEMO_MEDIA_DIR when running from a worktree.
//
// Same contract as the seed uploader: no service key, every key read back out of the DB (never
// recomputed here), every byte uploaded by its owner through the bucket's own INSERT policy.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = process.env.DEMO_MEDIA_DIR ?? join(ROOT, 'docs/test-stories/demo');

const STAGING_REF = 'eralyiwkfrpqsawivegz';
const PRODUCTION_REF = 'kwzeiqvrnnaagccyoose';
const PASSWORD = 'Athanor2026!'; // the seed's, on a disposable project

const PEOPLE = [
  'sole_designer',
  'luna_dev',
  'marta_ceramica',
  'gio_musica',
  'ele_yoga',
  'tino_chef',
  'vera_erbe',
  'rocco_film',
  'sara_startup',
  'dario_legno',
  'nina_poeta',
  'bea_foto',
  'noah_climbs',
  'amara_textiles',
  'leo_bikes',
  'hana_garden',
  'theo_code',
  'ines_dance',
  'omar_bread',
  'clara_books',
  'jonas_sound',
  'priya_care',
  'sam_mentor',
  'zoe_murals',
];
const POST_MEDIA = [
  'sole_designer',
  'ele_yoga',
  'vera_erbe',
  'nina_poeta',
  'bea_foto',
  'amara_textiles',
  'leo_bikes',
  'hana_garden',
  'omar_bread',
  'clara_books',
  'zoe_murals',
  'noah_climbs',
  'jonas_sound',
];
const STORIES = [
  ['marta_ceramica', 1, 'mp4'],
  ['bea_foto', 1, 'jpg'],
  ['dario_legno', 2, 'mp4'],
  ['gio_musica', 1, 'mp4'],
  ['sole_designer', 1, 'mp4'],
  ['ines_dance', 1, 'mp4'],
  ['omar_bread', 1, 'mp4'],
  ['zoe_murals', 1, 'mp4'],
  ['noah_climbs', 1, 'mp4'],
  ['hana_garden', 1, 'jpg'],
  ['leo_bikes', 1, 'jpg'],
];
const CANDIDACIES = ['marta_ceramica', 'ele_yoga', 'rocco_film'];

const rowId = (key) => {
  const h = createHash('md5').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const plan = [
  ...PEOPLE.map((h) => ({
    table: 'profiles',
    bucket: 'avatars',
    col: 'avatar_path',
    owner: h,
    id: rowId(`user:${h}`),
    file: `avatar__${h}.jpg`,
  })),
  ...POST_MEDIA.map((h) => ({
    table: 'post_media',
    bucket: 'post-media',
    col: 'storage_path',
    owner: h,
    id: rowId(`postmedia:${h}:0`),
    file: `post__${h}__0.jpg`,
  })),
  ...STORIES.map(([h, n, ext]) => ({
    table: 'story_segments',
    bucket: 'story-segments',
    col: 'storage_path',
    owner: h,
    id: rowId(`story:${h}:${n}`),
    file: `story__${h}__${n}.${ext}`,
  })),
  {
    table: 'moments',
    bucket: 'moments',
    col: 'media_path',
    owner: 'sole_designer',
    id: rowId('moment:sole_designer'),
    file: 'moment__sole_designer.jpg',
  },
  {
    table: 'moments',
    bucket: 'moments',
    col: 'media_path',
    owner: 'tino_chef',
    id: rowId('moment:tino_chef'),
    file: 'moment__tino_chef.jpg',
  },
  {
    table: 'moments',
    bucket: 'moments',
    col: 'media_path',
    owner: 'marta_ceramica',
    id: rowId('moment:marta_ceramica'),
    file: 'moment__marta_ceramica.mp4',
  },
  {
    table: 'moments',
    bucket: 'moments',
    col: 'thumb_path',
    owner: 'marta_ceramica',
    id: rowId('moment:marta_ceramica'),
    file: 'moment__marta_ceramica__thumb.jpg',
  },
  ...CANDIDACIES.flatMap((h) => [
    {
      table: 'dream_candidacies',
      bucket: 'candidacy-videos',
      col: 'video_url',
      owner: h,
      id: rowId(`candidacy:${h}`),
      file: `candidacy__${h}.mp4`,
    },
    {
      table: 'dream_candidacies',
      bucket: 'candidacy-videos',
      col: 'thumb_path',
      owner: h,
      id: rowId(`candidacy:${h}`),
      file: `candidacy__${h}__thumb.jpg`,
    },
  ]),
  {
    table: 'messages',
    bucket: 'chat-media',
    col: 'media_url',
    owner: 'luna_dev',
    id: rowId('msg:sole_designer:luna_dev:6'),
    file: 'chat__luna_dev__6.jpg',
  },
  {
    table: 'messages',
    bucket: 'chat-media',
    col: 'media_url',
    owner: 'gio_musica',
    id: rowId('msg:rocco_film:gio_musica:4'),
    file: 'chat__gio_musica__4.jpg',
  },
];

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const url = (process.env.STAGING_SUPABASE_URL ?? '').replace(/\/+$/, '');
const anonKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!url || !anonKey)
  die(
    'set STAGING_SUPABASE_URL and STAGING_SUPABASE_PUBLISHABLE_KEY (see upload-staging-media.mjs).',
  );
if (url.includes(PRODUCTION_REF)) die(`refusing: ${url} is PRODUCTION.`);
if (!url.includes(STAGING_REF))
  die(`refusing: ${url} is not the staging project (${STAGING_REF}).`);
if (!process.argv.includes('--confirm')) die('refusing: pass --confirm to write to staging.');

const missing = [];
for (const p of plan) {
  try {
    await stat(join(MEDIA, p.file));
  } catch {
    missing.push(p.file);
  }
}
if (missing.length)
  die(`${missing.length} file(s) missing from ${MEDIA}:\n  ${missing.join('\n  ')}`);

const tokens = new Map();
async function tokenFor(handle) {
  if (tokens.has(handle)) return tokens.get(handle);
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${handle}@staging.athanor.local`, password: PASSWORD }),
  });
  if (!res.ok) die(`sign-in failed for ${handle} (${res.status}): ${await res.text()}`);
  const { access_token } = await res.json();
  tokens.set(handle, access_token);
  return access_token;
}
const auth = (token) => ({ apikey: anonKey, Authorization: `Bearer ${token}` });

let done = 0;
for (const p of plan) {
  const token = await tokenFor(p.owner);
  const res = await fetch(`${url}/rest/v1/${p.table}?id=eq.${p.id}&select=${p.col}`, {
    headers: auth(token),
  });
  if (!res.ok) die(`read failed (${res.status}) ${p.table}/${p.id}: ${await res.text()}`);
  const [row] = await res.json();
  const key = row?.[p.col];
  if (!key)
    die(
      `${p.table} ${p.id} (${p.file}) is missing or has a null ${p.col} — run demo-world.sql first.`,
    );
  const up = await fetch(`${url}/storage/v1/object/${p.bucket}/${key}`, {
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': p.file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
      'x-upsert': 'true',
    },
    body: await readFile(join(MEDIA, p.file)),
  });
  if (!up.ok)
    die(`upload failed (${up.status}) ${p.bucket}/${key} as ${p.owner}: ${await up.text()}`);
  done += 1;
  console.log(`  ok  ${p.bucket}/${key}  ← ${p.file}`);
}
console.log(`\n${done}/${plan.length} uploaded.`);
