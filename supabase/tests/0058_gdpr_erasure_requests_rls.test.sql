begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'erase_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'erase_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'erase_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'erase_d@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'erase_e@test.athanor', '{"locale":"it"}'::jsonb, now(), now());
-- ^ the last three are #717's claim-lease fixtures. They live up here with the rest because
--   auth.users is not writable by service_role, and that section runs as service_role.
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);
select set_config('test.c', '33333333-3333-3333-3333-333333333333', false);

select has_table('public', 'gdpr_erasure_requests', 'table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.gdpr_erasure_requests'::regclass),
  'RLS enabled');
select policies_are('public', 'gdpr_erasure_requests',
  array['gdpr_erasure_requests_select_own', 'gdpr_erasure_requests_insert_own'],
  'exactly the two own policies');

-- anon denied
set local role anon;
select throws_ok($$ select * from public.gdpr_erasure_requests $$, '42501', null, 'anon denied');

-- owner requests own erasure
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select lives_ok(
  $$ insert into public.gdpr_erasure_requests (profile_id) values (current_setting('test.a')::uuid) $$,
  'owner inserts a requested erasure');

-- cannot forge an erasure for ANOTHER profile
select throws_ok(
  $$ insert into public.gdpr_erasure_requests (profile_id) values (current_setting('test.b')::uuid) $$,
  '42501', null, 'cannot forge erasure for another profile');

-- no client UPDATE
select throws_ok(
  $$ update public.gdpr_erasure_requests set status = 'done'
     where profile_id = current_setting('test.a')::uuid $$,
  '42501', null, 'client UPDATE denied');

-- no client DELETE (deletion is exclusively the service-role cascade)
select throws_ok(
  $$ delete from public.gdpr_erasure_requests where profile_id = current_setting('test.a')::uuid $$,
  '42501', null, 'client DELETE denied');

-- reads own only
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select is(
  (select count(*)::int from public.gdpr_erasure_requests),
  0, 'user_b sees none of user_a''s requests');

-- rule #1: erasure path writes zero Aura (under service_role)
set local role service_role;
select is(
  (select count(*)::int from public.aura_events),
  0, 'erasure path writes zero Aura (rule #1)');

-- ── #515: 'partial' — the status the job no longer writes ───────────────────────────────────
-- It was added because the job ran irreversible work (session revoke, fund footprint erasure)
-- and then stopped at the legal gate, and recording that as 'failed' was the one thing it was
-- not: nothing had failed. #107 removed the gate — the cascade completes and a clean pass ends
-- 'done' — so the job now writes only 'done' or 'failed', and 'partial' survives for the rows
-- written before that, which R-8 §7.5 re-drives by hand.
--
-- The value therefore stays in the CHECK, and these still matter: a status the job stopped
-- writing must not become a status a CLIENT can write, and the rows carrying it must stay
-- readable. These assert the value exists, that the service role can write it, and — the half
-- that actually protects anyone — that a client still cannot.
select lives_ok(
  $$ update public.gdpr_erasure_requests set status = 'partial'
     where profile_id = current_setting('test.a')::uuid $$,
  'service role records a stop-short as partial');
select is(
  (select status from public.gdpr_erasure_requests
   where profile_id = current_setting('test.a')::uuid),
  'partial', 'the partial status is what the row now holds');
select throws_ok(
  $$ update public.gdpr_erasure_requests set status = 'nonsense'
     where profile_id = current_setting('test.a')::uuid $$,
  '23514', null, 'the status set stays closed — an unknown value is still rejected');
select ok(
  (select count(*) = 1 from pg_constraint
   where conrelid = 'public.gdpr_erasure_requests'::regclass
     and conname = 'gdpr_erasure_requests_status_check'
     and pg_get_constraintdef(oid) like '%''done''%'
     and pg_get_constraintdef(oid) like '%''partial''%'
     and pg_get_constraintdef(oid) like '%''failed''%'),
  'done, partial and failed are all in the closed status set');

-- widening the CHECK must NOT have widened the client write surface: a member may enqueue a
-- 'requested' row and nothing else, so 'partial' stays reachable only by the job.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select throws_ok(
  $$ insert into public.gdpr_erasure_requests (profile_id, status)
     values (current_setting('test.a')::uuid, 'partial') $$,
  '42501', null, 'a client cannot declare its own erasure partial');
