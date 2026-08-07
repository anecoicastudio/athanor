-- Stale-reasons purge (migration 20260807201350): hiding a tag field deletes the
-- candidate's PENDING proposals, because `reasons` is a match-time snapshot that
-- names the raw tag keys and nothing ever refreshed it.
-- Proposals are inserted directly as service_role rather than via the matcher:
-- deterministic, and the matcher has its own coverage in 0028 / 0073.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000074','authenticated','authenticated','a74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000074','authenticated','authenticated','b74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000074','authenticated','authenticated','c74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000074','authenticated','authenticated','d74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000074','authenticated','authenticated','e74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-4000-8000-000000000074','authenticated','authenticated','f74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','abcdabcd-0000-4000-8000-000000000074','authenticated','authenticated','g74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','beefbeef-0000-4000-8000-000000000074','authenticated','authenticated','h74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cafecafe-0000-4000-8000-000000000074','authenticated','authenticated','i74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dadadada-0000-4000-8000-000000000074','authenticated','authenticated','j74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','faceface-0000-4000-8000-000000000074','authenticated','authenticated','k74@test.athanor','{}'::jsonb, now(), now());

set local role service_role;

-- A is the recipient for every row. The daily-cap unique is
-- (user_id, proposed_on, daily_rank), so each row gets its own proposed_on and
-- keeps daily_rank 1 — the assertions read the table directly, not the deck.
update public.profiles set handle = 'a74' where id = 'aaaaaaaa-0000-4000-8000-000000000074';
update public.profiles set handle = 'b74' where id = 'bbbbbbbb-0000-4000-8000-000000000074';
update public.profiles set handle = 'c74' where id = 'cccccccc-0000-4000-8000-000000000074';
update public.profiles set handle = 'd74' where id = 'dddddddd-0000-4000-8000-000000000074';
update public.profiles set handle = 'e74' where id = 'eeeeeeee-0000-4000-8000-000000000074';
update public.profiles set handle = 'f74' where id = 'ffffffff-0000-4000-8000-000000000074';
update public.profiles set handle = 'g74' where id = 'abcdabcd-0000-4000-8000-000000000074';

-- H is private BEFORE any proposal exists, so the later re-save is a no-op
-- transition rather than a flip (this is what assertion 8 pins).
update public.profiles set handle = 'h74', visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'beefbeef-0000-4000-8000-000000000074';
-- I carries tags that a reason names, and later drops one (the removal axis).
update public.profiles set handle = 'i74', identity_tags = array['design','music']
  where id = 'cafecafe-0000-4000-8000-000000000074';
-- J starts private and goes BACK to members — un-hiding must purge nothing.
update public.profiles set handle = 'j74', visibility = '{"seeking":"private"}'::jsonb
  where id = 'dadadada-0000-4000-8000-000000000074';
-- K is an accepted-row candidate who then hides: the row must survive with its
-- `reasons` blanked (they stay SELECTable but never render).
update public.profiles set handle = 'k74' where id = 'faceface-0000-4000-8000-000000000074';

-- `reasons` deliberately names a tag key, exactly as momento_reasons() authors it.
insert into public.momento_proposals
  (user_id, candidate_id, reasons, affinity, status, proposed_on, passed_until, daily_rank)
values
  ('aaaaaaaa-0000-4000-8000-000000000074','bbbbbbbb-0000-4000-8000-000000000074',
    array['Cerchi: music'], 2, 'pending',  current_date,     null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','cccccccc-0000-4000-8000-000000000074',
    array['Potrebbe cercare ciò che offri: design'], 2, 'pending', current_date - 1, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','dddddddd-0000-4000-8000-000000000074',
    array['Condividete: design'], 2, 'accepted', current_date - 2, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','eeeeeeee-0000-4000-8000-000000000074',
    array['Condividete: design'], 2, 'passed',   current_date - 3, current_date + 60, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','ffffffff-0000-4000-8000-000000000074',
    array['Condividete: design'], 2, 'pending',  current_date - 4, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','abcdabcd-0000-4000-8000-000000000074',
    array['Condividete: design'], 2, 'pending',  current_date - 5, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','beefbeef-0000-4000-8000-000000000074',
    array['Condividete: design'], 2, 'pending',  current_date - 6, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','cafecafe-0000-4000-8000-000000000074',
    array['Condividete: music'], 2, 'pending',  current_date - 7, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','dadadada-0000-4000-8000-000000000074',
    array['Condividete: design'], 2, 'pending',  current_date - 8, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000074','faceface-0000-4000-8000-000000000074',
    array['Cerchi: music'], 2, 'accepted', current_date - 9, null, 1),
  -- A is the RECIPIENT everywhere above; this row makes A a recipient whose own
  -- flip must not touch their deck (pins candidate_id scoping, not user_id).
  ('bbbbbbbb-0000-4000-8000-000000000074','aaaaaaaa-0000-4000-8000-000000000074',
    array['Condividete: design'], 2, 'pending',  current_date - 10, null, 1);

