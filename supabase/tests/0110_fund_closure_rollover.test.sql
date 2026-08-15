begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

-- #221 — closure and rollover: close_cycle() and rollover_voided(), every way they refuse,
-- the carry arithmetic in each closure reason, and the one-active invariant held through
-- the close-then-create transaction. FUND-45 · D33/D34/D35.
-- Fixture: any live cycle is parked 'closed' first (no-op in CI's empty stack; on the
-- staging smoke it frees fund_editions_one_active, all rolled back — the 0108/0109
-- pattern). The chain: edition A realizes into S1, S1 fails realization into S2, S2
-- realizes clamped into S3, S3 voids and rolls over into S4. Successor ids are generated
-- inside the functions, so they are captured in temp tables and spliced into refusal SQL
-- via format().

-- ── structure ───────────────────────────────────────────────────────────────────────────
select has_function('public', 'close_cycle',
  array['uuid','text','text','bigint','timestamptz','bigint','bigint','integer','integer','integer','text','text'],
  'close_cycle(uuid, outcome, evidence, released, successor…) exists');
select has_function('public', 'rollover_voided',
  array['uuid','timestamptz','bigint','bigint','integer','integer','integer','text','text'],
  'rollover_voided(uuid, successor…) exists');
select has_function('public', 'fund_rollover_successor',
  array['uuid','bigint','timestamptz','bigint','bigint','integer','integer','integer','text','text'],
  'fund_rollover_successor (the shared rollover half) exists');
select has_column('public', 'fund_editions', 'carried_from_edition_id',
  'fund_editions carries its rollover provenance');
select col_is_null('public', 'fund_editions', 'carried_from_edition_id',
  'carried_from_edition_id is nullable — a cycle can open from nothing');
select has_index('public', 'fund_editions', 'fund_editions_one_rollover',
  'one successor per predecessor is a unique-index fact');

-- the widened audit vocabulary still pins the fund shape per action
select throws_ok(
  $$ insert into public.audit_log (action) values ('close_cycle') $$,
  '23514', null, 'a close_cycle audit row requires edition_id');
select throws_ok(
  $$ insert into public.audit_log (action) values ('rollover_cycle') $$,
  '23514', null, 'a rollover_cycle audit row requires edition_id');

-- closure_reason vocabulary: five values, nothing else
select throws_ok(
  $$ insert into public.fund_editions
       (target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters,
        min_candidacies, split_pct, cost_fee_statement, equity_declared)
       values (now(), 100, 'closed', 'abandoned', 1, 1, 1, 10, 'costs', 'none') $$,
  '23514', null, 'a closure_reason outside the D33 vocabulary is refused');

-- ── fixture ─────────────────────────────────────────────────────────────────────────────
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01100000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'clo_u1@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01100000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'clo_u2@test.athanor', '{}'::jsonb, now(), now());

-- ── refusal: unknown edition, both entry points ─────────────────────────────────────────
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-00000000dead', 'realized', 'e',
       null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'edition not found', 'close_cycle refuses an unknown edition');
select throws_ok(
  $$ select * from public.rollover_voided('01100000-0000-0000-0000-00000000dead',
       now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'edition not found', 'rollover_voided refuses an unknown edition');

-- ── edition A: the closure refusal ladder, then the realized close ──────────────────────
-- Born 'voting' with carried_in 20000 (a voided predecessor's pool, fixture-given);
-- €1500 succeeded + one refunded row the sums must ignore.
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, carried_in_cents)
  values ('01100000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'voting', false, false,
          100000, 1, 1, 10, 'fixture costs statement', 'none', 20000);
reset role;
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status) values
  ('01100000-0000-0000-0000-0000000000e1', '01100000-0000-0000-0000-000000000001', 150000, 'cs_0110_1', 'succeeded'),
  ('01100000-0000-0000-0000-0000000000e1', '01100000-0000-0000-0000-000000000002', 999, 'cs_0110_2', 'refunded');

select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized', 'e',
       null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'closure out of phase', 'a voting cycle cannot be declared over');
select is(
  (select phase from public.fund_editions where id = '01100000-0000-0000-0000-0000000000e1'),
  'voting', 'a refusal touches the phase not at all');

set local role service_role;
update public.fund_editions
   set phase = 'announcement', confirmed_pool_cents = 100000
 where id = '01100000-0000-0000-0000-0000000000e1';
reset role;

select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized', 'e',
       null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'no winner declared', 'closure needs a declared winner');

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('01100000-0000-0000-0000-0000000000c1', '01100000-0000-0000-0000-0000000000e1',
   '01100000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner');
set local role service_role;
update public.fund_editions
   set winner_candidacy_id = '01100000-0000-0000-0000-0000000000c1'
 where id = '01100000-0000-0000-0000-0000000000e1';