reset role;

-- ── #717: the claim lease ───────────────────────────────────────────────────────────────────
-- The claim used to be a SELECT on `status = 'requested'` followed by an UPDATE carrying no
-- predicate at all. A pass torn down between them left the row on 'processing' with nothing in
-- the world still driving it, and nothing re-queued it: the request said «in progress» for ever.
-- Two overlapping passes also both selected the same rows and both drove the whole cascade.
--
-- claim_erasure_requests (20260908130546) replaces both statements with one. These assert the
-- PREDICATE itself rather than reading it back out of pg_get_functiondef — the difference
-- matters, because a mirror test passes for the wrong reason the moment the mirror drifts.
set local role service_role;

-- C: a plain 'requested' row — the arm that always worked.
insert into public.gdpr_erasure_requests (id, profile_id, status, created_at)
values ('c0000000-0000-0000-0000-0000000000c1', '33333333-3333-3333-3333-333333333333',
        'requested', now() - interval '5 hours');
-- D: 'processing' with a FRESH claim — a pass that is genuinely running.
insert into public.gdpr_erasure_requests (id, profile_id, status, claimed_at, created_at)
values ('d0000000-0000-0000-0000-0000000000d1', '44444444-4444-4444-4444-444444444444',
        'processing', now(), now() - interval '4 hours');
-- E: the collision 20260908085513 cannot prevent — a STALE 'processing' row and a 'requested'
--    one for the SAME member, because that index is partial on 'requested' only.
insert into public.gdpr_erasure_requests (id, profile_id, status, claimed_at, created_at)
values ('e0000000-0000-0000-0000-0000000000e1', '55555555-5555-5555-5555-555555555555',
        'processing', now() - interval '30 minutes', now() - interval '3 hours');
insert into public.gdpr_erasure_requests (id, profile_id, status, created_at)
values ('e0000000-0000-0000-0000-0000000000e2', '55555555-5555-5555-5555-555555555555',
        'requested', now() - interval '1 hour');
-- F: 'processing' with NO stamp at all — every row stranded before this migration existed.
insert into public.gdpr_erasure_requests (id, profile_id, status, created_at)
values ('f0000000-0000-0000-0000-0000000000f1', null, 'processing', now() - interval '9 hours');
-- G: a SECOND subject-less row. NULLs must not de-duplicate against each other: those rows are
--    the accountability trace (20260908073545) and a pass has to be able to close several.
insert into public.gdpr_erasure_requests (id, profile_id, status, created_at)
values ('f0000000-0000-0000-0000-0000000000f2', null, 'processing', now() - interval '8 hours');

create temp table claim_1 as
  select * from public.claim_erasure_requests(20, interval '15 minutes');

select is((select count(*)::int from claim_1 where id = 'c0000000-0000-0000-0000-0000000000c1'),
  1, 'a requested row is claimed');
select is((select count(*)::int from claim_1 where id = 'd0000000-0000-0000-0000-0000000000d1'),
  0, 'a LIVE claim is left alone — the lease has not run out');
select is((select count(*)::int from claim_1 where id = 'e0000000-0000-0000-0000-0000000000e1'),
  1, 'a STALE claim is re-taken — this is the stranded request #717 was filed for');
select is((select count(*)::int from claim_1 where id = 'f0000000-0000-0000-0000-0000000000f1'),
  1, 'a processing row with NO stamp is infinitely stale, not never stale');
select is((select count(*)::int from claim_1 where id = 'f0000000-0000-0000-0000-0000000000f2'),
  1, 'two subject-less rows do NOT de-duplicate against each other');
select is((select count(*)::int from claim_1 where profile_id = '55555555-5555-5555-5555-555555555555'),
  1, 'one row per member: the stale processing row, NOT its requested sibling as well');
select is((select count(*)::int from claim_1), 4,
  'and nothing else: four rows — not the live claim, not the deduplicated sibling');

