begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- #219 declare_winner(): the one path that writes a winner, and every way it refuses.
-- Fixture: one 'voting' edition whose ballot window has CLOSED (declaration requires it),
-- min_voters = 3, min_funding_cents = 100000. Four voters, three candidacies:
--   C1 (author u1, earliest submission) and C2 (author u2) end TIED 2-2 — D7 breaks the
--   tie on earliest submission, so C1 must win. C3 (author u3) exists to force a mid-
--   transaction failure for the atomicity assert. Votes are inserted directly (owner) —
--   cast_vote correctly refuses a closed window (#217), and window mechanics are its tests.

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'dw_u1@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'dw_u2@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'dw_u3@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'dw_u4@test.athanor', '{}'::jsonb, now(), now());

-- structure
select has_function('public', 'declare_winner', array['uuid'], 'declare_winner(uuid) exists');
select has_index('public', 'dream_candidacies', 'dream_candidacies_one_winner_per_edition',
  'the one-winner-per-edition partial unique index exists (FUND-12)');
select has_column('public', 'audit_log', 'edition_id', 'audit_log carries edition_id');
select has_column('public', 'audit_log', 'candidacy_id', 'audit_log carries candidacy_id');
select col_is_null('public', 'audit_log', 'report_id', 'audit_log.report_id is nullable (fund rows have no report)');
select col_is_null('public', 'audit_log', 'actor_id', 'audit_log.actor_id is nullable (declare-winner has no user)');

-- rule #3 tooth: the declaration returns aggregates only — no voter identity, ever.
select unlike(
  pg_get_function_result('public.declare_winner(uuid)'::regprocedure),
  '%voter%',
  'declare_winner returns no voter_id (ballot privacy, rule #3)');

-- the relaxed audit_log still pins each shape per action
select throws_ok(
  $$ insert into public.audit_log (report_id, actor_id, action) values (null, null, 'dismiss') $$,
  '23514', null, 'a moderation action still requires report_id + actor_id');
select throws_ok(
  $$ insert into public.audit_log (action) values ('declare_winner') $$,
  '23514', null, 'declare_winner audit row requires edition_id');

-- ── fixture ─────────────────────────────────────────────────────────────────────────────
-- Born with an UNDECLARED window: the first two refusals below are the window gate, and the
-- window is only closed (service_role update) once they have both fired.
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies)
  values ('00000000-0000-0000-0000-0000000000ed', now() + interval '30 days', 5000000, 'voting', false, false,
          100000, 3, 3);
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status, created_at)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000ed',
   '11111111-1111-1111-1111-111111111111', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000ed',
   '22222222-2222-2222-2222-222222222222', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000ed',
   '33333333-3333-3333-3333-333333333333', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted', now() - interval '1 hour');

-- ── refusals 1+2: the ballot window (fail closed — 20260815094157, MIGRATIONS-ERRATA) ───
-- An UNDECLARED window refuses: `now() > NULL` is NULL, and the naive IF shape silently let
-- this case through to the deeper gates. The declared-but-still-open window refuses too.
select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  'P0001', 'ballot not closed', 'an undeclared voting window refuses (fail closed)');

set local role service_role;
update public.fund_editions
   set voting_starts_at = now() - interval '2 days', voting_ends_at = now() + interval '1 day'
 where id = '00000000-0000-0000-0000-0000000000ed';
reset role;
select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  'P0001', 'ballot not closed', 'a still-open ballot refuses');

set local role service_role;
update public.fund_editions
   set voting_ends_at = now() - interval '1 day'
 where id = '00000000-0000-0000-0000-0000000000ed';
reset role;

-- ── refusal 3: quorum (FUND-43) — 2 of 3 required voters ────────────────────────────────
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id) values
  ('00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111'),
  ('00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-0000000000c2', '22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  'P0001', 'quorum not met', 'below min_voters the declaration refuses');
select is(
  (select winner_candidacy_id from public.fund_editions where id = '00000000-0000-0000-0000-0000000000ed'),
  null, 'quorum refusal touches winner_candidacy_id not at all');
select is(
  (select count(*)::int from public.dream_candidacies where status = 'winner'),
  0, 'quorum refusal touches no candidacy status');

-- ── refusal 2: funding floor (FUND-42) — quorum now met, pool €500 < €1000 ─────────────
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id) values
  ('00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-0000000000c2', '33333333-3333-3333-3333-333333333333'),
  ('00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-0000000000c1', '44444444-4444-4444-4444-444444444444');
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values ('00000000-0000-0000-0000-0000000000ed', '11111111-1111-1111-1111-111111111111', 50000, 'cs_test_dw_1', 'succeeded');

