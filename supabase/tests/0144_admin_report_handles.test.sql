-- 0144_admin_report_handles.test.sql
-- #664 — the moderation panel names a report's parties when the admin is a blocked pair with them.
--
-- athanor.not_blocked is symmetric, so profiles_select_authenticated hides a member's row from
-- an admin who blocked them or was blocked by them. The queue's reporter embed came back NULL,
-- and so did the direct reads that named a person report's TARGET and a message report's
-- SENDER. The fix is a DEFINER channel, public.admin_report_handles(uuid[]), gated on
-- athanor.is_admin() inside — the policy is NOT widened (#97: the admin read path reaches
-- reported content only). Five things have to hold at once:
--
--   1. An admin resolves the reporter's handle through the channel in BOTH block directions,
--      and still cannot read those profiles rows directly (0050 holds).
--   2. The subject resolves the same way: a person target, a message sender — and nothing for
--      a post or behavior report, or a message that no longer exists.
--   3. A non-admin member holding EXECUTE gets 42501, never a handle; anon holds no EXECUTE.
--   4. The channel answers only the ids it was asked for — two handles, nothing else about
--      either party, no row for a report the caller did not name.
--   5. A banned party still names (the policy already shows banned members to an admin), and
--      the cap and the null array behave as declared.
--
-- CI-only (hosted lacks pgtap); smoked on staging via `db query --linked` before the push.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
-- A is the admin (role from app_metadata in the JWT, never a profile flag). Reporters: B (A
-- blocked B), C (C blocked A), D (nobody blocked anybody), E (banned after reporting). T is
-- the person B, C, D and E report — and A blocked T too. S sends a message in a conversation
-- with D; S blocked A; D reports the message.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1440000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'rh_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1440000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'rh_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1440000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'rh_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1440000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'rh_d@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1440000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'rh_e@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f1440000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'rh_t@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2440000-0000-4000-8000-000000000007',
   'authenticated', 'authenticated', 'rh_s@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

set local role service_role;
update public.profiles set handle = 'rh_admin'  where id = 'a1440000-0000-4000-8000-000000000001';
update public.profiles set handle = 'rh_bea'    where id = 'b1440000-0000-4000-8000-000000000002';
update public.profiles set handle = 'rh_carla'  where id = 'c1440000-0000-4000-8000-000000000003';
update public.profiles set handle = 'rh_dino'   where id = 'd1440000-0000-4000-8000-000000000004';
update public.profiles set handle = 'rh_enzo'   where id = 'e1440000-0000-4000-8000-000000000005';
update public.profiles set handle = 'rh_target' where id = 'f1440000-0000-4000-8000-000000000006';
update public.profiles set handle = 'rh_sender' where id = 'a2440000-0000-4000-8000-000000000007';

insert into public.blocks (blocker_id, blocked_id) values
  ('a1440000-0000-4000-8000-000000000001', 'b1440000-0000-4000-8000-000000000002'), -- admin blocks B
  ('c1440000-0000-4000-8000-000000000003', 'a1440000-0000-4000-8000-000000000001'), -- C blocks admin
  ('a1440000-0000-4000-8000-000000000001', 'f1440000-0000-4000-8000-000000000006'), -- admin blocks T
  ('a2440000-0000-4000-8000-000000000007', 'a1440000-0000-4000-8000-000000000001'); -- S blocks admin

select set_config('test.conv', public.create_conversation_pair(
  'a2440000-0000-4000-8000-000000000007', 'd1440000-0000-4000-8000-000000000004', 'direct')::text, true);
insert into public.messages (id, conversation_id, sender_id, kind, body, media_url) values
  ('bb440000-0000-4000-8000-000000000001', current_setting('test.conv')::uuid,
   'a2440000-0000-4000-8000-000000000007', 'user', 'parole segnalate', null);