reset role;

select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized', 'e',
       null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'viability not confirmed', 'an unconfirmed winner has nothing to realize or to fail');

set local role service_role;
update public.fund_editions
   set winner_confirmed_at = now()
 where id = '01100000-0000-0000-0000-0000000000e1';
reset role;

select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized', '   ',
       null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'evidence required', 'the admin act carries its evidence — blank refused');
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'voided', 'e',
       null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'unknown outcome', 'the outcome vocabulary is closed');
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized', 'e',
       5, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'released not applicable', 'realized disburses the snapshot — a released amount contradicts it');
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realization_failed', 'e',
       null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'released required', 'the D33 failure must state what was released');
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realization_failed', 'e',
       200000, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'released out of range', 'released cannot exceed the snapshot');
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realization_failed', 'e',
       -1, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'released out of range', 'released cannot be negative');
select throws_ok(
  $$ select * from public.rollover_voided('01100000-0000-0000-0000-0000000000e1',
       now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'cycle not closed', 'an open cycle has no rollover half to run');

-- the realized close: carried_in 20000 + raised 150000 − disbursed 100000 = 70000
create temp table clo_a as
  select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized',
    'delivered against the published plan — evidence at D26 publication',
    null, now() + interval '90 days', 6000000, 50000, 4, 2, 10, 'cycle 2 costs statement', 'none');
-- temp tables belong to the login role; the service_role fixture blocks below read them
grant select on clo_a to service_role;

select is((select clo_a.closure_reason from clo_a), 'realized', 'the close reports its outcome');
select is((select clo_a.carried_in_cents from clo_a), 70000::bigint,
  'realized carries the post-snapshot remainder: carried_in + raised − snapshot (D34/D35)');
select is(
  (select phase from public.fund_editions where id = '01100000-0000-0000-0000-0000000000e1'),
  'closed', 'the realized cycle is closed');
select is(
  (select e.closure_reason from public.fund_editions e where e.id = '01100000-0000-0000-0000-0000000000e1'),
  'realized', 'closure_reason publishes the delivery');
select is(
  (select status from public.dream_candidacies where id = '01100000-0000-0000-0000-0000000000c1'),
  'winner', 'on realized the winner stays winner — the historical record of a delivered dream');
select is(
  (select phase from public.fund_editions where id = (select successor_id from clo_a)),
  'candidacy', 'the successor opens at candidacy');
select is(
  (select e.carried_in_cents from public.fund_editions e where e.id = (select successor_id from clo_a)),
  70000::bigint, 'the successor starts with the carried remainder');
select is(
  (select carried_from_edition_id from public.fund_editions where id = (select successor_id from clo_a)),
  '01100000-0000-0000-0000-0000000000e1'::uuid, 'provenance points at the predecessor');
select is(
  (select candidacy_window_open or contributions_enabled from public.fund_editions
    where id = (select successor_id from clo_a)),
  false, 'the successor opens with both windows shut — operator acts open them');
select is(
  (select (min_funding_cents, min_voters, min_candidacies, split_pct)::text from public.fund_editions
    where id = (select successor_id from clo_a)),
  '(50000,4,2,10)', 'the operator-declared minimums and split land verbatim');
select is(
  (select (raised_cents, contributor_count)::text from public.fund_aggregates
    where edition_id = (select successor_id from clo_a)),
  '(0,0)', 'the counter resets: a fresh zero aggregates row (FUND-SPEC §1)');
select is(
  (select count(*)::int from public.audit_log
    where action = 'close_cycle' and edition_id = '01100000-0000-0000-0000-0000000000e1'
      and candidacy_id = '01100000-0000-0000-0000-0000000000c1'),
  1, 'the closure wrote its audit row, winner attached');
select is(
  (select count(*)::int from public.audit_log
    where action = 'rollover_cycle' and edition_id = (select successor_id from clo_a)),
  1, 'the rollover wrote its audit row on the successor');
select is(
  (select count(*)::int from public.fund_editions where phase <> 'closed'),
  1, 'fund_editions_one_active held through the transaction: exactly one open cycle');

