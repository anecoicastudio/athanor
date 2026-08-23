-- #127 (20260823121933) — 'fundMilestone' is back in the closed notification type set.
--
-- SUPERSEDES the 2026-08-22 version of this file, which asserted the opposite (#241 had removed
-- the type, and 0129 asserted the rejection). Tests are not migrations: when the behaviour is
-- deliberately reversed the assertion is REPLACED, not appended to, because leaving a test that
-- contradicts the migration would either fail CI or — worse — pass and certify the old world.
-- The rename is part of that: a file called `_type_removed` asserting readmission is a trap for
-- the next reader.
--
-- #241's reasoning was sound at the time and is quoted in 20260822115759: the type was not
-- waiting on a producer but on a MECHANISM (fan-out-to-many) that did not exist. 20260823121933
-- builds the mechanism and 20260823121934 the two producers, so the type is reachable wiring now
-- rather than a widened set with nothing behind it.
--
-- Asserts: both CHECKs ADMIT it · the eight types that survived #241 are still admitted on both
-- tables · the set stays closed to an unknown value (readmitting one value must not open it).
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- fixture: one member (profile arrives via handle_new_user)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-2411-4111-8111-111111111111',
   'authenticated', 'authenticated', 'fund_notif_member@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select set_config('test.member', 'aaaaaaaa-2411-4111-8111-111111111111', false);

-- (A) the readmitted value is accepted on both tables
select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       values (current_setting('test.member')::uuid, 'fundMilestone', 'notif.tpl.fundMilestone') $$,
  'notifications_type_check admits fundMilestone again (#127)');
select lives_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel)
       values (current_setting('test.member')::uuid, 'fundMilestone', 'push') $$,
  'notification_preferences_type_check admits fundMilestone again (#127)');

-- (B) readmission took nothing away — the eight that survived #241 still insert
select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       select current_setting('test.member')::uuid, t, 'notif.tpl.generic'
         from unnest(array['moment','dreamMilestone','review','eventReminder',
                           'projectResponse','connection','moderation','gdprExport']) as t $$,
  'notifications still admits all 8 pre-existing types');
select lives_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel)
       select current_setting('test.member')::uuid, t, 'push'
         from unnest(array['moment','dreamMilestone','review','eventReminder',
                           'projectResponse','connection','moderation','gdprExport']) as t $$,
  'notification_preferences still admits all 8 pre-existing types');

-- (C) the set is still CLOSED, not merely wider. This is the assertion that makes readmission
-- safe: adding a value back must not turn the CHECK into a formality.
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
