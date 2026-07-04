begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'verify_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'verify_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);

select has_table('public', 'verifications', 'table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.verifications'::regclass),
  'RLS enabled');
select policies_are('public', 'verifications',
  array['verifications_select_own'], 'exactly the select-own policy');

-- anon denied
set local role anon;
select throws_ok($$ select * from public.verifications $$, '42501', null, 'anon denied');

-- no client write: a user cannot mark themselves verified
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select throws_ok(
  $$ insert into public.verifications (profile_id, stripe_session_id, status)
     values (current_setting('test.a')::uuid, 'vs_forge', 'verified') $$,
  '42501', null, 'client INSERT denied');

-- service_role seeds a row so UPDATE/DELETE asserts target a REAL row (non-vacuous)
set local role service_role;
insert into public.verifications (profile_id, stripe_session_id, status)
  values (current_setting('test.a')::uuid, 'vs_seed_a', 'verified');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select throws_ok(
  $$ update public.verifications set status = 'verified' where stripe_session_id = 'vs_seed_a' $$,
  '42501', null, 'client UPDATE denied');
select throws_ok(
  $$ delete from public.verifications where stripe_session_id = 'vs_seed_a' $$,
  '42501', null, 'client DELETE denied');

-- profiles.identity_verified is NOT client-writable (column excluded from the m7 grant) — backstops the candidacy gate
select throws_ok(
  $$ update public.profiles set identity_verified = true where id = current_setting('test.a')::uuid $$,
  '42501', null, 'client cannot write profiles.identity_verified');

-- owner reads own; user_b sees none of user_a's sessions
select is(
  (select count(*)::int from public.verifications where stripe_session_id = 'vs_seed_a'),
  1, 'owner reads own verification');
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select is(
  (select count(*)::int from public.verifications),
  0, 'user_b sees none of user_a''s verifications');

-- service_role write + flip succeeds
set local role service_role;
select lives_ok(
  $$ update public.profiles set identity_verified = true where id = current_setting('test.a')::uuid $$,
  'service_role flips identity_verified');

-- rule #1: the verification path writes zero Aura (under service_role = true global)
select is(
  (select count(*)::int from public.aura_events),
  0, 'verification path writes zero Aura (rule #1)');

select * from finish();
rollback;