select throws_ok(
  $$ select * from public.rollover_voided('01100000-0000-0000-0000-0000000000e1',
       now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $$,
  'P0001', 'predecessor not voided', 'a realized cycle already rolled over inside close_cycle');
select throws_ok(
  format($sq$ select * from public.close_cycle('%s', 'realized', 'e',
    null, now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $sq$,
    (select successor_id from clo_a)),
  'P0001', 'closure out of phase', 'a candidacy-phase successor cannot be declared over');

-- ── S1: the D33 failure, closed from ''realization'', remainder carries ─────────────────
-- carried_in 70000 + raised 10000 − released 30000 = 50000. The live field (winner
-- included) goes terminal 'voided', as on a decline.
set local role service_role;
update public.fund_editions
   set phase = 'announcement', confirmed_pool_cents = 50000
 where id = (select successor_id from clo_a);
reset role;
insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
select '01100000-0000-0000-0000-0000000000c2', successor_id,
       '01100000-0000-0000-0000-000000000002', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner'
  from clo_a;
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
select successor_id, '01100000-0000-0000-0000-000000000001', 10000, 'cs_0110_3', 'succeeded' from clo_a;
set local role service_role;
update public.fund_editions
   set winner_candidacy_id = '01100000-0000-0000-0000-0000000000c2', winner_confirmed_at = now()
 where id = (select successor_id from clo_a);
update public.fund_editions
   set phase = 'realization'
 where id = (select successor_id from clo_a);
reset role;

create temp table clo_s1 as
  select * from public.close_cycle((select successor_id from clo_a), 'realization_failed',
    'first tranche released, delivery declared failed (D26 publication)',
    30000, now() + interval '90 days', 6000000, 50000, 4, 2, 10, 'cycle 3 costs statement', 'none');
grant select on clo_s1 to service_role;

select is((select clo_s1.closure_reason from clo_s1), 'realization_failed',
  'the failure closes from realization with its own reason');
select is((select clo_s1.carried_in_cents from clo_s1), 50000::bigint,
  'the unreleased remainder carries: carried_in + raised − released (D33)');
select is(
  (select status from public.dream_candidacies where id = '01100000-0000-0000-0000-0000000000c2'),
  'voided', 'a failed realization voids the field, winner included');
select is(
  (select e.closure_reason from public.fund_editions e where e.id = (select successor_id from clo_a)),
  'realization_failed', 'closure_reason publishes the failure');
select is(
  (select e.carried_in_cents from public.fund_editions e
    where e.carried_from_edition_id = (select successor_id from clo_a)),
  50000::bigint, 'the successor starts with the remainder');

-- ── S2: the clamp — a post-snapshot refund sank the pool below the promise ──────────────
-- carried_in 50000 + raised 1000 − snapshot 200000 → greatest(…, 0) = 0: the shortfall is
-- Athanor's to absorb, never a negative carry and never a contributor refund.
set local role service_role;
update public.fund_editions
   set phase = 'announcement', confirmed_pool_cents = 200000
 where id = (select successor_id from clo_s1);
reset role;
insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
select '01100000-0000-0000-0000-0000000000c3', successor_id,
       '01100000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner'
  from clo_s1;
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
select successor_id, '01100000-0000-0000-0000-000000000002', 1000, 'cs_0110_4', 'succeeded' from clo_s1;
set local role service_role;
update public.fund_editions
   set winner_candidacy_id = '01100000-0000-0000-0000-0000000000c3', winner_confirmed_at = now()
 where id = (select successor_id from clo_s1);
reset role;

create temp table clo_s2 as
  select * from public.close_cycle((select successor_id from clo_s1), 'realized',
    'delivered; the pool sank below the snapshot after refunds',
    null, now() + interval '90 days', 6000000, 50000, 5, 2, 10, 'cycle 4 costs statement', 'none');
grant select on clo_s2 to service_role;

select is((select clo_s2.carried_in_cents from clo_s2), 0::bigint,
  'the carry clamps at zero — the post-refund shortfall is Athanor''s, not the contributors''');
select is(
  (select e.closure_reason from public.fund_editions e where e.id = (select successor_id from clo_s1)),
  'realized', 'the clamped close is still a realized close');

-- ── S3: a real #220 void, then rollover_voided ──────────────────────────────────────────
-- Zero votes < min_voters 5 → voided_quorum through enter_announcement itself; the whole
-- pool (carried_in 0 + raised 30000) then carries at rollover.
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
select successor_id, '01100000-0000-0000-0000-000000000001', 30000, 'cs_0110_5', 'succeeded' from clo_s2;
-- fund_editions_ballot_open_check gates the voting transition on min_candidacies (2 here)
-- ballot-ready rows — the quorum being voided is the VOTER quorum, not the field.
insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
select '01100000-0000-0000-0000-0000000000c5'::uuid, successor_id,
       '01100000-0000-0000-0000-000000000001'::uuid, 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted'
  from clo_s2
union all
select '01100000-0000-0000-0000-0000000000c6'::uuid, successor_id,
       '01100000-0000-0000-0000-000000000002'::uuid, 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted'
  from clo_s2;
set local role service_role;
update public.fund_editions
   set phase = 'voting', voting_starts_at = now() - interval '2 days', voting_ends_at = now() - interval '1 day'
 where id = (select successor_id from clo_s2);
reset role;
select is(
  (select outcome from public.enter_announcement((select successor_id from clo_s2))),
  'voided_quorum', 'S3 voids below quorum through the #220 path');

-- while another cycle is open, the rollover refuses by name
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01100000-0000-0000-0000-0000000000e9', now() + interval '60 days', 100, 'candidacy', false, false,
          1, 1, 1, 10, 'blocker fixture', 'none');
reset role;
select throws_ok(
  format($sq$ select * from public.rollover_voided('%s',
    now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $sq$,
    (select successor_id from clo_s2)),
  'P0001', 'another cycle is open', 'no successor opens beside an open cycle');
set local role service_role;
update public.fund_editions set phase = 'closed', closure_reason = 'voided_underfunded'
 where id = '01100000-0000-0000-0000-0000000000e9';
reset role;

create temp table rol_s3 as
  select * from public.rollover_voided((select successor_id from clo_s2),
    now() + interval '90 days', 6000000, 50000, 5, 2, 10, 'cycle 5 costs statement', 'none');

select is((select rol_s3.carried_in_cents from rol_s3), 30000::bigint,
  'a void carries the whole pool — nothing was disbursed (FUND-SPEC §1)');
select is(
  (select (phase, carried_from_edition_id = (select successor_id from clo_s2))::text
    from public.fund_editions where id = (select successor_id from rol_s3)),
  '(candidacy,t)', 'the void''s successor opens at candidacy, provenance recorded');
select throws_ok(
  format($sq$ select * from public.rollover_voided('%s',
    now() + interval '90 days', 100, 0, 1, 1, 10, 'c', 'e') $sq$,
    (select successor_id from clo_s2)),
  'P0001', 'already rolled over', 'a predecessor rolls over exactly once');
select is(
  (select count(*)::int from public.fund_editions where phase <> 'closed'),
  1, 'one open cycle again after the rollover (fund_editions_one_active)');

-- ── re-candidacy: the old row stands, the new cycle takes a new row ─────────────────────
-- u2's candidacy in S1 ended 'voided'; re-submission in S4 is a NEW row, explicit —
-- nothing auto-carries (FUND-35's cross-cycle half; the wizard prefill is the app's job).
select lives_ok(
  $$ insert into public.dream_candidacies
       (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents)
     select '01100000-0000-0000-0000-0000000000c4', successor_id,
            '01100000-0000-0000-0000-000000000002', 's2', 'g2', 'i2', 'v2.mp4', 'p2', 900000, 400000
       from rol_s3 $$,
  'a member with a voided prior-cycle candidacy can submit afresh in the successor');
select is(
  (select status from public.dream_candidacies where id = '01100000-0000-0000-0000-0000000000c2'),
  'voided', 'the prior-cycle candidacy is untouched by the re-submission');
select is(
  (select (status, edition_id = (select successor_id from rol_s3))::text
    from public.dream_candidacies where id = '01100000-0000-0000-0000-0000000000c4'),
  '(submitted,t)', 'the new candidacy is a fresh submitted row in the new cycle');

-- rule #1 tooth: nothing in the closure family emits Aura
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('01100000-0000-0000-0000-000000000001',
                         '01100000-0000-0000-0000-000000000002')),
  0, 'closure and rollover emit zero aura_events (rule #1)');

