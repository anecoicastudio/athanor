begin;

create extension if not exists pgtap with schema extensions;

select plan(63);

-- #220 — announcement: enter_announcement() and record_winner_decision(), every way they
-- refuse, and the four endings a cycle can reach from 'voting': voided_quorum,
-- voided_underfunded, announced → confirmed, announced → declined. FUND-42/43/44 · D33/D34.
-- Fixture: any live cycle is parked 'closed' first (no-op in CI's empty stack; on the
-- staging smoke it frees fund_editions_one_active, all rolled back — the 0108 pattern).
-- Four editions run in sequence, each closed before the next opens. Votes and
-- contributions are inserted directly (owner) — window mechanics are #217's tests.

-- ── structure ───────────────────────────────────────────────────────────────────────────
select has_function('public', 'enter_announcement', array['uuid'],
  'enter_announcement(uuid) exists');
select has_function('public', 'record_winner_decision', array['uuid','text'],
  'record_winner_decision(uuid, text) exists');
select has_column('public', 'fund_editions', 'winner_confirmed_at',
  'fund_editions carries winner_confirmed_at');
select col_is_null('public', 'fund_editions', 'winner_confirmed_at',
  'winner_confirmed_at is nullable — NULL until the winner confirms');
select has_function('public', 'fund_editions_announcement_frozen',
  'announcement freeze trigger function exists');
select has_trigger('public', 'fund_editions', 'fund_editions_freeze_announcement',
  'freeze trigger is attached to fund_editions');

-- the widened audit vocabulary still pins the fund shape per action
select throws_ok(
  $$ insert into public.audit_log (action) values ('void_cycle') $$,
  '23514', null, 'a void_cycle audit row requires edition_id');
select throws_ok(
  $$ insert into public.audit_log (action) values ('abdicate') $$,
  '23514', null, 'an action outside the vocabulary is still refused');

-- winner_confirmed_at needs a declared winner from announcement on
select throws_ok(
  $$ insert into public.fund_editions
       (target_at, goal_cents, phase, winner_confirmed_at, min_funding_cents, min_voters,
        min_candidacies, split_pct, cost_fee_statement, equity_declared)
       values (now(), 100, 'candidacy', now(), 1, 1, 1, 10, 'costs', 'none') $$,
  '23514', null, 'a confirmation without a winner (or before announcement) is refused');

-- the presence #216 deferred: announcement always carries its snapshot
select throws_ok(
  $$ insert into public.fund_editions
       (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
        split_pct, cost_fee_statement, equity_declared)
       values (now(), 100, 'announcement', 1, 1, 1, 10, 'costs', 'none') $$,
  '23514', null, 'phase announcement without confirmed_pool_cents is refused (#220 guarantees it)');

-- ── fixture ─────────────────────────────────────────────────────────────────────────────
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01090000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'ann_u1@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01090000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'ann_u2@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01090000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'ann_u3@test.athanor', '{}'::jsonb, now(), now());

-- ── refusal: unknown edition ────────────────────────────────────────────────────────────
select throws_ok(
  $$ select * from public.enter_announcement('01090000-0000-0000-0000-00000000dead') $$,
  'P0001', 'edition not found', 'an unknown edition refuses');

-- ── edition 1: the ballot window gate, then the quorum void (FUND-43) ───────────────────
-- Born with an UNDECLARED window (fail closed — the 20260815094157 errata shape); floor
-- deliberately met so the published reason can only be the quorum.
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01090000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'voting', false, false,
          100000, 3, 1, 10, 'fixture costs statement', 'none');
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('01090000-0000-0000-0000-0000000000c1', '01090000-0000-0000-0000-0000000000e1',
   '01090000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted');
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id) values
  ('01090000-0000-0000-0000-0000000000e1', '01090000-0000-0000-0000-0000000000c1', '01090000-0000-0000-0000-000000000001'),
  ('01090000-0000-0000-0000-0000000000e1', '01090000-0000-0000-0000-0000000000c1', '01090000-0000-0000-0000-000000000002');
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values ('01090000-0000-0000-0000-0000000000e1', '01090000-0000-0000-0000-000000000001', 150000, 'cs_0109_1', 'succeeded');

select throws_ok(
  $$ select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'ballot not closed', 'an undeclared voting window refuses (fail closed)');

set local role service_role;
update public.fund_editions
   set voting_starts_at = now() - interval '2 days', voting_ends_at = now() + interval '1 day'
 where id = '01090000-0000-0000-0000-0000000000e1';
reset role;
select throws_ok(
  $$ select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'ballot not closed', 'a still-open ballot refuses');