select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  'P0001', 'funding floor not met', 'below min_funding_cents the declaration refuses');
select is(
  (select winner_candidacy_id from public.fund_editions where id = '00000000-0000-0000-0000-0000000000ed'),
  null, 'floor refusal touches winner_candidacy_id not at all');
select is(
  (select count(*)::int from public.dream_candidacies where status = 'winner'),
  0, 'floor refusal touches no candidacy status');

-- pending money does not count toward the floor (rule 6: only settled rows are real)
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values ('00000000-0000-0000-0000-0000000000ed', '22222222-2222-2222-2222-222222222222', 900000, 'cs_test_dw_2', 'pending');
select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  'P0001', 'funding floor not met', 'pending contributions do not satisfy the floor');

-- ── atomicity: a failing write rolls back the whole declaration ─────────────────────────
-- Floor is now met; C3 is forced 'winner' directly so declare_winner's candidacy write
-- (edition write already executed inside the same call) hits the one-winner index. The
-- function must leave NOTHING behind: no winner_candidacy_id, no audit row.
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values ('00000000-0000-0000-0000-0000000000ed', '33333333-3333-3333-3333-333333333333', 50000, 'cs_test_dw_3', 'succeeded');
update public.dream_candidacies set status = 'winner' where id = '00000000-0000-0000-0000-0000000000c3';

select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  '23505', null, 'a conflicting winner aborts the declaration (unique index)');
select is(
  (select winner_candidacy_id from public.fund_editions where id = '00000000-0000-0000-0000-0000000000ed'),
  null, 'the aborted declaration rolled back its edition write (no partial write)');
select is(
  (select count(*)::int from public.audit_log where edition_id = '00000000-0000-0000-0000-0000000000ed'),
  0, 'the aborted declaration left no audit row');

update public.dream_candidacies set status = 'shortlisted' where id = '00000000-0000-0000-0000-0000000000c3';

-- ── success: tied 2-2, D7 breaks on earliest submission → C1 ────────────────────────────
-- One call, captured: the function refuses a second run, so the ordering asserts read from
-- this snapshot. row_number() over () numbers the function-scan emission order.
create temp table dw_results as
  select row_number() over () as rn, t.*
    from public.declare_winner('00000000-0000-0000-0000-0000000000ed') t;

select is(
  (select candidacy_id from dw_results where rn = 1),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'tie breaks on earliest submission: C1 first (D7, #217 order)');
select is(
  (select is_winner from dw_results where rn = 1),
  true, 'the top ballot row is the winner');
select is(
  (select count(*)::int from dw_results),
  2, 'the FULL ballot ordering is returned (both voted candidacies), not just the winner');
select is(
  (select candidacy_id from dw_results where rn = 2),
  '00000000-0000-0000-0000-0000000000c2'::uuid, 'the runner-up follows in order');
select is(
  (select winner_candidacy_id from public.fund_editions where id = '00000000-0000-0000-0000-0000000000ed'),
  '00000000-0000-0000-0000-0000000000c1'::uuid, 'fund_editions.winner_candidacy_id written');
select is(
  (select status from public.dream_candidacies where id = '00000000-0000-0000-0000-0000000000c1'),
  'winner', 'dream_candidacies.status written');
select is(
  (select count(*)::int from public.audit_log
    where edition_id = '00000000-0000-0000-0000-0000000000ed'
      and candidacy_id = '00000000-0000-0000-0000-0000000000c1'
      and action = 'declare_winner' and report_id is null and actor_id is null),
  1, 'one audit_log row records the declaration (no report, no user actor)');

-- rule #1 tooth: declaring a winner emits zero Aura
select is(
  (select count(*)::int from public.aura_events where ref_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'winner declaration emits no aura_events (fund = zero Aura)');

-- ── re-declaration refused; a second winner is impossible even for service_role ─────────
select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  'P0001', 'winner already declared', 'a second declaration in the same cycle refuses');

set local role service_role;
select throws_ok(
  $$ update public.dream_candidacies set status = 'winner'
      where id = '00000000-0000-0000-0000-0000000000c2' $$,
  '23505', null, 'a second winner in the same cycle is a unique violation, even as service_role');
reset role;

-- ── the function is service-role only ───────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  '42501', null, 'authenticated cannot execute declare_winner');
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.declare_winner('00000000-0000-0000-0000-0000000000ed') $$,
  '42501', null, 'anon cannot execute declare_winner');
reset role;

select * from finish();
rollback;