-- ── all three functions are service-role only ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized', 'e',
       null, now(), 100, 0, 1, 1, 10, 'c', 'e') $$,
  '42501', null, 'authenticated cannot execute close_cycle');
select throws_ok(
  $$ select * from public.rollover_voided('01100000-0000-0000-0000-0000000000e1',
       now(), 100, 0, 1, 1, 10, 'c', 'e') $$,
  '42501', null, 'authenticated cannot execute rollover_voided');
select throws_ok(
  $$ select public.fund_rollover_successor('01100000-0000-0000-0000-0000000000e1', 0,
       now(), 100, 0, 1, 1, 10, 'c', 'e') $$,
  '42501', null, 'authenticated cannot execute fund_rollover_successor');
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.close_cycle('01100000-0000-0000-0000-0000000000e1', 'realized', 'e',
       null, now(), 100, 0, 1, 1, 10, 'c', 'e') $$,
  '42501', null, 'anon cannot execute close_cycle');
select throws_ok(
  $$ select * from public.rollover_voided('01100000-0000-0000-0000-0000000000e1',
       now(), 100, 0, 1, 1, 10, 'c', 'e') $$,
  '42501', null, 'anon cannot execute rollover_voided');
select throws_ok(
  $$ select public.fund_rollover_successor('01100000-0000-0000-0000-0000000000e1', 0,
       now(), 100, 0, 1, 1, 10, 'c', 'e') $$,
  '42501', null, 'anon cannot execute fund_rollover_successor');
reset role;

select * from finish();
rollback;