insert into public.reports (id, reporter_id, target_type, target_id, category, note) values
  ('11440000-0000-4000-8000-00000000000b', 'b1440000-0000-4000-8000-000000000002',
   'person', 'f1440000-0000-4000-8000-000000000006', 'harassment', 'segnalazione b'),
  ('11440000-0000-4000-8000-00000000000c', 'c1440000-0000-4000-8000-000000000003',
   'person', 'f1440000-0000-4000-8000-000000000006', 'harassment', 'segnalazione c'),
  ('11440000-0000-4000-8000-00000000000d', 'd1440000-0000-4000-8000-000000000004',
   'person', 'f1440000-0000-4000-8000-000000000006', 'spam', 'segnalazione d'),
  ('11440000-0000-4000-8000-00000000000e', 'e1440000-0000-4000-8000-000000000005',
   'person', 'f1440000-0000-4000-8000-000000000006', 'spam', 'segnalazione e'),
  -- D reports S's message; a post report; a message report whose message is gone.
  ('11440000-0000-4000-8000-00000000001a', 'd1440000-0000-4000-8000-000000000004',
   'message', 'bb440000-0000-4000-8000-000000000001', 'harassment', 'queste parole'),
  ('11440000-0000-4000-8000-00000000001b', 'd1440000-0000-4000-8000-000000000004',
   'post', 'ee440000-0000-4000-8000-000000000001', 'spam', 'un post'),
  ('11440000-0000-4000-8000-00000000001c', 'd1440000-0000-4000-8000-000000000004',
   'message', 'bb440000-0000-4000-8000-0000000000ff', 'spam', 'messaggio cancellato');

update public.profiles set banned_at = now() where id = 'e1440000-0000-4000-8000-000000000005';
reset role;

-- ── 1. shape and posture ──────────────────────────────────────────────────────────────────
select has_function('public', 'admin_report_handles', array['uuid[]'],
  'S1 public.admin_report_handles(uuid[]) exists');
select is_definer('public', 'admin_report_handles', array['uuid[]'],
  'S2 admin_report_handles is SECURITY DEFINER — it reads through the symmetric profiles policy');
select is(
  pg_get_function_result('public.admin_report_handles(uuid[])'::regprocedure),
  'TABLE(report_id uuid, reporter_handle text, subject_handle text)',
  'S3 the channel projects two handles and nothing else about either party');
select ok(not has_function_privilege('anon', 'public.admin_report_handles(uuid[])', 'execute'),
  'S4 anon cannot execute admin_report_handles (#409: the f default would have granted it)');
select ok(not has_function_privilege('public', 'public.admin_report_handles(uuid[])', 'execute'),
  'S5 PUBLIC cannot execute admin_report_handles (0121 pins that surface by name)');
select ok(has_function_privilege('authenticated', 'public.admin_report_handles(uuid[])', 'execute'),
  'S6 authenticated can execute it — the panel calls it as the signed-in admin');

-- The denominator: the policy was NOT widened. Its text still leads with not_blocked and no
-- admin escape around it — the fix #97 excluded.
select is(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_authenticated'),
  '(athanor.not_blocked(id) AND (athanor.not_banned(id) OR athanor.is_admin()))',
  'S7 profiles_select_authenticated is unchanged — not_blocked(id) has no admin escape (the policy option was not taken)');

set local role anon;
select throws_ok(
  $$ select * from public.admin_report_handles(array['11440000-0000-4000-8000-00000000000b']::uuid[]) $$,
  '42501',
  null,
  'S8 anon calling the channel is denied, not empty');
reset role;

-- ── 2. a non-admin member holding EXECUTE ─────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1440000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select * from public.admin_report_handles(array['11440000-0000-4000-8000-00000000000d']::uuid[]) $$,
  '42501',
  'not authorized',
  'N1 a non-admin member holding EXECUTE is refused inside the function — even for their own report');

-- ── 3. the admin, in both block directions ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a1440000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

-- The bug, restated as the denominator: the policy still hides every blocked party.
select is((select count(*)::int from public.profiles where id = 'b1440000-0000-4000-8000-000000000002'), 0,
  'A1 the admin still cannot read the profile of a reporter they blocked (0050 holds, admin side)');
select is((select count(*)::int from public.profiles where id = 'c1440000-0000-4000-8000-000000000003'), 0,
  'A2 the admin still cannot read the profile of a reporter who blocked them (0050 holds, other side)');
select is((select count(*)::int from public.profiles where id = 'f1440000-0000-4000-8000-000000000006'), 0,
  'A3 the admin still cannot read the profile of a target they blocked — the direct read this replaces was NULL too');
