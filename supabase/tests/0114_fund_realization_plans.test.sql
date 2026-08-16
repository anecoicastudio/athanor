-- #228 — realization plans, their phases, and the payout-ledger linkage.
-- FUND-25 (the plan's items), FUND-53 (money spent according to the plan), divergence D-14.
-- Asserts, in the database: the plan binds the cycle's CONFIRMED WINNER and only that;
-- one plan per cycle; a plan's phases can never promise more than the cycle's declared
-- payable (the same ceiling fund_payout_ledger caps releases at, ruling #244); a ledger
-- row's phase attribution cannot lie (wrong cycle, or more money than the phase costs);
-- public-read only once published, author + admin read a draft, every client write 42501.
-- Zero Aura from any of it (rule #1).
begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

-- fixture: park any live cycle (staging smoke; no-op in CI) — the 0108/0109/0110/0112 pattern
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01140000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'plan_win@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01140000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'plan_other@test.athanor', '{}'::jsonb, now(), now());

-- ── structure ───────────────────────────────────────────────────────────────────────────
select has_table('public', 'realization_plans', 'realization_plans exists');
select has_table('public', 'realization_plan_phases', 'realization_plan_phases exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.realization_plans'::regclass),
  'RLS enabled on realization_plans');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.realization_plan_phases'::regclass),
  'RLS enabled on realization_plan_phases');
select policies_are('public', 'realization_plans',
  array['realization_plans_select_published',
        'realization_plans_select_own',
        'realization_plans_select_admin'],
  'plans: exactly the published/own/admin selects — no client write policy');
select policies_are('public', 'realization_plan_phases',
  array['realization_plan_phases_select_published',
        'realization_plan_phases_select_own',
        'realization_plan_phases_select_admin'],
  'phases: exactly the published/own/admin selects — no client write policy');
select has_trigger('public', 'realization_plans', 'realization_plans_touch_updated_at',
  'realization_plans carries the touch_updated_at trigger');
select has_trigger('public', 'realization_plan_phases', 'realization_plan_phases_touch_updated_at',
  'realization_plan_phases carries the touch_updated_at trigger');
select has_trigger('public', 'realization_plans', 'realization_plans_binds_winner',
  'realization_plans carries the winner-binding trigger');
select has_trigger('public', 'realization_plan_phases', 'realization_plan_phases_within_payable',
  'realization_plan_phases carries the within-payable trigger');
select has_column('public', 'fund_payout_ledger', 'plan_phase_id',
  'the payout ledger carries the phase linkage (#228) — no second money ledger');
select col_is_null('public', 'fund_payout_ledger', 'plan_phase_id',
  'plan_phase_id is nullable: pre-plan releases stay representable, forever');

-- ── fixture: three cycles ───────────────────────────────────────────────────────────────
--   e1 — announced, pool 50000 / split 10 → payable 45000, winner c1 CONFIRMED
--   e2 — closed realized, pool 20000 / split 10 → payable 18000, winner c2, NOT yet confirmed
--   e3 — closed voided, no winner at all
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01140000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'announcement', false, false,
          100000, 1, 1, 10, 'fixture costs statement', 'none', 50000);
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open,
                                  contributions_enabled, min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01140000-0000-0000-0000-0000000000e2', now() + interval '30 days', 100000, 'closed', 'realized',
          false, false, 1, 1, 1, 10, 'fixture costs statement', 'none', 20000);
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open,
                                  contributions_enabled, min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01140000-0000-0000-0000-0000000000e3', now() + interval '30 days', 100, 'closed', 'voided_underfunded',
          false, false, 1, 1, 1, 10, 'void fixture', 'none');
insert into public.payout_accounts (profile_id, stripe_account_id, charges_enabled, payouts_enabled)
  values ('01140000-0000-0000-0000-000000000001', 'acct_0114_win', true, true);
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('01140000-0000-0000-0000-0000000000c1', '01140000-0000-0000-0000-0000000000e1',
   '01140000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner'),
  ('01140000-0000-0000-0000-0000000000c2', '01140000-0000-0000-0000-0000000000e2',
   '01140000-0000-0000-0000-000000000002', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner');

set local role service_role;
update public.fund_editions
   set winner_candidacy_id = '01140000-0000-0000-0000-0000000000c1', winner_confirmed_at = now()
 where id = '01140000-0000-0000-0000-0000000000e1';
update public.fund_editions
   set winner_candidacy_id = '01140000-0000-0000-0000-0000000000c2'   -- confirmation withheld on purpose
 where id = '01140000-0000-0000-0000-0000000000e2';

-- ── the plan binds the cycle's confirmed winner, and nothing else ────────────────────────
select throws_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result)
     values ('01140000-0000-0000-0000-0000000000e3', '01140000-0000-0000-0000-0000000000c1', 'o', 'r') $$,
  'P0001', 'no winner declared', 'a cycle without a winner has nothing to plan');