select is(
  (select phase from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e1'),
  'voting', 'a refusal touches the phase not at all');

set local role service_role;
update public.fund_editions
   set voting_ends_at = now() - interval '1 day'
 where id = '01090000-0000-0000-0000-0000000000e1';
reset role;

-- 2 distinct voters < min_voters 3 → the quorum void
create temp table ann_e1 as
  select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e1');
select is((select outcome from ann_e1), 'voided_quorum',
  'below quorum the entry voids with its reason (FUND-43)');
select is((select voters from ann_e1), 2, 'the void reports the turnout it measured');
select is(
  (select phase from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e1'),
  'closed', 'the quorum void closes the cycle');
select is(
  (select closure_reason from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e1'),
  'voided_quorum', 'closure_reason publishes the cause');
select is(
  (select confirmed_pool_cents from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e1'),
  null, 'a voided cycle never receives a snapshot — nothing was announced');
select is(
  (select status from public.dream_candidacies where id = '01090000-0000-0000-0000-0000000000c1'),
  'voided', 'candidacies of the voided cycle go terminal ''voided'' (D33/D34)');
select is(
  (select count(*)::int from public.audit_log
    where edition_id = '01090000-0000-0000-0000-0000000000e1'
      and action = 'void_cycle' and actor_id is null and report_id is null),
  1, 'one audit_log row records the void (no report, no user actor)');
select throws_ok(
  $$ select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'announcement out of phase', 'a closed cycle cannot re-enter announcement');
select throws_ok(
  $$ select public.record_winner_decision('01090000-0000-0000-0000-0000000000e1', 'confirm') $$,
  'P0001', 'decision out of phase', 'a closed cycle takes no winner decision');

-- ── edition 2: the funding-floor void (FUND-42), pending money does not count ───────────
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  voting_starts_at, voting_ends_at,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01090000-0000-0000-0000-0000000000e2', now() + interval '30 days', 5000000, 'voting', false, false,
          100000, 3, 1, now() - interval '2 days', now() - interval '1 day',
          10, 'fixture costs statement', 'none');
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('01090000-0000-0000-0000-0000000000c2', '01090000-0000-0000-0000-0000000000e2',
   '01090000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted');
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id) values
  ('01090000-0000-0000-0000-0000000000e2', '01090000-0000-0000-0000-0000000000c2', '01090000-0000-0000-0000-000000000001'),
  ('01090000-0000-0000-0000-0000000000e2', '01090000-0000-0000-0000-0000000000c2', '01090000-0000-0000-0000-000000000002'),
  ('01090000-0000-0000-0000-0000000000e2', '01090000-0000-0000-0000-0000000000c2', '01090000-0000-0000-0000-000000000003');
-- €500 settled + €9000 pending: only settled rows are real (rule 6)
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status) values
  ('01090000-0000-0000-0000-0000000000e2', '01090000-0000-0000-0000-000000000001', 50000, 'cs_0109_2', 'succeeded'),
  ('01090000-0000-0000-0000-0000000000e2', '01090000-0000-0000-0000-000000000002', 900000, 'cs_0109_3', 'pending');

create temp table ann_e2 as
  select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e2');
select is((select outcome from ann_e2), 'voided_underfunded',
  'below the floor the entry voids with its reason (FUND-42)');
select is((select pool_cents from ann_e2), 50000::bigint,
  'pending contributions do not count toward the floor (rule 6)');
select is(
  (select closure_reason from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e2'),
  'voided_underfunded', 'closure_reason publishes the cause');
select is(
  (select confirmed_pool_cents from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e2'),
  null, 'an underfunded cycle never receives a snapshot');
select is(
  (select status from public.dream_candidacies where id = '01090000-0000-0000-0000-0000000000c2'),
  'voided', 'its candidacies go terminal ''voided''');

-- ── edition 3: the clear path — snapshot, then the winner confirms ──────────────────────
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  voting_starts_at, voting_ends_at,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01090000-0000-0000-0000-0000000000e3', now() + interval '30 days', 5000000, 'voting', false, false,
          100000, 3, 1, now() - interval '2 days', now() - interval '1 day',
          10, 'fixture costs statement', 'none');
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status, created_at)
values
  ('01090000-0000-0000-0000-0000000000c3', '01090000-0000-0000-0000-0000000000e3',
   '01090000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted', now() - interval '2 hours'),
  ('01090000-0000-0000-0000-0000000000c4', '01090000-0000-0000-0000-0000000000e3',
   '01090000-0000-0000-0000-000000000002', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted', now() - interval '1 hour');
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id) values
  ('01090000-0000-0000-0000-0000000000e3', '01090000-0000-0000-0000-0000000000c3', '01090000-0000-0000-0000-000000000001'),
  ('01090000-0000-0000-0000-0000000000e3', '01090000-0000-0000-0000-0000000000c3', '01090000-0000-0000-0000-000000000002'),
  ('01090000-0000-0000-0000-0000000000e3', '01090000-0000-0000-0000-0000000000c4', '01090000-0000-0000-0000-000000000003');
-- €1000 + €500 settled, €9000 pending → the snapshot must read exactly €1500
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status) values
  ('01090000-0000-0000-0000-0000000000e3', '01090000-0000-0000-0000-000000000001', 100000, 'cs_0109_4', 'succeeded'),
  ('01090000-0000-0000-0000-0000000000e3', '01090000-0000-0000-0000-000000000002', 50000, 'cs_0109_5', 'succeeded'),
  ('01090000-0000-0000-0000-0000000000e3', '01090000-0000-0000-0000-000000000003', 900000, 'cs_0109_6', 'pending');

