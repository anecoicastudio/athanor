-- #241 (20260822115759) — 'fundMilestone' has left the closed notification type set.
-- Asserts: both CHECKs now REJECT it · the eight surviving types are still admitted on both
-- tables · the set stays closed to an unknown value. Without this the narrowing is unasserted:
-- 0095 only covers 'gdprExport' being admitted, and nothing else names the type set.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- fixture: one member (profile arrives via handle_new_user)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-2411-4111-8111-111111111111',
   'authenticated', 'authenticated', 'fund_notif_member@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select set_config('test.member', 'aaaaaaaa-2411-4111-8111-111111111111', false);

-- (A) the removed value is rejected on both tables (23514 = check_violation)
select throws_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       values (current_setting('test.member')::uuid, 'fundMilestone', 'notif.tpl.generic') $$,
  '23514', null, 'notifications_type_check rejects fundMilestone');
select throws_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel)
       values (current_setting('test.member')::uuid, 'fundMilestone', 'push') $$,
  '23514', null, 'notification_preferences_type_check rejects fundMilestone');

-- (B) the narrowing took nothing else with it — all eight survivors still insert
select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       select current_setting('test.member')::uuid, t, 'notif.tpl.generic'
         from unnest(array['moment','dreamMilestone','review','eventReminder',
                           'projectResponse','connection','moderation','gdprExport']) as t $$,
  'notifications admits all 8 surviving types');
select lives_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel)
       select current_setting('test.member')::uuid, t, 'push'
         from unnest(array['moment','dreamMilestone','review','eventReminder',
                           'projectResponse','connection','moderation','gdprExport']) as t $$,
  'notification_preferences admits all 8 surviving types');

-- (C) the set is still closed, not merely shorter
select throws_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       values (current_setting('test.member')::uuid, 'somethingElse', 'notif.tpl.generic') $$,
  '23514', null, 'notifications type set stays closed');
select throws_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel)
       values (current_setting('test.member')::uuid, 'somethingElse', 'push') $$,
  '23514', null, 'notification_preferences type set stays closed');

select * from finish();
rollback;
