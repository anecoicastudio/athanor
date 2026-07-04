begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'report_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'report_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── schema ──
select has_table('public', 'reports', 'reports exists');
select policies_are('public', 'reports',
  array['reports_select_own','reports_insert_own','reports_select_admin'],
  'reporter-own policies + admin read (no client UPDATE/DELETE)');

-- ── anon denied ──
set local role anon;
select throws_ok($$ select * from public.reports $$, '42501', null, 'anon SELECT denied');
reset role;

-- ── reporter inserts own (reporter_id + status default server-side) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.reports (target_type, target_id, category)
     values ('person','22222222-2222-2222-2222-222222222222','spam') $$,
  'reporter files own report (defaults reporter_id=auth.uid(), status=open)');
select is((select count(*) from public.reports)::int, 1, 'reporter sees own report');

-- ── cannot pre-set a verdict (WITH CHECK pins status='open') ──
select throws_ok(
  $$ insert into public.reports (target_type, category, status)
     values ('behavior','harassment','upheld') $$,
  '42501', null, 'cannot file a pre-upheld report (status pinned to open)');

-- ── reporter cannot change their own verdict (no client UPDATE grant/policy) ──
select throws_ok(
  $$ update public.reports set status = 'dismissed'
     where reporter_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'reporter cannot transition status (no client UPDATE)');

-- ── reporter cannot delete (no client DELETE grant/policy) ──
select throws_ok(
  $$ delete from public.reports where reporter_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'reporter cannot delete a report (no client DELETE)');

-- ── reporter reads only own: seed user_b's report, user_a cannot see it ──
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.reports (target_type, category) values ('behavior','other');  -- b's own
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.reports
     where reporter_id = '22222222-2222-2222-2222-222222222222')::int,
  0, 'reporter cannot see another reporter''s reports or verdicts');

-- ── ZERO AURA (rule #1) — count globally under service_role (bypasses aura_events owner-RLS) ──
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
   where profile_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222')),
  0, 'filing reports produced zero aura_events (global)');
reset role;

select * from finish();
rollback;