select throws_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result)
     values ('01140000-0000-0000-0000-0000000000e2', '01140000-0000-0000-0000-0000000000c2', 'o', 'r') $$,
  'P0001', 'viability not confirmed',
  'an unconfirmed winner (#220) cannot have a plan released against');
select throws_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result)
     values ('01140000-0000-0000-0000-0000000000e1', '01140000-0000-0000-0000-0000000000c2', 'o', 'r') $$,
  'P0001', 'plan does not bind the cycle winner',
  'a plan for someone else''s candidacy is refused, service role included');
select lives_ok(
  $$ insert into public.realization_plans (id, edition_id, candidacy_id, objective, expected_result,
                                           professionals, suppliers)
     values ('01140000-0000-0000-0000-0000000000a1', '01140000-0000-0000-0000-0000000000e1',
             '01140000-0000-0000-0000-0000000000c1', 'obiettivo', 'risultato atteso',
             'un ceramista', '') $$,
  'the confirmed winner''s plan lands');
select throws_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result)
     values ('01140000-0000-0000-0000-0000000000e1', '01140000-0000-0000-0000-0000000000c1', 'o2', 'r2') $$,
  '23505', null, 'one plan per cycle — the second is a unique violation');

-- fixture: confirm e2's winner and give it its own plan + phase (the cross-cycle case below)
update public.fund_editions set winner_confirmed_at = now()
 where id = '01140000-0000-0000-0000-0000000000e2';
insert into public.realization_plans (id, edition_id, candidacy_id, objective, expected_result)
  values ('01140000-0000-0000-0000-0000000000a2', '01140000-0000-0000-0000-0000000000e2',
          '01140000-0000-0000-0000-0000000000c2', 'obiettivo 2', 'risultato 2');
insert into public.realization_plan_phases (id, plan_id, sort, title, scheduled_for, amount_cents,
                                            verification_criteria)
  values ('01140000-0000-0000-0000-0000000000f3', '01140000-0000-0000-0000-0000000000a2', 1,
          'fase e2', current_date, 5000, 'criterio');

-- ── the phase sum never promises more money than the cycle has ───────────────────────────
select lives_ok(
  $$ insert into public.realization_plan_phases (id, plan_id, sort, title, scheduled_for, amount_cents,
                                                 verification_criteria)
     values ('01140000-0000-0000-0000-0000000000f1', '01140000-0000-0000-0000-0000000000a1', 1,
             'allestimento', current_date, 20000, 'contratto firmato') $$,
  'a phase within the declared payable lands');
select lives_ok(
  $$ insert into public.realization_plan_phases (id, plan_id, sort, title, scheduled_for, amount_cents,
                                                 verification_criteria)
     values ('01140000-0000-0000-0000-0000000000f2', '01140000-0000-0000-0000-0000000000a1', 2,
             'apertura', current_date + 30, 25000, 'foto e registro') $$,
  'phases summing exactly to payable are legal (20000 + 25000 = 45000)');
select throws_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for, amount_cents,
                                                 verification_criteria)
     values ('01140000-0000-0000-0000-0000000000a1', 3, 'una fase di troppo', current_date, 1, 'c') $$,
  'P0001', 'phases exceed declared payable',
  'one cent past payable and no phase lands — a plan cannot promise money that does not exist');
select is(
  (select sum(amount_cents)::bigint from public.realization_plan_phases
    where plan_id = '01140000-0000-0000-0000-0000000000a1'),
  45000::bigint, 'the plan''s phases reconcile to the cycle''s declared payable, not a cent more');

-- ── phase row shape (asserted on plan a2, which still has headroom) ──────────────────────
select throws_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for, amount_cents,
                                                 verification_criteria)
     values ('01140000-0000-0000-0000-0000000000a2', 2, 'gratis', current_date, 0, 'c') $$,
  '23514', null, 'a zero-euro phase violates its CHECK — a phase IS a tranche');
select throws_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for, amount_cents,
                                                 verification_criteria)
     values ('01140000-0000-0000-0000-0000000000a2', 2, '   ', current_date, 1000, 'c') $$,
  '23514', null, 'a blank title violates its CHECK');
select throws_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for, amount_cents,
                                                 verification_criteria)
     values ('01140000-0000-0000-0000-0000000000a2', 1, 'stessa posizione', current_date, 1000, 'c') $$,
  '23505', null, 'two phases cannot share a position within one plan');

