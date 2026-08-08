-- public.get_momenti_suggestion (migration 20260808035852): the «Ti potrebbe
-- interessare» row moved behind a DEFINER RPC so it can filter on
-- profiles.visibility, which authenticated cannot read since the M10 column grant.
-- The RPC returns at most one row, so each case is isolated by excluding every
-- other fixture through p_exclude — what's left is the candidate under test.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-0000-4000-8000-000000000075','authenticated','authenticated','me75@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000075','authenticated','authenticated','a75@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000075','authenticated','authenticated','b75@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000075','authenticated','authenticated','c75@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000075','authenticated','authenticated','d75@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000075','authenticated','authenticated','e75@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-4000-8000-000000000075','authenticated','authenticated','f75@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','abababab-0000-4000-8000-000000000075','authenticated','authenticated','g75@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
-- ME is the caller. A: plain, suggestable. B: BOTH tag fields private. C: only
-- identity_tags private (the boundary — still suggestable). D: dream private.
-- E: no active dream. F: blocked BY me. G: blocks me (the other direction).
update public.profiles set handle = 'me75' where id = '11111111-0000-4000-8000-000000000075';
update public.profiles set handle = 'a75'  where id = 'aaaaaaaa-0000-4000-8000-000000000075';
update public.profiles set handle = 'b75', visibility = '{"identity_tags":"private","seeking":"private"}'::jsonb
  where id = 'bbbbbbbb-0000-4000-8000-000000000075';
update public.profiles set handle = 'c75', visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'cccccccc-0000-4000-8000-000000000075';
update public.profiles set handle = 'd75', visibility = '{"dream":"private"}'::jsonb
  where id = 'dddddddd-0000-4000-8000-000000000075';
update public.profiles set handle = 'e75' where id = 'eeeeeeee-0000-4000-8000-000000000075';
update public.profiles set handle = 'f75' where id = 'ffffffff-0000-4000-8000-000000000075';
update public.profiles set handle = 'g75' where id = 'abababab-0000-4000-8000-000000000075';

-- Explicit created_at so ordering is deterministic AND adversarial: every
-- candidate that must be filtered out (B both-private, D private dream, F/G
-- blocked) holds a NEWER dream than the one that should win. If any predicate
-- were dropped, the unexcluded call at the end would return the wrong member.
insert into public.dreams (profile_id, text, created_at) values
  ('11111111-0000-4000-8000-000000000075','Sogno di me',  now() - interval '10 days'),
  ('aaaaaaaa-0000-4000-8000-000000000075','Sogno A',      now() - interval '1 day'),
  ('bbbbbbbb-0000-4000-8000-000000000075','Sogno B',      now()),
  ('cccccccc-0000-4000-8000-000000000075','Sogno C',      now() - interval '5 days'),
  ('dddddddd-0000-4000-8000-000000000075','Sogno D',      now()),
  ('ffffffff-0000-4000-8000-000000000075','Sogno F',      now()),
  ('abababab-0000-4000-8000-000000000075','Sogno G',      now());
-- E gets one and loses it: an archived dream must not qualify.
insert into public.dreams (profile_id, text, status)
  values ('eeeeeeee-0000-4000-8000-000000000075','Sogno E archiviato','archived');

-- Mutual invisibility, one fixture per direction.
insert into public.blocks (blocker_id, blocked_id) values
  ('11111111-0000-4000-8000-000000000075','ffffffff-0000-4000-8000-000000000075'),
  ('abababab-0000-4000-8000-000000000075','11111111-0000-4000-8000-000000000075');

-- Isolate the pool to the fixtures (0028 / 0073 precedent) — seed.sql ships
-- dreamers who would otherwise win the `updated_at desc` race.
update public.dreams set status = 'archived'
  where profile_id not in (
    '11111111-0000-4000-8000-000000000075','aaaaaaaa-0000-4000-8000-000000000075',
    'bbbbbbbb-0000-4000-8000-000000000075','cccccccc-0000-4000-8000-000000000075',
    'dddddddd-0000-4000-8000-000000000075','ffffffff-0000-4000-8000-000000000075',
    'abababab-0000-4000-8000-000000000075')
    and status = 'active' and deleted_at is null;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000075","role":"authenticated"}';