select is((select count(*)::int from public.reports where id = '11440000-0000-4000-8000-00000000000b'), 1,
  'A4 the report itself is admin-readable (reports_select_admin) — only its attribution was lost');

-- The channel names both reporters.
select is(
  (select reporter_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000000b']::uuid[])),
  'rh_bea',
  'A5 the handle of a reporter the admin blocked resolves through the channel (#664)');
select is(
  (select reporter_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000000c']::uuid[])),
  'rh_carla',
  'A6 the handle of a reporter who blocked the admin resolves too — not_blocked is symmetric, so is the fix');
select is(
  (select reporter_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000000d']::uuid[])),
  'rh_dino',
  'A7 an unblocked reporter resolves exactly as the embed did');

-- One call, the whole page: the queue passes every id it holds.
select results_eq(
  $$ select report_id, reporter_handle, subject_handle from public.admin_report_handles(array[
       '11440000-0000-4000-8000-00000000000b',
       '11440000-0000-4000-8000-00000000000c',
       '11440000-0000-4000-8000-00000000000d']::uuid[]) order by report_id $$,
  $$ values ('11440000-0000-4000-8000-00000000000b'::uuid, 'rh_bea'::text,   'rh_target'::text),
            ('11440000-0000-4000-8000-00000000000c'::uuid, 'rh_carla'::text, 'rh_target'::text),
            ('11440000-0000-4000-8000-00000000000d'::uuid, 'rh_dino'::text,  'rh_target'::text) $$,
  'A8 a batch resolves every id in one call — one round trip per queue page');

-- Only what was asked: an unknown id yields no row, and a known one is never returned unasked.
select is(
  (select count(*)::int from public.admin_report_handles(
     array['11440000-0000-4000-8000-0000000000ff']::uuid[])),
  0,
  'A9 an id that names no report yields no row — the channel never invents attribution');
select is(
  (select count(*)::int from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000000d']::uuid[])),
  1,
  'A10 a one-id call returns one row — never the whole queue');

-- ── 4. the subject ────────────────────────────────────────────────────────────────────────
select is(
  (select subject_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000000b']::uuid[])),
  'rh_target',
  'U1 a person report names its target through the channel even though the admin blocked them');
select is(
  (select subject_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000001a']::uuid[])),
  'rh_sender',
  'U2 a message report names the SENDER — the person resolve_report v5 lands the verdict on — though the sender blocked the admin');
select is(
  (select subject_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000001b']::uuid[])),
  null,
  'U3 a post report has no subject handle — the panel never named one, and this is a fix, not a feature');
select is(
  (select subject_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000001c']::uuid[])),
  null,
  'U4 a message report whose message is gone has no subject handle — the same absence readReportedMessage reports');

-- ── 5. the edges the body declares ────────────────────────────────────────────────────────
select is(
  (select reporter_handle from public.admin_report_handles(
     array['11440000-0000-4000-8000-00000000000e']::uuid[])),
  'rh_enzo',
  'E1 a banned reporter still names — the policy already showed banned members to an admin, the channel keeps that');
select is(
  (select count(*)::int from public.admin_report_handles(null::uuid[])),
  0,
  'E2 a null array is an empty answer, not a fail-open (IF <null> never runs in plpgsql)');
select is(
  (select count(*)::int from public.admin_report_handles(array[]::uuid[])),
  0,
  'E3 an empty array is an empty answer');
select throws_ok(
  $$ select * from public.admin_report_handles(
       (select array_agg(gen_random_uuid()) from generate_series(1, 1001))) $$,
  '22023',
  null,
  'E4 more than 1000 ids is a caller bug (22023), not a full-table walk');
reset role;

-- ── 6. rule #1 ────────────────────────────────────────────────────────────────────────────
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('a1440000-0000-4000-8000-000000000001', 'b1440000-0000-4000-8000-000000000002',
                         'c1440000-0000-4000-8000-000000000003', 'd1440000-0000-4000-8000-000000000004',
                         'e1440000-0000-4000-8000-000000000005', 'f1440000-0000-4000-8000-000000000006',
                         'a2440000-0000-4000-8000-000000000007')),
  0,
  'R1 reporting, blocking and resolving handles write zero aura_events (rule #1)');
reset role;

select * from finish();
rollback;