-- ── the linkage: a release is attributable, and the attribution cannot lie ───────────────
select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents,
        stripe_transfer_id, plan_phase_id)
     values ('01140000-0000-0000-0000-0000000000e1', 'acct_0114_win', 20000, 50000, 10, 45000,
             'tr_0114_1', '01140000-0000-0000-0000-0000000000f1') $$,
  'a transfer records the phase it funded');
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents,
        stripe_transfer_id, plan_phase_id)
     values ('01140000-0000-0000-0000-0000000000e1', 'acct_0114_win', 1, 50000, 10, 45000,
             'tr_0114_2', '01140000-0000-0000-0000-0000000000f1') $$,
  'P0001', 'released exceeds phase amount',
  'a phase cannot be over-funded even while the cycle still has payable headroom');
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents,
        stripe_transfer_id, plan_phase_id)
     values ('01140000-0000-0000-0000-0000000000e1', 'acct_0114_win', 1000, 50000, 10, 45000,
             'tr_0114_3', '01140000-0000-0000-0000-0000000000fe') $$,
  'P0001', 'plan phase not found', 'an unknown phase refuses before the FK even fires');
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents,
        stripe_transfer_id, plan_phase_id)
     values ('01140000-0000-0000-0000-0000000000e1', 'acct_0114_win', 1000, 50000, 10, 45000,
             'tr_0114_4', '01140000-0000-0000-0000-0000000000f3') $$,
  'P0001', 'plan phase belongs to another cycle',
  'a phase from a different cycle cannot absorb this cycle''s money');
select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents,
        stripe_transfer_id)
     values ('01140000-0000-0000-0000-0000000000e1', 'acct_0114_win', 5000, 50000, 10, 45000,
             'tr_0114_5') $$,
  'an unattributed release still lands — pre-plan and plan-less cycles stay releasable');
reset role;

-- ── reads: a draft is not published ──────────────────────────────────────────────────────
set local role anon;
select is(
  (select count(*)::bigint from public.realization_plans),
  0::bigint, 'anon reads no unpublished plan');
select is(
  (select count(*)::bigint from public.realization_plan_phases),
  0::bigint, 'anon reads no phase of an unpublished plan');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::bigint from public.realization_plans),
  1::bigint, 'the author reads their own draft plan (#229''s authoring screen)');
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::bigint from public.realization_plans
    where edition_id = '01140000-0000-0000-0000-0000000000e1'),
  0::bigint, 'another member sees nothing of a draft that is not theirs');
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}';
select is(
  (select count(*)::bigint from public.realization_plans),
  2::bigint, 'an admin reads every plan, draft included');

-- ── no client write, in either direction (rule #2 / rule #6) ─────────────────────────────
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result)
     values ('01140000-0000-0000-0000-0000000000e1', '01140000-0000-0000-0000-0000000000c1', 'o', 'r') $$,
  '42501', null, 'client cannot insert a plan — even the winner''s own (#229 writes it)');
select throws_ok(
  $$ update public.realization_plans set objective = 'riscritto' $$,
  '42501', null, 'client cannot rewrite a plan');
select throws_ok(
  $$ delete from public.realization_plans $$,
  '42501', null, 'client cannot delete a plan');
select throws_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for, amount_cents,
                                                 verification_criteria)
     values ('01140000-0000-0000-0000-0000000000a1', 9, 'fase mia', current_date, 1, 'c') $$,
  '42501', null, 'client cannot add a phase — no self-served tranche');
select throws_ok(
  $$ update public.realization_plan_phases set verified_at = now() $$,
  '42501', null, 'client cannot mark their own phase verified (#231''s gate is service-side)');
reset role;

-- ── publication opens the transparency surface (#237/#230), and only then ────────────────
set local role service_role;
update public.realization_plans set published_at = now()
 where id = '01140000-0000-0000-0000-0000000000a1';
reset role;

set local role anon;
select is(
  (select count(*)::bigint from public.realization_plans),
  1::bigint, 'a published plan is world-readable, signed out');
select is(
  (select count(*)::bigint from public.realization_plan_phases),
  2::bigint, 'its phases become world-readable with it, and only with it');
reset role;

-- ── rule #1 tooth: planning and funding a realization earns ZERO Aura ────────────────────
-- Scoped to the fixture profiles so the assertion also holds on a seeded world (staging).
select is(
  (select count(*)::int from public.aura_events
   where profile_id in ('01140000-0000-0000-0000-000000000001',
                        '01140000-0000-0000-0000-000000000002')),
  0, 'no aura_events for either fixture profile (authoring a plan = 0 Aura)');

select * from finish();
rollback;
