begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- seed two users + a service-role-written notification for user_b
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'notif_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'notif_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);

-- schema + RLS present
select has_table('public', 'notifications', 'notifications table exists');
select policies_are('public', 'notifications',
  array['notifications_select_own', 'notifications_update_own_read'],
  'exactly the two expected policies');

-- service_role seeds a notification for user_b
set local role service_role;
insert into public.notifications (id, recipient_id, type, template_key, params)
values ('00000000-0000-0000-0000-0000000000b1', current_setting('test.b')::uuid,
        'moment', 'notif.tpl.moment', '{"name":"Marco"}'::jsonb);

-- anon cannot read
set local role anon;
select throws_ok($$ select * from public.notifications $$, '42501', null, 'anon read denied');

-- authenticated user_a CANNOT insert (fan-out/service-role only)
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select throws_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
     values (current_setting('test.a')::uuid, 'moment', 'notif.tpl.moment') $$,
  '42501', null, 'client INSERT denied — fan-out only');

-- user_a sees zero of user_b's notifications
select is(
  (select count(*)::int from public.notifications where recipient_id = current_setting('test.b')::uuid),
  0, 'recipient reads own only');

-- user_b can mark own read; cannot touch other columns
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select lives_ok(
  $$ update public.notifications set read_at = now()
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  'recipient marks own read');
select throws_ok(
  $$ update public.notifications set template_key = 'x'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501', null, 'non-read_at column UPDATE denied (column grant)');

-- client DELETE denied (no delete grant — fan-out/service-role only; hosted-revoke lockdown)
select throws_ok(
  $$ delete from public.notifications where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501', null, 'client DELETE denied');

-- zero aura side-effect (rule #1) — true global under service_role
set local role service_role;
select is((select count(*)::int from public.aura_events), 0,
  'no aura_events written by notification activity (rule #1)');

select * from finish();
rollback;