-- Each call excludes every fixture but one, so the RPC's `limit 1` can only ever
-- answer with the candidate under test.
select is(
  (select candidate_id from public.get_momenti_suggestion(array[
    'bbbbbbbb-0000-4000-8000-000000000075','cccccccc-0000-4000-8000-000000000075',
    'dddddddd-0000-4000-8000-000000000075','eeeeeeee-0000-4000-8000-000000000075',
    'ffffffff-0000-4000-8000-000000000075','abababab-0000-4000-8000-000000000075']::uuid[])),
  'aaaaaaaa-0000-4000-8000-000000000075'::uuid,
  'a plain member with an active dream is suggested'
);
select is(
  (select dream_text from public.get_momenti_suggestion(array[
    'bbbbbbbb-0000-4000-8000-000000000075','cccccccc-0000-4000-8000-000000000075',
    'dddddddd-0000-4000-8000-000000000075','eeeeeeee-0000-4000-8000-000000000075',
    'ffffffff-0000-4000-8000-000000000075','abababab-0000-4000-8000-000000000075']::uuid[])),
  'Sogno A',
  'the suggestion carries the dream text'
);
select is(
  (select count(*) from public.get_momenti_suggestion(array[
    'aaaaaaaa-0000-4000-8000-000000000075','cccccccc-0000-4000-8000-000000000075',
    'dddddddd-0000-4000-8000-000000000075','eeeeeeee-0000-4000-8000-000000000075',
    'ffffffff-0000-4000-8000-000000000075','abababab-0000-4000-8000-000000000075']::uuid[])),
  0::bigint,
  'BOTH tag fields private ⇒ not suggested (matches the affinity-0 boundary)'
);
select is(
  (select candidate_id from public.get_momenti_suggestion(array[
    'aaaaaaaa-0000-4000-8000-000000000075','bbbbbbbb-0000-4000-8000-000000000075',
    'dddddddd-0000-4000-8000-000000000075','eeeeeeee-0000-4000-8000-000000000075',
    'ffffffff-0000-4000-8000-000000000075','abababab-0000-4000-8000-000000000075']::uuid[])),
  'cccccccc-0000-4000-8000-000000000075'::uuid,
  'identity_tags alone private ⇒ STILL suggested (same boundary as 0073 persona E)'
);
select is(
  (select count(*) from public.get_momenti_suggestion(array[
    'aaaaaaaa-0000-4000-8000-000000000075','bbbbbbbb-0000-4000-8000-000000000075',
    'cccccccc-0000-4000-8000-000000000075','eeeeeeee-0000-4000-8000-000000000075',
    'ffffffff-0000-4000-8000-000000000075','abababab-0000-4000-8000-000000000075']::uuid[])),
  0::bigint,
  'a private dream ⇒ not suggested'
);
select is(
  (select count(*) from public.get_momenti_suggestion(array[
    'aaaaaaaa-0000-4000-8000-000000000075','bbbbbbbb-0000-4000-8000-000000000075',
    'cccccccc-0000-4000-8000-000000000075','dddddddd-0000-4000-8000-000000000075',
    'ffffffff-0000-4000-8000-000000000075','abababab-0000-4000-8000-000000000075']::uuid[])),
  0::bigint,
  'no ACTIVE dream ⇒ not suggested'
);
select is(
  (select count(*) from public.get_momenti_suggestion(array[
    'aaaaaaaa-0000-4000-8000-000000000075','bbbbbbbb-0000-4000-8000-000000000075',
    'cccccccc-0000-4000-8000-000000000075','dddddddd-0000-4000-8000-000000000075',
    'eeeeeeee-0000-4000-8000-000000000075','abababab-0000-4000-8000-000000000075']::uuid[])),
  0::bigint,
  'someone I blocked ⇒ not suggested (DEFINER must not drop not_blocked)'
);
select is(
  (select count(*) from public.get_momenti_suggestion(array[
    'aaaaaaaa-0000-4000-8000-000000000075','bbbbbbbb-0000-4000-8000-000000000075',
    'cccccccc-0000-4000-8000-000000000075','dddddddd-0000-4000-8000-000000000075',
    'eeeeeeee-0000-4000-8000-000000000075','ffffffff-0000-4000-8000-000000000075']::uuid[])),
  0::bigint,
  'someone who blocked ME ⇒ not suggested (mutual, the other direction)'
);
-- Every fixture excluded: only the caller is left, and the caller must never be
-- their own suggestion (ME has an active dream, so this would otherwise return).
select is(
  (select count(*) from public.get_momenti_suggestion(array[
    'aaaaaaaa-0000-4000-8000-000000000075','bbbbbbbb-0000-4000-8000-000000000075',
    'cccccccc-0000-4000-8000-000000000075','dddddddd-0000-4000-8000-000000000075',
    'eeeeeeee-0000-4000-8000-000000000075','ffffffff-0000-4000-8000-000000000075',
    'abababab-0000-4000-8000-000000000075']::uuid[])),
  0::bigint,
  'the caller is never suggested to themselves'
);

-- ── ordering, with nothing excluded ─────────────────────────────────────────
-- The isolated cases above each leave exactly one candidate standing, so none of
-- them exercise `order by d.created_at desc` — the one thing the «Sogno nuovo»
-- chip actually asserts. B, D, F and G all hold dreams newer than A's.
select is(
  (select candidate_id from public.get_momenti_suggestion('{}'::uuid[])),
  'aaaaaaaa-0000-4000-8000-000000000075'::uuid,
  'ranks by newest ACTIVE DREAM, and the newer dreams of filtered members do not win'
);
select is(
  (select candidate_id from public.get_momenti_suggestion(
    array['aaaaaaaa-0000-4000-8000-000000000075']::uuid[])),
  'cccccccc-0000-4000-8000-000000000075'::uuid,
  'excluding the winner falls through to the next-newest eligible dream'
);
-- A NULL in the array used to make `not (id = any(...))` NULL for every row and
-- silently return nothing (fixed in 20260808041335 with the NOT EXISTS form).
select is(
  (select candidate_id from public.get_momenti_suggestion(array[null]::uuid[])),
  'aaaaaaaa-0000-4000-8000-000000000075'::uuid,
  'a NULL inside p_exclude does not silently blank the result'
);
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.get_momenti_suggestion('{}'::uuid[]) $$,
  '42501', null, 'anon cannot execute get_momenti_suggestion'
);
reset role;

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_momenti_suggestion' and p.prosecdef),
  1::bigint,
  'get_momenti_suggestion is SECURITY DEFINER (profiles.visibility is not client-readable)'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_momenti_suggestion'
      and p.proconfig @> array['search_path=""']),
  1::bigint,
  'get_momenti_suggestion pins an empty search_path'
);

select * from finish();
rollback;
