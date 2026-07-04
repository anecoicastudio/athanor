begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pref_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pref_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);

select has_table('public', 'notification_preferences', 'table exists');

set local role anon;
select throws_ok($$ select * from public.notification_preferences $$, '42501', null, 'anon denied');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select lives_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel, enabled)
     values (current_setting('test.a')::uuid, 'moment', 'push', false) $$,
  'owner inserts own pref');

-- cannot insert a pref for ANOTHER profile (insert_own WITH CHECK pins profile_id=auth.uid())
select throws_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel, enabled)
     values (current_setting('test.b')::uuid, 'review', 'push', false) $$,
  '42501', null, 'cannot forge a pref for another profile');

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
