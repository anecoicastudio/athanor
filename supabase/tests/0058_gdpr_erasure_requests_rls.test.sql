begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'erase_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'erase_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);

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

-- ── #515: 'partial' — a processed request that stopped at the legal gate ────────────────────
-- The job runs irreversible work (session revoke, fund footprint erasure) and then stops,
-- because deleting the account is gated on #184. It used to record that as 'failed', which is
-- the one thing it is not: nothing failed. These assert the value exists, that the service role
-- can write it, and — the half that actually protects anyone — that a client still cannot.
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

select * from finish();
rollback;
