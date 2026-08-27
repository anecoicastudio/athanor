-- #573 — the account-wide GDPR blob manifest (20260827110034).
--
-- 0104 asserts the FUND reach's own manifest, deliberately narrow: candidacy-videos and nothing
-- else, with a second-bucket object seeded to prove the narrowness. That assertion is true about
-- gdpr_erase_fund_footprint and is left alone. What was missing was anything covering the rest of
-- the member's bytes — post-media, moments, story-segments, avatars, chat-media, and the member's
-- own `exports` archives all survived a GDPR erasure, because the erasure job's storage reach was
-- that one narrow manifest. This file pins the function that closed it.
--
-- The Storage-API removal itself is erasure-job's half (deno-tested in sweep.test.ts); like 0043
-- and 0104, the sidecar is out of scope here. The bucket LIST is mirrored in a third place —
-- supabase/functions/erasure-job/sweep-buckets.test.ts compares it against every bucket the
-- migrations create and against packages/api's MediaBucketName, so a new bucket cannot land
-- unswept the way chat-media did.

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- ── schema + privileges ─────────────────────────────────────────────────────────────────
select has_function(
  'public', 'gdpr_storage_footprint', array['uuid', 'integer'],
  'the account-wide storage manifest exists');

select ok(
  not has_function_privilege('anon', 'public.gdpr_storage_footprint(uuid, integer)', 'execute'),
  'anon cannot execute gdpr_storage_footprint');
select ok(
  not has_function_privilege(
    'authenticated', 'public.gdpr_storage_footprint(uuid, integer)', 'execute'),
  'authenticated cannot execute gdpr_storage_footprint');
select ok(
  has_function_privilege(
    'service_role', 'public.gdpr_storage_footprint(uuid, integer)', 'execute'),
  'service_role can execute gdpr_storage_footprint');

-- INVOKER for the same reason as its sibling (#145): the only caller is erasure-job's
-- service-role client, which already reads storage.objects unimpeded.
select ok(
  (select not p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gdpr_storage_footprint'),
  'gdpr_storage_footprint is SECURITY INVOKER');

-- ── fixture ─────────────────────────────────────────────────────────────────────────────
-- A (…aa) is erased; B (…bb) stays. A has exactly one object in each of the seven declared
-- buckets, plus four objects that must NOT be listed: one with no path separator, one whose
-- key merely CONTAINS A's uuid, one belonging to B, and one in a bucket outside the list.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '25000000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'erased@0137.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '25000000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'stays@0137.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- A bucket the sweep's list does NOT name, so its exclusion is asserted rather than assumed.
-- Test-local: it exists only inside this transaction, so the migrations remain the only place
-- a real bucket is declared and sweep-buckets.test.ts is unaffected.
insert into storage.buckets (id, name, public) values ('0137-scratch', '0137-scratch', false);

insert into storage.objects (bucket_id, name) values
  -- the seven that MUST be listed, one per declared bucket
  ('avatars',          '25000000-0000-0000-0000-0000000000aa/25000000-0000-0000-0000-0000000000aa.jpg'),
  ('post-media',       '25000000-0000-0000-0000-0000000000aa/post-1/0.jpg'),
  ('moments',          '25000000-0000-0000-0000-0000000000aa/mom-1.jpg'),
  ('story-segments',   '25000000-0000-0000-0000-0000000000aa/seg-1.mp4'),
  ('candidacy-videos', '25000000-0000-0000-0000-0000000000aa/cand-1.mp4'),
  ('chat-media',       '25000000-0000-0000-0000-0000000000aa/conv-1/img-1.jpg'),
  ('exports',          '25000000-0000-0000-0000-0000000000aa/job-1.json'),
  -- and the four that must not be
  ('moments',          '25000000-0000-0000-0000-0000000000aa'),
  ('moments',          'shared/25000000-0000-0000-0000-0000000000aa/mom-2.jpg'),
  ('moments',          '25000000-0000-0000-0000-0000000000bb/mom-3.jpg'),
  ('0137-scratch',     '25000000-0000-0000-0000-0000000000aa/scratch.bin');

-- ── the guard ───────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ select * from public.gdpr_storage_footprint(public.gdpr_tombstone_profile_id()) $$,
  'P0001', 'refusing to erase the tombstone sentinel itself',
  'the sentinel itself is not swept');

-- ── the manifest ────────────────────────────────────────────────────────────────────────
-- No outer ORDER BY: the function's own ordering is part of the contract (erasure-job groups a
-- round into one remove() per bucket and relies on a deterministic page).
select results_eq(
  $$ select bucket_id, name
       from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa') $$,
  $$ values
       ('avatars',          '25000000-0000-0000-0000-0000000000aa/25000000-0000-0000-0000-0000000000aa.jpg'),
       ('candidacy-videos', '25000000-0000-0000-0000-0000000000aa/cand-1.mp4'),
       ('chat-media',       '25000000-0000-0000-0000-0000000000aa/conv-1/img-1.jpg'),
       ('exports',          '25000000-0000-0000-0000-0000000000aa/job-1.json'),
       ('moments',          '25000000-0000-0000-0000-0000000000aa/mom-1.jpg'),
       ('post-media',       '25000000-0000-0000-0000-0000000000aa/post-1/0.jpg'),
       ('story-segments',   '25000000-0000-0000-0000-0000000000aa/seg-1.mp4') $$,
  'the manifest is exactly one object per declared bucket, ordered by (bucket_id, name)');

-- Each exclusion named separately: a single results_eq that goes red says only "different",
-- and these four are four different bugs.
select is(
  (select count(*) from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa')
    where name = '25000000-0000-0000-0000-0000000000aa'),
  0::bigint, 'a key equal to the uuid with no separator is not the member''s folder');
select is(
  (select count(*) from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa')
    where name like '%mom-2%'),
  0::bigint, 'the prefix is ANCHORED — a key that merely contains the uuid is not listed');
select is(
  (select count(*) from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa')
    where name like '%bb/%'),
  0::bigint, 'another member''s folder is never listed');
select is(
  (select count(*) from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa')
    where bucket_id = '0137-scratch'),
  0::bigint,
  'a bucket outside the declared list is not swept — the IN list is the decision, '
  'not an unfiltered pass over storage.objects');

-- ── the page cap ────────────────────────────────────────────────────────────────────────
-- erasure-job re-lists until a round comes back empty, so the cap is what bounds one round.
select is(
  (select count(*)
     from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa', 2)),
  2::bigint, 'p_limit caps the page');
select is(
  (select count(*)
     from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa', 0)),
  1::bigint, 'a zero or negative p_limit still returns a row rather than looping forever');
select is(
  (select count(*)
     from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa', null)),
  7::bigint, 'a null p_limit falls back to the default page rather than returning nothing');

-- ── the retry property ──────────────────────────────────────────────────────────────────
-- The manifest derives from storage.objects, not from the rows that reference the keys, so the
-- gated (4b) cascade cannot take the key inputs away: a crash between the row half and the blob
-- half still surfaces every leftover on the next run.
delete from public.profiles where id = '25000000-0000-0000-0000-0000000000aa';
select is(
  (select count(*)
     from public.gdpr_storage_footprint('25000000-0000-0000-0000-0000000000aa')),
  7::bigint, 'the manifest survives the profile delete — bytes have no FK to the rows that named them');

select * from finish();
rollback;
