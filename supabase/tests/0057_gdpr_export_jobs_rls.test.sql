begin;
select plan(11);

select tests.create_supabase_user('gdpr_a');
select tests.create_supabase_user('gdpr_b');
select set_config('test.a', tests.get_supabase_uid('gdpr_a')::text, false);
select set_config('test.b', tests.get_supabase_uid('gdpr_b')::text, false);

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

select * from finish();
rollback;
