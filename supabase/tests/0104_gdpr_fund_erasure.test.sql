-- #240 — GDPR erasure reaches the fund tables (20260815131925).
-- Asserts the tombstone sentinel (exists, no PII, anon-invisible, service-role-only accessor),
-- the per-table policy's DB-visible effects (contributions repointed + aggregates recomputed
-- with the sentinel excluded, candidacy row + votes gone), and the storage-level half of
-- "no orphaned video object": the removal manifest gdpr_erase_fund_footprint returns is
-- exactly what exists under the erased member's candidacy-videos folder — and still is on a
-- retry, because it derives from storage.objects, not from the already-deleted rows. The
-- Storage-API removal itself is the erasure-job's half (deno-tested); like 0043, the sidecar
-- is out of scope here.

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- ── schema + sentinel ───────────────────────────────────────────────────────────────────
select has_function('public', 'gdpr_tombstone_profile_id', 'tombstone accessor exists');
select has_function(
  'public', 'gdpr_erase_fund_footprint', array['uuid'], 'fund erasure function exists');

select ok(
  exists(select 1 from public.profiles where id = public.gdpr_tombstone_profile_id()),
  'the sentinel profile row is pre-seeded');
select ok(
  (select handle is null and bio is null
     from public.profiles where id = public.gdpr_tombstone_profile_id()),
  'sentinel profile carries no PII (no handle, no bio)');
select ok(
  (select email is null and phone is null and encrypted_password = ''
     from auth.users where id = public.gdpr_tombstone_profile_id()),
  'sentinel auth.users row has no credential path (no email, no phone, empty hash)');
select is(
  (select visibility ->> 'identity'
     from public.profiles where id = public.gdpr_tombstone_profile_id()),
  'members',
  'sentinel opts out of the #251 anon-public identity shell');

-- ── privileges: both functions are service-role only ────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.gdpr_tombstone_profile_id()', 'execute'),
  'anon cannot execute gdpr_tombstone_profile_id');
select ok(
  not has_function_privilege('authenticated', 'public.gdpr_tombstone_profile_id()', 'execute'),
  'authenticated cannot execute gdpr_tombstone_profile_id');
select ok(
  not has_function_privilege('anon', 'public.gdpr_erase_fund_footprint(uuid)', 'execute'),
  'anon cannot execute gdpr_erase_fund_footprint');
select ok(
  not has_function_privilege('authenticated', 'public.gdpr_erase_fund_footprint(uuid)', 'execute'),
  'authenticated cannot execute gdpr_erase_fund_footprint');
select ok(
  has_function_privilege('service_role', 'public.gdpr_erase_fund_footprint(uuid)', 'execute'),
  'service_role can execute gdpr_erase_fund_footprint');