-- ── the flips ───────────────────────────────────────────────────────────────
update public.profiles set visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'bbbbbbbb-0000-4000-8000-000000000074';
update public.profiles set visibility = '{"seeking":"private"}'::jsonb
  where id = 'cccccccc-0000-4000-8000-000000000074';
update public.profiles set visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'dddddddd-0000-4000-8000-000000000074';
update public.profiles set visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'eeeeeeee-0000-4000-8000-000000000074';
-- F: a plain profile edit, visibility untouched.
update public.profiles set bio = 'una bio qualunque'
  where id = 'ffffffff-0000-4000-8000-000000000074';
-- G: a visibility change on an unrelated key.
update public.profiles set visibility = '{"bio":"private"}'::jsonb
  where id = 'abcdabcd-0000-4000-8000-000000000074';
-- H: re-save while ALREADY private — same value, so no transition.
update public.profiles set bio = 'ri-salvata', visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'beefbeef-0000-4000-8000-000000000074';
-- I: drops a tag instead of hiding it — the other way to un-say «music».
update public.profiles set identity_tags = array['design']
  where id = 'cafecafe-0000-4000-8000-000000000074';
-- J: private → members. Un-hiding must purge nothing.
update public.profiles set visibility = '{}'::jsonb
  where id = 'dadadada-0000-4000-8000-000000000074';
-- K: hides while holding an ACCEPTED row — survives, text blanked.
update public.profiles set visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'faceface-0000-4000-8000-000000000074';
-- A hides too. A is the RECIPIENT of everything above and the CANDIDATE of
-- exactly one row (B←A), so this separates the two axes: the row naming A must
-- go, A's own deck must not.
update public.profiles set visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'aaaaaaaa-0000-4000-8000-000000000074';

select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'bbbbbbbb-0000-4000-8000-000000000074'),
  0::bigint,
  'identity_tags → private purges the candidate''s pending proposal'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'cccccccc-0000-4000-8000-000000000074'),
  0::bigint,
  'seeking alone → private also purges (the single-field case affinity-0 misses)'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'dddddddd-0000-4000-8000-000000000074'),
  1::bigint,
  'an ACCEPTED proposal survives the flip (a conversation hangs off it)'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'eeeeeeee-0000-4000-8000-000000000074'),
  1::bigint,
  'a PASSED proposal survives the flip'
);
select is(
  (select passed_until from public.momento_proposals
    where candidate_id = 'eeeeeeee-0000-4000-8000-000000000074'),
  current_date + 60,
  'the passed row keeps its suppression window intact'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'ffffffff-0000-4000-8000-000000000074'),
  1::bigint,
  'a profile edit that does not touch visibility purges nothing'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'abcdabcd-0000-4000-8000-000000000074'),
  1::bigint,
  'a visibility change on an unrelated key purges nothing'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'beefbeef-0000-4000-8000-000000000074'),
  1::bigint,
  're-saving an already-private profile is not a transition — nothing purged'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'cafecafe-0000-4000-8000-000000000074'),
  0::bigint,
  'REMOVING a tag purges too — hiding is not the only way to un-say it'
);
select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'dadadada-0000-4000-8000-000000000074'),
  1::bigint,
  'private → members (un-hiding) purges nothing'
);
select is(
  (select reasons from public.momento_proposals
    where candidate_id = 'faceface-0000-4000-8000-000000000074'),
  '{}'::text[],
  'an accepted row survives but its reasons are blanked (still SELECTable, never rendered)'
);
select is(
  (select count(*) from public.momento_proposals
    where user_id = 'bbbbbbbb-0000-4000-8000-000000000074'
      and candidate_id = 'aaaaaaaa-0000-4000-8000-000000000074'),
  0::bigint,
  'the row naming A as CANDIDATE is purged when A hides'
);
select is(
  (select count(*) from public.momento_proposals
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000074'),
  7::bigint,
  'A''s own deck survives A''s own flip — the delete is scoped to candidate_id, not user_id'
);
reset role;

-- ── trigger + helper lockdown (0073 precedent) ──────────────────────────────
select trigger_is(
  'public', 'profiles', 'profiles_purge_momenti',
  'athanor', 'purge_stale_momento_proposals',
  'profiles UPDATE fires the purge trigger'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'athanor' and p.proname = 'purge_stale_momento_proposals'
      and p.prosecdef),
  1::bigint,
  'purge_stale_momento_proposals is SECURITY DEFINER (authenticated has no DELETE grant)'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'athanor' and p.proname = 'purge_stale_momento_proposals'
      and p.proconfig @> array['search_path=""']),
  1::bigint,
  'purge_stale_momento_proposals pins an empty search_path'
);
select ok(
  not has_function_privilege('authenticated', 'athanor.purge_stale_momento_proposals()', 'execute'),
  'authenticated cannot execute the purge helper directly'
);

select * from finish();
rollback;
