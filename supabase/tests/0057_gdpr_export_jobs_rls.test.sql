begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Every auth.users insert lives HERE, at the top, with the others: the #721 claim section below
-- runs as service_role, which cannot write auth.users (the trap 0058:17-18 records).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'gdpr_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'gdpr_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'gdpr_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'gdpr_d@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'gdpr_e@test.athanor', '{"locale":"it"}'::jsonb, now(), now());
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);
select set_config('test.c', '33333333-3333-3333-3333-333333333333', false);

select has_table('public', 'gdpr_export_jobs', 'table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.gdpr_export_jobs'::regclass),
  'RLS enabled');
select policies_are('public', 'gdpr_export_jobs',
  array['gdpr_export_jobs_select_own', 'gdpr_export_jobs_insert_own'],
  'exactly the two own policies');

-- anon fully denied
set local role anon;
select throws_ok($$ select * from public.gdpr_export_jobs $$, '42501', null, 'anon denied');

-- owner requests own (status defaults to 'requested')
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select lives_ok(
  $$ insert into public.gdpr_export_jobs (profile_id) values (current_setting('test.a')::uuid) $$,
  'owner inserts a requested export job');

-- cannot pre-set ready/url (insert_own WITH CHECK pins status + nulls)
select throws_ok(
  $$ insert into public.gdpr_export_jobs (profile_id, status, download_url)
     values (current_setting('test.a')::uuid, 'ready', 'https://x') $$,
  '42501', null, 'cannot pre-set ready/url');

-- cannot forge a job for ANOTHER profile
select throws_ok(
  $$ insert into public.gdpr_export_jobs (profile_id) values (current_setting('test.b')::uuid) $$,
  '42501', null, 'cannot forge export job for another profile');

-- no client UPDATE (no UPDATE grant → 42501)
select throws_ok(
  $$ update public.gdpr_export_jobs set status = 'ready'
     where profile_id = current_setting('test.a')::uuid $$,
  '42501', null, 'client UPDATE denied (backend sets status)');

-- reads own only
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select is(
  (select count(*)::int from public.gdpr_export_jobs),
  0, 'user_b sees none of user_a''s jobs');

-- 30-day expiry cap (service_role insert beyond 30d → check violation)
set local role service_role;
select throws_ok(
  $$ insert into public.gdpr_export_jobs (profile_id, expires_at)
     values (current_setting('test.a')::uuid, now() + interval '40 days') $$,
  '23514', null, '30-day expiry cap enforced');

-- rule #1: export path writes zero Aura (true global under service_role)
select is(
  (select count(*)::int from public.aura_events),
  0, 'export path writes zero Aura (rule #1)');