create temp table ann_e3 as
  select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e3');
select is((select outcome from ann_e3), 'announced', 'above quorum and floor the cycle announces');
select is((select pool_cents from ann_e3), 150000::bigint, 'the snapshot is the settled sum only');
select is(
  (select phase from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e3'),
  'announcement', 'the cycle entered announcement');
select is(
  (select confirmed_pool_cents from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e3'),
  150000::bigint, 'confirmed_pool_cents carries the snapshot (FUND-42)');
select is(
  (select count(*)::int from public.dream_candidacies
    where edition_id = '01090000-0000-0000-0000-0000000000e3' and status = 'shortlisted'),
  2, 'an announced cycle voids nothing — the field stands');
select is(
  (select count(*)::int from public.audit_log
    where edition_id = '01090000-0000-0000-0000-0000000000e3' and action = 'announce'),
  1, 'one audit_log row records the announcement');
select throws_ok(
  $$ select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e3') $$,
  'P0001', 'announcement out of phase', 'announcement cannot re-enter and re-snapshot');

-- the snapshot is immutable once written, even for the service role
set local role service_role;
select throws_ok(
  $$ update public.fund_editions set confirmed_pool_cents = 1
      where id = '01090000-0000-0000-0000-0000000000e3' $$,
  'P0001', null, 'rewriting the snapshot is refused (freeze trigger)');
select lives_ok(
  $$ update public.fund_editions set confirmed_pool_cents = confirmed_pool_cents
      where id = '01090000-0000-0000-0000-0000000000e3' $$,
  'a same-value write-back is not a change (IS DISTINCT FROM)');

-- contributions do not stop at announcement (D34) — and the snapshot does not move
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values ('01090000-0000-0000-0000-0000000000e3', '01090000-0000-0000-0000-000000000003', 25000, 'cs_0109_7', 'succeeded');
reset role;
select is(
  (select count(*)::int from public.fund_contributions
    where edition_id = '01090000-0000-0000-0000-0000000000e3' and stripe_checkout_session_id = 'cs_0109_7'),
  1, 'a contribution lands during announcement — the gate never closed (D34)');
select is(
  (select confirmed_pool_cents from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e3'),
  150000::bigint, 'money arriving after the snapshot does not move it — it carries at closure (D35)');

-- the decision ladder, before and after the declaration
select throws_ok(
  $$ select public.record_winner_decision('01090000-0000-0000-0000-0000000000e3', 'abstain') $$,
  'P0001', 'unknown decision', 'a decision outside confirm/decline refuses');
select throws_ok(
  $$ select public.record_winner_decision('01090000-0000-0000-0000-0000000000e3', 'confirm') $$,
  'P0001', 'no winner declared', 'no decision can be recorded before declare_winner runs');

-- declare_winner composes: its phase window spans announcement (#219), and a cycle that
-- passed the entry checks can never be refused by its live quorum/floor checks
select lives_ok(
  $$ select * from public.declare_winner('01090000-0000-0000-0000-0000000000e3') $$,
  'declare_winner succeeds during announcement (composition, not duplication)');

select is(
  (select public.record_winner_decision('01090000-0000-0000-0000-0000000000e3', 'confirm')),
  'confirmed', 'the winner confirms deliverability at the snapshotted figure');
select isnt(
  (select winner_confirmed_at from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e3'),
  null, 'winner_confirmed_at is stamped');
select is(
  (select count(*)::int from public.audit_log
    where edition_id = '01090000-0000-0000-0000-0000000000e3'
      and action = 'winner_confirm'
      and candidacy_id = '01090000-0000-0000-0000-0000000000c3'),
  1, 'one audit_log row records the confirmation, pointing at the winner');
select throws_ok(
  $$ select public.record_winner_decision('01090000-0000-0000-0000-0000000000e3', 'confirm') $$,
  'P0001', 'viability already confirmed', 'a second confirmation refuses');
select throws_ok(
  $$ select public.record_winner_decision('01090000-0000-0000-0000-0000000000e3', 'decline') $$,
  'P0001', 'viability already confirmed', 'a decline after confirming refuses — the confirmation is the point of no return');

-- the stamp is immutable too (now() is transaction-constant, so the rewrite must differ)
set local role service_role;
select throws_ok(
  $$ update public.fund_editions set winner_confirmed_at = now() + interval '1 hour'
      where id = '01090000-0000-0000-0000-0000000000e3' $$,
  'P0001', null, 'rewriting winner_confirmed_at is refused (freeze trigger)');

-- park e3 closed so e4 can open (fund_editions_one_active)
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where id = '01090000-0000-0000-0000-0000000000e3';
reset role;

-- ── edition 4: announced, declared — and the winner declines (D33) ──────────────────────
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  voting_starts_at, voting_ends_at,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01090000-0000-0000-0000-0000000000e4', now() + interval '30 days', 5000000, 'voting', false, false,
          100000, 3, 1, now() - interval '2 days', now() - interval '1 day',
          10, 'fixture costs statement', 'none');
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status, created_at)
values
  ('01090000-0000-0000-0000-0000000000c5', '01090000-0000-0000-0000-0000000000e4',
   '01090000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted', now() - interval '2 hours'),
  ('01090000-0000-0000-0000-0000000000c6', '01090000-0000-0000-0000-0000000000e4',
   '01090000-0000-0000-0000-000000000002', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'shortlisted', now() - interval '1 hour');
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id) values
  ('01090000-0000-0000-0000-0000000000e4', '01090000-0000-0000-0000-0000000000c5', '01090000-0000-0000-0000-000000000001'),
  ('01090000-0000-0000-0000-0000000000e4', '01090000-0000-0000-0000-0000000000c5', '01090000-0000-0000-0000-000000000002'),
  ('01090000-0000-0000-0000-0000000000e4', '01090000-0000-0000-0000-0000000000c6', '01090000-0000-0000-0000-000000000003');
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values ('01090000-0000-0000-0000-0000000000e4', '01090000-0000-0000-0000-000000000001', 150000, 'cs_0109_8', 'succeeded');

select is(
  (select outcome from public.enter_announcement('01090000-0000-0000-0000-0000000000e4')),
  'announced', 'edition 4 announces');
select lives_ok(
  $$ select * from public.declare_winner('01090000-0000-0000-0000-0000000000e4') $$,
  'edition 4 declares its winner');

select is(
  (select public.record_winner_decision('01090000-0000-0000-0000-0000000000e4', 'decline')),
  'voided_declined', 'the winner declines as undeliverable — a dignified exit (D33)');
select is(
  (select closure_reason from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e4'),
  'voided_declined', 'the decline closes the cycle with its published reason');
select is(
  (select status from public.dream_candidacies where id = '01090000-0000-0000-0000-0000000000c5'),
  'voided', 'the declining winner''s candidacy goes terminal ''voided''');
select is(
  (select count(*)::int from public.dream_candidacies
    where edition_id = '01090000-0000-0000-0000-0000000000e4' and status = 'winner'),
  0, 'NO runner-up is promoted — nobody in the cycle holds ''winner'' after a decline');
select is(
  (select status from public.dream_candidacies where id = '01090000-0000-0000-0000-0000000000c6'),
  'voided', 'the runner-up is voided with the field, not promoted (FUND-SPEC §4 non-goal)');
select is(
  (select winner_confirmed_at from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e4'),
  null, 'a declined cycle closes with winner_confirmed_at still NULL');
select is(
  (select confirmed_pool_cents from public.fund_editions where id = '01090000-0000-0000-0000-0000000000e4'),
  150000::bigint, 'the snapshot survives closure — the historical figure the winner declined at');
select is(
  (select count(*)::int from public.audit_log
    where edition_id = '01090000-0000-0000-0000-0000000000e4'
      and action = 'winner_decline'
      and candidacy_id = '01090000-0000-0000-0000-0000000000c5'),
  1, 'one audit_log row records the decline, pointing at the declining winner');

-- rule #1 tooth: nothing in the announcement family emits Aura
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('01090000-0000-0000-0000-000000000001',
                         '01090000-0000-0000-0000-000000000002',
                         '01090000-0000-0000-0000-000000000003')),
  0, 'announcement, confirmation and decline emit zero aura_events (rule #1)');

-- ── both functions are service-role only ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01090000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e4') $$,
  '42501', null, 'authenticated cannot execute enter_announcement');
select throws_ok(
  $$ select public.record_winner_decision('01090000-0000-0000-0000-0000000000e4', 'confirm') $$,
  '42501', null, 'authenticated cannot execute record_winner_decision');
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.enter_announcement('01090000-0000-0000-0000-0000000000e4') $$,
  '42501', null, 'anon cannot execute enter_announcement');
select throws_ok(
  $$ select public.record_winner_decision('01090000-0000-0000-0000-0000000000e4', 'confirm') $$,
  '42501', null, 'anon cannot execute record_winner_decision');
reset role;

select * from finish();
rollback;