-- posture pins: erase is INVOKER (#145 — its only caller already holds every table);
-- recompute stays DEFINER exactly as 20260815120318 shipped it.
select ok(
  (select not p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gdpr_erase_fund_footprint'),
  'gdpr_erase_fund_footprint is SECURITY INVOKER');
select ok(
  (select p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recompute_fund_aggregate'),
  'recompute_fund_aggregate is still SECURITY DEFINER');

-- ── fixture ─────────────────────────────────────────────────────────────────────────────
-- A (…aa) is erased; B (…bb) stays. One edition; a candidacy each; B votes on A's candidacy,
-- A votes on B's. A contributed twice (500 cents), B once (100). Storage carries A's video +
-- poster, B's video, and an A object in a DIFFERENT bucket that the manifest must not touch.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'erased@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'stays@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- phase 'closed' on purpose: fund_editions_one_active allows a single non-closed edition, so
-- an active fixture would collide wherever a live edition already exists (the staging smoke).
-- Nothing in this test reads the phase — the erasure reach must work on any edition's rows.
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('24000000-0000-0000-0000-0000000000ed', now() + interval '30 days', 5000000, 'closed', 'realized', false, false,
          100000, 3, 3, 10, 'fixture costs statement', 'none');
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('24000000-0000-0000-0000-0000000000c1', '24000000-0000-0000-0000-0000000000ed',
   '24000000-0000-0000-0000-0000000000aa', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted'),
  ('24000000-0000-0000-0000-0000000000c2', '24000000-0000-0000-0000-0000000000ed',
   '24000000-0000-0000-0000-0000000000bb', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted');

-- weight omitted: the snapshot trigger owns it (42501 on any client-supplied value).
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id) values
  ('24000000-0000-0000-0000-0000000000ed', '24000000-0000-0000-0000-0000000000c1',
   '24000000-0000-0000-0000-0000000000bb'),
  ('24000000-0000-0000-0000-0000000000ed', '24000000-0000-0000-0000-0000000000c2',
   '24000000-0000-0000-0000-0000000000aa');

insert into public.fund_contributions
  (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
values
  ('24000000-0000-0000-0000-0000000000ed', '24000000-0000-0000-0000-0000000000aa', 200, 'cs_0104_a1', 'succeeded'),
  ('24000000-0000-0000-0000-0000000000ed', '24000000-0000-0000-0000-0000000000aa', 300, 'cs_0104_a2', 'succeeded'),
  ('24000000-0000-0000-0000-0000000000ed', '24000000-0000-0000-0000-0000000000bb', 100, 'cs_0104_b1', 'succeeded');

insert into storage.objects (bucket_id, name) values
  ('candidacy-videos', '24000000-0000-0000-0000-0000000000aa/24000000-0000-0000-0000-0000000000c1.mp4'),
  ('candidacy-videos', '24000000-0000-0000-0000-0000000000aa/24000000-0000-0000-0000-0000000000c1-thumb.jpg'),
  ('candidacy-videos', '24000000-0000-0000-0000-0000000000bb/24000000-0000-0000-0000-0000000000c2.mp4'),
  ('avatars',          '24000000-0000-0000-0000-0000000000aa/24000000-0000-0000-0000-0000000000aa.jpg');

-- ── before: the sentinel exclusion is invisible while every contributor is live ─────────
select public.recompute_fund_aggregate('24000000-0000-0000-0000-0000000000ed');
select is(
  (select contributor_count from public.fund_aggregates
    where edition_id = '24000000-0000-0000-0000-0000000000ed'),
  2::bigint, 'pre-erasure contributor_count counts both live members');
select is(
  (select raised_cents from public.fund_aggregates
    where edition_id = '24000000-0000-0000-0000-0000000000ed'),
  600::bigint, 'pre-erasure raised_cents sums every succeeded contribution');

-- ── guards ──────────────────────────────────────────────────────────────────────────────
-- #378's RESTRICT is what makes reassignment mandatory: the profile cannot go while money
-- rows still point at it.
select throws_ok(
  $$ delete from public.profiles where id = '24000000-0000-0000-0000-0000000000aa' $$,
  '23503', null,
  'a profile with fund_contributions cannot be deleted before the reach runs (RESTRICT)');
select throws_ok(
  $$ select * from public.gdpr_erase_fund_footprint(public.gdpr_tombstone_profile_id()) $$,
  'P0001', 'refusing to erase the tombstone sentinel itself',
  'the sentinel itself is not erasable');

-- ── the reach ───────────────────────────────────────────────────────────────────────────
-- The manifest is exactly A's candidacy-videos folder: video + poster, not B's object, not
-- A's avatar in another bucket.
select results_eq(
  $$ select bucket_id, name
       from public.gdpr_erase_fund_footprint('24000000-0000-0000-0000-0000000000aa')
      order by name $$,
  $$ values
       ('candidacy-videos', '24000000-0000-0000-0000-0000000000aa/24000000-0000-0000-0000-0000000000c1-thumb.jpg'),
       ('candidacy-videos', '24000000-0000-0000-0000-0000000000aa/24000000-0000-0000-0000-0000000000c1.mp4') $$,
  'manifest lists exactly the erased member''s candidacy-videos objects');

-- contributions: retained, repointed, none left behind.
select is(
  (select count(*) from public.fund_contributions
    where profile_id = public.gdpr_tombstone_profile_id()),
  2::bigint, 'both erased contributions survive, repointed at the sentinel');
select is(
  (select count(*) from public.fund_contributions
    where profile_id = '24000000-0000-0000-0000-0000000000aa'),
  0::bigint, 'no contribution still points at the erased profile');

-- candidacies + votes: gone, and only theirs.
select ok(
  not exists(select 1 from public.dream_candidacies
              where id = '24000000-0000-0000-0000-0000000000c1'),
  'the erased member''s candidacy row is deleted');
select ok(
  exists(select 1 from public.dream_candidacies
          where id = '24000000-0000-0000-0000-0000000000c2'),
  'the other member''s candidacy is untouched');
select is(
  (select count(*) from public.candidacy_votes
    where candidacy_id = '24000000-0000-0000-0000-0000000000c1'),
  0::bigint, 'votes cast on the erased candidacy cascaded away');
select is(
  (select count(*) from public.candidacy_votes
    where voter_id = '24000000-0000-0000-0000-0000000000aa'),
  0::bigint, 'the erased member''s own votes are deleted');

-- aggregates: recomputed inside the reach — the sentinel is not a contributor, the money stays.
select is(
  (select contributor_count from public.fund_aggregates
    where edition_id = '24000000-0000-0000-0000-0000000000ed'),
  1::bigint, 'post-erasure contributor_count excludes the sentinel (identifiable members only)');
select is(
  (select raised_cents from public.fund_aggregates
    where edition_id = '24000000-0000-0000-0000-0000000000ed'),
  600::bigint, 'post-erasure raised_cents keeps the erased member''s money (D50 retention)');

-- the profile is now deletable: the reach cleared every RESTRICT edge the gated (4b) cascade
-- will hit.
select lives_ok(
  $$ delete from public.profiles where id = '24000000-0000-0000-0000-0000000000aa' $$,
  'after the reach, the profile delete the gated cascade performs succeeds');

-- retry property: rows are gone, but the manifest re-derives from storage.objects — a crash
-- between the row half and the blob half still surfaces the leftovers next run.
select results_eq(
  $$ select bucket_id, name
       from public.gdpr_erase_fund_footprint('24000000-0000-0000-0000-0000000000aa')
      order by name $$,
  $$ values
       ('candidacy-videos', '24000000-0000-0000-0000-0000000000aa/24000000-0000-0000-0000-0000000000c1-thumb.jpg'),
       ('candidacy-videos', '24000000-0000-0000-0000-0000000000aa/24000000-0000-0000-0000-0000000000c1.mp4') $$,
  'a re-run still lists un-removed blobs (idempotent, no orphan survives a crash)');

select * from finish();
rollback;