-- The claim WROTE the transition. A caller that had to write 'processing' itself is the
-- read-then-write this replaced.
select is(
  (select status from public.gdpr_erasure_requests where id = 'c0000000-0000-0000-0000-0000000000c1'),
  'processing', 'the claim flips the status in the same statement that takes the row');
select isnt(
  (select claimed_at from public.gdpr_erasure_requests where id = 'c0000000-0000-0000-0000-0000000000c1'),
  null, 'and stamps claimed_at, which is what the next pass measures the lease against');
select is(
  (select status from public.gdpr_erasure_requests where id = 'e0000000-0000-0000-0000-0000000000e2'),
  'requested', 'the sibling it declined is untouched, not silently consumed');

-- A second claim gets nothing — including the SIBLING of the row the first one took, which is
-- the case the lease predicate alone has to carry. What this does NOT show is the concurrency
-- guard: pgTAP is one connection and one transaction, `pg_try_advisory_xact_lock` is re-entrant
-- within a transaction, and `now()` does not advance inside one. The zero below is the lease
-- predicate doing its job. The advisory lock is unprovable from here and is asserted instead by
-- 20260908133119's reasoning plus the `not exists` clause this exercises.
select is(
  (select count(*)::int from public.claim_erasure_requests(20, interval '15 minutes')),
  0, 'a second sequential claim takes NOTHING — the live claim and its sibling are both held');

-- p_lease is the ops override RELEASE-RUNBOOK §7.5 uses when the isolate is known to be dead.
update public.gdpr_erasure_requests set claimed_at = now() - interval '40 minutes'
 where claimed_at is not null;
select is(
  (select count(*)::int from public.claim_erasure_requests(1, interval '15 minutes')),
  1, 'p_limit bounds the batch');

-- Releasing the lease by hand is nulling the stamp — the procedure RELEASE-RUNBOOK §7.5 step 5
-- prescribes, and the reason it prescribes that rather than a zero-lease re-claim, which would
-- re-stamp the row and hide it from the pass the operator invokes next.
-- Two halves, or the assertion proves nothing: by this point D's stamp has been aged by the
-- p_limit step above, so a claim would reach it anyway. Make it LIVE first, show it is held,
-- then release it and show the very next claim takes it.
update public.gdpr_erasure_requests set claimed_at = now()
 where id = 'd0000000-0000-0000-0000-0000000000d1';
select is(
  (select count(*)::int from public.claim_erasure_requests(20, interval '15 minutes')
    where id = 'd0000000-0000-0000-0000-0000000000d1'),
  0, 'a fresh stamp holds the row against the claim');
update public.gdpr_erasure_requests set claimed_at = null
 where id = 'd0000000-0000-0000-0000-0000000000d1';
select is(
  (select count(*)::int from public.claim_erasure_requests(20, interval '15 minutes')
    where id = 'd0000000-0000-0000-0000-0000000000d1'),
  1, 'nulling claimed_at releases the lease: the next pass takes the row at once');

-- #717 review: the lease stamp is not a client's to write. The table grant is table-level, so
-- the new column inherited the INSERT privilege authenticated already had; 20260908133119 closes
-- it in the policy instead of with a column ACL, because 0121 pins how many tables carry one.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select throws_ok(
  $$ insert into public.gdpr_erasure_requests (profile_id, claimed_at)
     values (current_setting('test.c')::uuid, now()) $$,
  '42501', null, 'a client cannot supply its own lease stamp');
select lives_ok(
  $$ insert into public.gdpr_erasure_requests (profile_id)
     values (current_setting('test.c')::uuid) $$,
  'and the ordinary request, with no stamp, still goes in');
set local role service_role;

-- Asserted as a PRIVILEGE, not as a denied call: a behaviour test passes for the wrong reason
-- the moment something else happens to reject the statement, and 20260620140149's own header
-- records that on this schema new functions are born reachable by both client roles.
select ok(
  not has_function_privilege('anon', 'public.claim_erasure_requests(int, interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_erasure_requests(int, interval)', 'execute'),
  'neither client role may execute the claim');
select ok(
  has_function_privilege('service_role', 'public.claim_erasure_requests(int, interval)', 'execute'),
  'and the revoke did not take service_role''s EXECUTE with it');
reset role;

select * from finish();
rollback;
