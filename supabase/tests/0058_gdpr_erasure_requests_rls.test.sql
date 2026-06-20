begin;
select plan(10);

select tests.create_supabase_user('erase_a');
select tests.create_supabase_user('erase_b');
select set_config('test.a', tests.get_supabase_uid('erase_a')::text, false);
select set_config('test.b', tests.get_supabase_uid('erase_b')::text, false);

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

select * from finish();
rollback;