-- ── #721: the fourth status ─────────────────────────────────────────────────────────────────
-- gdpr_export_jobs had no failure value at all, so a job that genuinely could not be served had
-- nowhere to say so. That is why the lease alone would not have been enough: a stranded row would
-- have become a row re-claimed, rebuilt and rejected every night instead.
select lives_ok(
  $$ update public.gdpr_export_jobs set status = 'failed'
      where profile_id = current_setting('test.a')::uuid $$,
  '''failed'' is a legal status');
select throws_ok(
  $$ update public.gdpr_export_jobs set status = 'partial'
      where profile_id = current_setting('test.a')::uuid $$,
  '23514', null, 'and the domain is still closed — an unknown status is rejected');
-- put it back: the claim assertions below count this row.
update public.gdpr_export_jobs set status = 'requested'
 where profile_id = current_setting('test.a')::uuid;

-- ── #721: the claim lease ───────────────────────────────────────────────────────────────────
-- The claim used to be a SELECT on `status = 'requested'` followed by an UPDATE carrying no
-- predicate at all. A pass torn down between them left the row on 'processing' with nothing in the
-- world still driving it; two overlapping passes both built, uploaded and signed the same archive.
--
-- claim_export_jobs (20260908152740) replaces both statements with one. These assert the PREDICATE
-- itself rather than reading it back out of pg_get_functiondef — the difference matters, because a
-- mirror test passes for the wrong reason the moment the mirror drifts.

-- C1: a plain 'requested' row — the arm that always worked.
insert into public.gdpr_export_jobs (id, profile_id, status, created_at)
values ('c0000000-0000-0000-0000-0000000000c1', current_setting('test.c')::uuid,
        'requested', now() - interval '5 hours');
-- C2/C3: terminal rows. Neither is ever re-claimed: a member who wants another archive files a
-- new request, and 'failed' in particular must not loop.
insert into public.gdpr_export_jobs (id, profile_id, status, created_at)
values ('c0000000-0000-0000-0000-0000000000c2', current_setting('test.c')::uuid,
        'ready', now() - interval '10 days'),
       ('c0000000-0000-0000-0000-0000000000c3', current_setting('test.c')::uuid,
        'failed', now() - interval '9 days');
-- D1: 'processing' with a FRESH claim — a pass that is genuinely running.
insert into public.gdpr_export_jobs (id, profile_id, status, claimed_at, created_at)
values ('d0000000-0000-0000-0000-0000000000d1', '44444444-4444-4444-4444-444444444444',
        'processing', now(), now() - interval '4 hours');
-- E1/E2: a STALE 'processing' row and a 'requested' one for the SAME member. Unlike erasure
-- (0058), BOTH are claimed: exports are idempotent — the upload upserts on {profile}/{job}.json —
-- so two jobs for one member are two archives, not the double-drive claim_erasure_requests
-- de-duplicates against.
insert into public.gdpr_export_jobs (id, profile_id, status, claimed_at, created_at)
values ('e0000000-0000-0000-0000-0000000000e1', '55555555-5555-5555-5555-555555555555',
        'processing', now() - interval '30 minutes', now() - interval '3 hours');
insert into public.gdpr_export_jobs (id, profile_id, status, created_at)
values ('e0000000-0000-0000-0000-0000000000e2', '55555555-5555-5555-5555-555555555555',
        'requested', now() - interval '1 hour');
-- F1: 'processing' with NO stamp at all — every row stranded before this migration existed.
insert into public.gdpr_export_jobs (id, profile_id, status, created_at)
values ('f0000000-0000-0000-0000-0000000000f1', current_setting('test.b')::uuid,
        'processing', now() - interval '9 hours');

create temp table export_claim_1 as
  select * from public.claim_export_jobs(20, interval '15 minutes');

select is((select count(*)::int from export_claim_1 where id = 'c0000000-0000-0000-0000-0000000000c1'),
  1, 'a requested row is claimed');
select is((select count(*)::int from export_claim_1 where id = 'c0000000-0000-0000-0000-0000000000c2'),
  0, 'a ready row is terminal — never re-claimed');
select is((select count(*)::int from export_claim_1 where id = 'c0000000-0000-0000-0000-0000000000c3'),
  0, 'and neither is a failed one, or the fix would loop the job it just failed');
select is((select count(*)::int from export_claim_1 where id = 'd0000000-0000-0000-0000-0000000000d1'),
  0, 'a LIVE claim is left alone — the lease has not run out');
select is((select count(*)::int from export_claim_1 where id = 'e0000000-0000-0000-0000-0000000000e1'),
  1, 'a STALE claim is re-taken — this is the stranded job #721 was filed for');
select is((select count(*)::int from export_claim_1 where id = 'f0000000-0000-0000-0000-0000000000f1'),
  1, 'a processing row with NO stamp is infinitely stale, not never stale');
select is((select count(*)::int from export_claim_1
            where profile_id = '55555555-5555-5555-5555-555555555555'),
  2, 'BOTH of one member''s open jobs are claimed: an export is idempotent, unlike an erasure');
select is((select count(*)::int from export_claim_1), 5,
  'and nothing else: five rows — not the live claim, not either terminal row');

-- The claim WROTE the transition. A caller that had to write 'processing' itself is the
-- read-then-write this replaced.
select is(
  (select status from public.gdpr_export_jobs where id = 'c0000000-0000-0000-0000-0000000000c1'),
  'processing', 'the claim flips the status in the same statement that takes the row');
select isnt(
  (select claimed_at from public.gdpr_export_jobs where id = 'c0000000-0000-0000-0000-0000000000c1'),
  null, 'and stamps claimed_at, which is what the next pass measures the lease against');
-- created_at rides back with the claim because the LOOP fences on it: `expires_at <= created_at +
-- interval '30 days'` leaves no room for a 72h signed link once the job is older than 27 days, so
-- such a job is filed 'failed' instead of being rebuilt and rejected nightly.
select is(
  (select created_at from export_claim_1 where id = 'c0000000-0000-0000-0000-0000000000c1'),
  (select created_at from public.gdpr_export_jobs where id = 'c0000000-0000-0000-0000-0000000000c1'),
  'the claim hands back created_at, the age the loop measures the 30-day cap against');

-- A second claim gets nothing. What this does NOT show is concurrency: pgTAP is one connection and
-- one transaction and `now()` does not advance inside one, so the zero below is the lease predicate
-- doing its job, not mutual exclusion. Mutual exclusion here rests on `for update skip locked`
-- alone (20260908152740) and cannot be exercised from a single session.
select is(
  (select count(*)::int from public.claim_export_jobs(20, interval '15 minutes')),
  0, 'a second sequential claim takes NOTHING — every open row is now held');

-- p_lease is the ops override RELEASE-RUNBOOK §7.6 reaches for when the isolate is known dead.
update public.gdpr_export_jobs set claimed_at = now() - interval '40 minutes'
 where claimed_at is not null;
select is(
  (select count(*)::int from public.claim_export_jobs(1, interval '15 minutes')),
  1, 'p_limit bounds the batch');

-- Releasing a lease by hand is nulling the stamp — the procedure §7.6 prescribes, and the reason
-- it prescribes that rather than a zero-lease re-claim, which re-stamps the row and hides it from
-- the pass the operator invokes next. Two halves, or the assertion proves nothing: make the row
-- LIVE first, show it is held, then release it and show the very next claim takes it.
update public.gdpr_export_jobs set claimed_at = now()
 where id = 'd0000000-0000-0000-0000-0000000000d1';
select is(
  (select count(*)::int from public.claim_export_jobs(20, interval '15 minutes')
    where id = 'd0000000-0000-0000-0000-0000000000d1'),
  0, 'a fresh stamp holds the row against the claim');
update public.gdpr_export_jobs set claimed_at = null
 where id = 'd0000000-0000-0000-0000-0000000000d1';
select is(
  (select count(*)::int from public.claim_export_jobs(20, interval '15 minutes')
    where id = 'd0000000-0000-0000-0000-0000000000d1'),
  1, 'nulling claimed_at releases the lease: the next pass takes the row at once');

-- The lease stamp is not a client's to write. The table grant is table-level, so the new column
-- inherited the INSERT privilege authenticated already had; 20260908152740 closes it in the policy
-- instead of with a column ACL, because 0121 pins how many tables carry one.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select throws_ok(
  $$ insert into public.gdpr_export_jobs (profile_id, claimed_at)
     values (current_setting('test.c')::uuid, now()) $$,
  '42501', null, 'a client cannot supply its own lease stamp');
select lives_ok(
  $$ insert into public.gdpr_export_jobs (profile_id)
     values (current_setting('test.c')::uuid) $$,
  'and the ordinary request, with no stamp, still goes in');
set local role service_role;

-- Asserted as a PRIVILEGE, not as a denied call: a behaviour test passes for the wrong reason the
-- moment something else happens to reject the statement, and on this schema new functions are born
-- reachable by both client roles (#409).
select ok(
  not has_function_privilege('anon', 'public.claim_export_jobs(int, interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_export_jobs(int, interval)', 'execute'),
  'neither client role may execute the claim');
select ok(
  has_function_privilege('service_role', 'public.claim_export_jobs(int, interval)', 'execute'),
  'and the revoke did not take service_role''s EXECUTE with it');
reset role;

select * from finish();
rollback;
