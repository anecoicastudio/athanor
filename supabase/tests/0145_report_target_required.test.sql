-- 0145_report_target_required.test.sql
-- #611 — reports_target_required_unless_behavior (20260904152300): a 'person', 'post' or 'message'
-- report must name a target; 'behavior' may or may not. Four things hold at once:
--
--   1. The constraint exists by name, as a CHECK, with the one-directional definition — and it
--      sits BESIDE the type CHECK rather than replacing it.
--   2. A reporter inserting a null target on each of the three subject-bearing types is refused
--      with 23514 (check_violation) — not 42501, so the refusal is the constraint and not RLS.
--   3. 'behavior' still inserts with a null target AND with a target (the staging seed files the
--      latter), and a targeted 'person' report still inserts (positive control).
--   4. The pairing is enforced by the constraint and by nothing else: no policy on reports
--      mentions target_type or target_id (0053 keeps the one exhaustive policies_are list).

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11450000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'report145_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11450000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'report145_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── 1. the constraint, by name and by definition, beside the type CHECK ──
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.reports'::regclass
      and conname = 'reports_target_required_unless_behavior'
      and contype = 'c'),
  1, 'reports_target_required_unless_behavior exists as a CHECK on public.reports');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.reports'::regclass
      and conname = 'reports_target_required_unless_behavior'),
  'CHECK (((target_type = ''behavior''::text) OR (target_id IS NOT NULL)))',
  'definition is one-directional: behavior OR target present');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.reports'::regclass
      and conname in ('reports_target_type_check', 'reports_target_required_unless_behavior')),
  2, 'the type CHECK is still there — this constraint sits beside it, not in its place');

-- ── 4. no policy carries the rule (no policy edit in #611; 0053 pins the exhaustive list) ──
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'reports'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'target_(type|id)'),
  0, 'no reports policy mentions target_type or target_id — the pairing lives in the CHECK alone');

-- ── 2. a reporter cannot file a subject-bearing report that names no subject ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"11450000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ insert into public.reports (target_type, target_id, category) values ('person', null, 'spam') $$,
  '23514', null, 'person report with a null target → 23514');
select throws_ok(
  $$ insert into public.reports (target_type, target_id, category) values ('post', null, 'spam') $$,
  '23514', null, 'post report with a null target → 23514');
select throws_ok(
  $$ insert into public.reports (target_type, target_id, category) values ('message', null, 'harassment') $$,
  '23514', null, 'message report with a null target → 23514');

-- ── 3. behavior is the one type the column was made nullable for; a target is still allowed ──
select lives_ok(
  $$ insert into public.reports (target_type, target_id, category) values ('behavior', null, 'other') $$,
  'behavior report with a null target inserts');
select lives_ok(
  $$ insert into public.reports (target_type, target_id, category)
     values ('behavior', '11450000-0000-4000-8000-000000000002', 'harassment') $$,
  'behavior report WITH a target inserts (the staging seed files one)');
select lives_ok(
  $$ insert into public.reports (target_type, target_id, category)
     values ('person', '11450000-0000-4000-8000-000000000002', 'spam') $$,
  'person report with a target inserts (positive control)');
select is((select count(*) from public.reports)::int, 3,
  'exactly the three permitted rows landed, all visible to their reporter');
reset role;

select * from finish();
rollback;
