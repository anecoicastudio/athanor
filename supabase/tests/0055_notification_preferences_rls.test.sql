begin;
select plan(7);

select tests.create_supabase_user('pref_a');
select tests.create_supabase_user('pref_b');
select set_config('test.a', tests.get_supabase_uid('pref_a')::text, false);
select set_config('test.b', tests.get_supabase_uid('pref_b')::text, false);

select has_table('public', 'notification_preferences', 'table exists');

set local role anon;
select throws_ok($$ select * from public.notification_preferences $$, '42501', null, 'anon denied');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select lives_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel, enabled)
     values (current_setting('test.a')::uuid, 'moment', 'push', false) $$,
  'owner inserts own pref');

-- unique (profile_id,type,channel)
select throws_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel, enabled)
     values (current_setting('test.a')::uuid, 'moment', 'push', true) $$,
  '23505', null, 'duplicate (profile,type,channel) rejected');

-- non-owner cannot update someone else's pref (0 rows affected, not an error)
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select is(
  (with upd as (
     update public.notification_preferences set enabled = true
     where profile_id = current_setting('test.a')::uuid returning 1)
   select count(*)::int from upd),
  0, 'non-owner update affects 0 rows');

-- owner reads own only
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select is(
  (select count(*)::int from public.notification_preferences),
  1, 'owner sees only own prefs');

-- client DELETE denied (owner CRUD-minus-delete; hosted-revoke lockdown)
select throws_ok(
  $$ delete from public.notification_preferences where profile_id = current_setting('test.a')::uuid $$,
  '42501', null, 'client DELETE denied');

select * from finish();
rollback;
