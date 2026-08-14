-- #149 — mission / skills / profession / city / city_geohash on profiles
-- (migration 20260814104755): gated-tier grants, per-field visibility through
-- get_person_profile, the CHECK shapes, and the deliberate absence of
-- city_geohash from every third-person projection.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000098', 'alice98@test.dev'),
  ('bbbbbbbb-0000-0000-0000-000000000098', 'bob98@test.dev');

-- alice: full new-field row, city picked (geohash present), skills/city private.
set local role service_role;
update public.profiles set
  handle = 'alice98',
  mission = 'Portare arte nelle scuole',
  skills = array['illustrazione', 'storytelling'],
  profession = 'arte',
  city = 'Milano',
  city_geohash = 'u0nd9',
  visibility = '{"skills":"private","city":"private"}'::jsonb
  where id = 'aaaaaaaa-0000-0000-0000-000000000098';
update public.profiles set handle = 'bob98'
  where id = 'bbbbbbbb-0000-0000-0000-000000000098';
reset role;

-- ── column CHECKs (service_role writes, so RLS is not what fires) ────────────
set local role service_role;
select throws_ok(
  $$ update public.profiles set city_geohash = 'toolong7'
     where id = 'bbbbbbbb-0000-0000-0000-000000000098' $$,
  '23514', null, 'city_geohash CHECK rejects a non-precision-5 value'
);
select throws_ok(
  $$ update public.profiles set city_geohash = 'u0ndA'
     where id = 'bbbbbbbb-0000-0000-0000-000000000098' $$,
  '23514', null, 'city_geohash CHECK rejects characters outside geohash base32'
);
select throws_ok(
  $$ update public.profiles set skills = array['a','b','c','d','e','f','g','h','i','j','k']
     where id = 'bbbbbbbb-0000-0000-0000-000000000098' $$,
  '23514', null, 'skills CHECK caps cardinality at 10'
);
reset role;

-- ── bob (plain member): direct selects are column-denied, projection applies ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000098","role":"authenticated"}';

select throws_ok(
  $$ select mission from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000098' $$,
  '42501', null, 'direct mission select is column-denied for members'
);
select throws_ok(
  $$ select skills from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000098' $$,
  '42501', null, 'direct skills select is column-denied for members'
);
select throws_ok(
  $$ select profession from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000098' $$,
  '42501', null, 'direct profession select is column-denied for members'
);
select throws_ok(
  $$ select city_geohash from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000098' $$,
  '42501', null, 'direct city_geohash select is column-denied for members'
);

select is(
  (select mission from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000098')),
  'Portare arte nelle scuole',
  'default-visibility mission is visible to a member'
);
select is(
  (select profession from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000098')),
  'arte',
  'default-visibility profession is visible to a member'
);
select is(
  (select skills from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000098')),
  null,
  'private skills are NULLed by get_person_profile'
);
select is(
  (select city from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000098')),
  null,
  'private city is NULLed by get_person_profile'
);
select throws_ok(
  $$ select city_geohash from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000098') $$,
  '42703', null, 'city_geohash is not a column of the third-person projection at all'
);

-- ── owner: per-column write grant works, own full row readable ───────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000098","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles
     set mission = 'La mia missione', skills = array['seo'], profession = 'marketing',
         city = 'Roma', city_geohash = 'sr2yk'
     where id = 'bbbbbbbb-0000-0000-0000-000000000098' $$,
  'owner can write all five new columns (per-column grant + RLS)'
);
select is(
  (select mission from public.get_own_profile()),
  'La mia missione',
  'get_own_profile (select *) carries the new columns'
);
select is(
  (select city_geohash from public.get_own_profile()),
  'sr2yk',
  'owner reads own city_geohash through get_own_profile'
);
reset role;

-- ── alice (owner of the private fields) still sees them ──────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000098","role":"authenticated"}';
select is(
  (select skills from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000098')),
  array['illustrazione', 'storytelling'],
  'owner sees own private skills (field_visible short-circuits on auth.uid())'
);
reset role;

select * from finish();
rollback;
