-- #231 — the tranche release gate: no verification, no money.
-- FUND-53 («il denaro raccolto dovrà essere utilizzato secondo il progetto approvato»),
-- FUND-24 (fund side) · docs/FUND-SPEC.md:197 · ruling on #244 · divergence D-14/D-15.
--
-- 0114 owns #228's shape (the tables, the binds-winner trigger, the payable ceiling, the
-- ledger linkage and its two coherence refusals). 0115 owns #229's write path (who drafts,
-- what publication refuses). This file owns what those two deliberately left unwired: the
-- transition that RECORDS a verification, and the property that makes the gate real —
-- a released tranche reconciles to a phase whose verification was recorded FIRST.
--
-- THE GATE'S DB HALF IS WHAT IS TESTED HERE. The refusal that stops a Stripe transfer lives
-- in release-fund-payout (logic.test.ts asserts it); what the database owes is (a) that
-- verified_at can be written by nothing but the service-role transition, and (b) that even
-- if that refusal were bypassed, the LEDGER still cannot record a tranche that lies about
-- which phase it funded or exceeds what that phase costed. Two independent gates, because
-- one of them is in TypeScript.
begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

-- fixture: park any live cycle (staging smoke; no-op in CI) — the 0108/0110/0114/0115 pattern
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01170000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'gate_winner@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01170000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'gate_stranger@test.athanor', '{}'::jsonb, now(), now());

-- ── 1. the transition's posture ─────────────────────────────────────────────────────────
-- Rule 8's database half: the gate is only real if the ONE thing that opens it is reachable
-- from nowhere a member can stand.
select has_function('public', 'verify_plan_phase', array['uuid', 'text'],
  'verify_plan_phase(uuid, text) exists — the transition that records a verification');
select ok(
  has_function_privilege('service_role', 'public.verify_plan_phase(uuid,text)', 'execute'),
  'service_role may call it — an operator-relayed admin act (RELEASE-RUNBOOK §9.4)');
select ok(
  not has_function_privilege('authenticated', 'public.verify_plan_phase(uuid,text)', 'execute'),
  'a signed-in member may NOT: a winner who could verify their own phase holds the gate on their own money');
select ok(
  not has_function_privilege('anon', 'public.verify_plan_phase(uuid,text)', 'execute'),
  'anon may not');
select isnt_definer('public', 'verify_plan_phase', array['uuid', 'text'],
  'INVOKER, not DEFINER: the only caller is the service role, which already reaches every column');
-- The column half of the same claim, restated here because it is THIS issue's invariant
-- (0115 asserts it too — it was true before anything wrote the column, and must stay true
-- now that something does).
select ok(
  not has_column_privilege('authenticated', 'public.realization_plan_phases', 'verified_at', 'update'),
  'no client can UPDATE verified_at — no self-served verification');
select ok(
  not has_column_privilege('anon', 'public.realization_plan_phases', 'verified_at', 'update'),
  'nor anon');

-- 'verify_phase' joins the fund family in BOTH audit constraints — the action list and the
-- shape rule. A journalled transition whose action the CHECK rejects would refuse at the
-- last statement, after the phase was already stamped.
select ok(
  (select count(*) from pg_constraint
    where conname = 'audit_log_action_check'
      and pg_get_constraintdef(oid) like '%verify_phase%') = 1,
  'audit_log_action_check admits verify_phase');
select ok(
  (select count(*) from pg_constraint
    where conname = 'audit_log_fund_shape'
      and pg_get_constraintdef(oid) like '%verify_phase%') = 1,
  'audit_log_fund_shape governs verify_phase — edition_id required, report_id and penalty null');

-- ── 2. fixture: one cycle in realization with a published, costed plan ──────────────────
--   e1 — realization, pool 50000 / split 10 → payable 45000, winner c1 confirmed
--   phases: sort 1 = 20000, sort 2 = 15000  (sum 35000 ≤ 45000)
--   e2 — closed 'realization_failed': the out-of-phase case (D33 — the delivery was
--        declared failed and the unreleased remainder carried to the successor, so no
--        further phase of it is verifiable), with its own plan
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01170000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'realization', false, false,
          100000, 1, 1, 10, 'fixture costs statement', 'none', 50000);
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open,
                                  contributions_enabled, min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01170000-0000-0000-0000-0000000000e2', now() + interval '30 days', 5000000, 'closed',
          'realization_failed', false, false, 100000, 1, 1, 10, 'fixture costs statement', 'none', 50000);
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('01170000-0000-0000-0000-0000000000c1', '01170000-0000-0000-0000-0000000000e1',
   '01170000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner'),
  ('01170000-0000-0000-0000-0000000000c2', '01170000-0000-0000-0000-0000000000e2',
   '01170000-0000-0000-0000-000000000002', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner');

set local role service_role;
update public.fund_editions
   set winner_candidacy_id = '01170000-0000-0000-0000-0000000000c1', winner_confirmed_at = now()
 where id = '01170000-0000-0000-0000-0000000000e1';
update public.fund_editions
   set winner_candidacy_id = '01170000-0000-0000-0000-0000000000c2', winner_confirmed_at = now()
 where id = '01170000-0000-0000-0000-0000000000e2';

insert into public.realization_plans (id, edition_id, candidacy_id, objective, expected_result,
                                      professionals, suppliers, published_at)
  values ('01170000-0000-0000-0000-0000000000a1', '01170000-0000-0000-0000-0000000000e1',
          '01170000-0000-0000-0000-0000000000c1', 'aprire il laboratorio',
          'un laboratorio aperto al quartiere', 'un ceramista', '', now());
-- e2's plan stays a DRAFT (published_at null): the unpublished-plan refusal needs one.
insert into public.realization_plans (id, edition_id, candidacy_id, objective, expected_result,
                                      professionals, suppliers)
  values ('01170000-0000-0000-0000-0000000000a2', '01170000-0000-0000-0000-0000000000e2',
          '01170000-0000-0000-0000-0000000000c2', 'un secondo sogno', 'un secondo risultato', '', '');

insert into public.realization_plan_phases (id, plan_id, sort, title, scheduled_for, amount_cents,
                                            verification_criteria)
values
  ('01170000-0000-0000-0000-0000000000f1', '01170000-0000-0000-0000-0000000000a1', 1,
   'allestimento', current_date + 10, 20000, 'foto del locale allestito e fattura del fornitore'),
  ('01170000-0000-0000-0000-0000000000f2', '01170000-0000-0000-0000-0000000000a1', 2,
   'primo corso', current_date + 40, 15000, 'registro delle presenze del primo corso'),
  ('01170000-0000-0000-0000-0000000000f3', '01170000-0000-0000-0000-0000000000a2', 1,
   'fase su piano non pubblicato', current_date + 10, 20000, 'criteri di una bozza');

insert into public.payout_accounts (profile_id, stripe_account_id, charges_enabled, payouts_enabled)
  values ('01170000-0000-0000-0000-000000000001', 'acct_0117_win', true, true);
reset role;

-- ── 3. the transition's refusal ladder ──────────────────────────────────────────────────
-- Every one raises BEFORE any write, so a refused verification leaves nothing behind —
-- asserted at the end of this block by the untouched verified_at.
set local role service_role;

select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-00000000dead', 'evidence') $$,
  'P0001', 'plan phase not found', 'an unknown phase is refused');

select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-0000000000f3', 'evidence') $$,
  'P0001', 'plan not published',
  'a phase of a DRAFT plan is refused — verifying it would let the criteria be rewritten after the judgement');

select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-0000000000f1', null) $$,
  'P0001', 'evidence required', 'the admin act carries its evidence — null is refused');
select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-0000000000f1', '   ') $$,
  'P0001', 'evidence required', 'whitespace is not evidence');
select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-0000000000f1', repeat('x', 1001)) $$,
  'P0001', 'evidence too long',
  'oversized evidence is a named refusal, not a bare 23514 from audit_log.reason');

select is(
  (select verified_at from public.realization_plan_phases
    where id = '01170000-0000-0000-0000-0000000000f1'),
  null,
  'after five refusals the phase is still unverified — every refusal raised before the write');
select is(
  (select count(*) from public.audit_log where action = 'verify_phase')::int,
  0,
  'and nothing was journalled');

-- ── 4. the transition succeeds, atomically ──────────────────────────────────────────────
select isnt(
  public.verify_plan_phase('01170000-0000-0000-0000-0000000000f1', 'foto allestimento + fattura 12/2026'),
  null,
  'the transition returns the stamp it wrote');

select isnt(
  (select verified_at from public.realization_plan_phases
    where id = '01170000-0000-0000-0000-0000000000f1'),
  null,
  'the phase is verified');
select is(
  (select verified_at from public.realization_plan_phases
    where id = '01170000-0000-0000-0000-0000000000f2'),
  null,
  'and its sibling phase is NOT — verification is per phase, which is what makes it a tranche gate');

select is(
  (select count(*) from public.audit_log
    where action = 'verify_phase'
      and edition_id = '01170000-0000-0000-0000-0000000000e1'
      and candidacy_id = '01170000-0000-0000-0000-0000000000c1'
      and actor_id is null)::int,
  1,
  'one audit row, on the cycle, operator-relayed (actor_id null like every other fund transition)');
select ok(
  (select reason from public.audit_log where action = 'verify_phase')
    like '%foto allestimento + fattura 12/2026%',
  'the evidence is journalled');
select ok(
  (select reason from public.audit_log where action = 'verify_phase')
    like '%20000 cents%',
  'and what the verification unlocks');
-- GDPR: audit_log does NOT cascade with the plan, so member-authored prose must not be
-- copied into it (20260816110227's reason-composition note).
select ok(
  (select reason from public.audit_log where action = 'verify_phase')
    not like '%foto del locale allestito e fattura del fornitore%',
  'the member-authored criteria are NOT copied into the audit row — the GDPR cascade must be able to remove them');
select ok(
  (select reason from public.audit_log where action = 'verify_phase')
    not like '%allestimento,%',
  'nor the member-authored phase title');

select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-0000000000f1', 'seconda valutazione') $$,
  'P0001', 'phase already verified',
  're-verifying is refused: a second judgement cannot silently replace the first while the tranche it released stands');

-- Out of phase: e2 closed 'realization_failed'. Its plan was a draft, so publish it the
-- hard way (service role) to isolate the PHASE refusal from the publication one — the
-- refusal under test must be the cycle's state, not the plan's.
update public.realization_plans set published_at = now()
 where id = '01170000-0000-0000-0000-0000000000a2';
select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-0000000000f3', 'evidence') $$,
  'P0001', 'verification out of phase',
  'a cycle whose realization was declared failed verifies nothing further — its remainder carried to the successor (D33)');

-- ── 5. the client cannot reach the gate by any other door ───────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"01170000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ update public.realization_plan_phases set verified_at = now()
      where id = '01170000-0000-0000-0000-0000000000f2' $$,
  '42501', null,
  'the WINNER cannot verify their own remaining phase by direct UPDATE');
select throws_ok(
  $$ select public.verify_plan_phase('01170000-0000-0000-0000-0000000000f2', 'lo dico io') $$,
  '42501', null,
  'nor by calling the transition — EXECUTE is service_role only');
select is(
  (select verified_at from public.realization_plan_phases
    where id = '01170000-0000-0000-0000-0000000000f2'),
  null,
  'phase 2 remains unverified after both attempts');

-- ── 6. the ledger half: a tranche reconciles to the plan ────────────────────────────────
-- The TypeScript refusal is asserted in release-fund-payout/logic.test.ts. What is asserted
-- here is the database's independent guarantee: the ledger cannot record an attribution
-- that lies, whatever the executor believed. These are #228's checks, exercised for the
-- first time through the column this issue populates.
reset role;
set local role service_role;

select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, plan_phase_id, destination_account_id, amount_cents, pool_cents, split_pct,
        payable_cents, stripe_transfer_id)
     values ('01170000-0000-0000-0000-0000000000e1', '01170000-0000-0000-0000-0000000000f1',
             'acct_0117_win', 12000, 50000, 10, 45000, 'tr_0117_1') $$,
  'a verified phase''s tranche is recorded against that phase');
select is(
  (select plan_phase_id from public.fund_payout_ledger where stripe_transfer_id = 'tr_0117_1'),
  '01170000-0000-0000-0000-0000000000f1'::uuid,
  'the attribution the webhook wrote is the one stored — #228''s column, populated at last');

-- The per-phase cap, THROUGH the webhook's write path: phase 1 costs 20000 and 12000 is
-- already released against it, so 8001 is one cent too many even though the CYCLE has
-- 33000 of payable headroom left. Without this the plan's costing would stop governing.
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, plan_phase_id, destination_account_id, amount_cents, pool_cents, split_pct,
        payable_cents, stripe_transfer_id)
     values ('01170000-0000-0000-0000-0000000000e1', '01170000-0000-0000-0000-0000000000f1',
             'acct_0117_win', 8001, 50000, 10, 45000, 'tr_0117_over') $$,
  'P0001', 'released exceeds phase amount',
  'per-phase released ≤ the phase''s amount holds through the ledger write, inside cycle headroom');
select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, plan_phase_id, destination_account_id, amount_cents, pool_cents, split_pct,
        payable_cents, stripe_transfer_id)
     values ('01170000-0000-0000-0000-0000000000e1', '01170000-0000-0000-0000-0000000000f1',
             'acct_0117_win', 8000, 50000, 10, 45000, 'tr_0117_2') $$,
  'exactly the remainder lands — the cap is ≤, not <');

-- Wrong cycle: f3 belongs to e2's plan.
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, plan_phase_id, destination_account_id, amount_cents, pool_cents, split_pct,
        payable_cents, stripe_transfer_id)
     values ('01170000-0000-0000-0000-0000000000e1', '01170000-0000-0000-0000-0000000000f3',
             'acct_0117_win', 100, 50000, 10, 45000, 'tr_0117_foreign') $$,
  'P0001', 'plan phase belongs to another cycle',
  'a tranche cannot be attributed to another cycle''s phase');

-- ── 7. the reconciliation invariant ─────────────────────────────────────────────────────
-- What FUND-53 actually claims, stated as a property rather than a path: every euro the
-- ledger attributes to a phase sits inside that phase's costed amount, and every attributed
-- phase belongs to the cycle whose ledger row names it. If this can be violated, «spent
-- according to the approved plan» is a sentence rather than a fact.
select is(
  (select count(*)::int from (
     select 1 from public.fund_payout_ledger l
       join public.realization_plan_phases f on f.id = l.plan_phase_id
      where l.plan_phase_id is not null
      group by l.plan_phase_id, f.amount_cents
     having sum(l.amount_cents - l.reversed_cents) > f.amount_cents) over_released),
  0,
  'no phase has more released against it than it costed — the ledger reconciles to the plan');
select is(
  (select count(*)::int from public.fund_payout_ledger l
     join public.realization_plan_phases f on f.id = l.plan_phase_id
     join public.realization_plans p on p.id = f.plan_id
    where l.plan_phase_id is not null and p.edition_id <> l.edition_id),
  0,
  'every attributed tranche names a phase of its own cycle');
select is(
  (select count(*)::int from public.fund_payout_ledger l
     join public.realization_plan_phases f on f.id = l.plan_phase_id
    where l.plan_phase_id is not null and f.verified_at is null),
  0,
  'THE GATE, as a property: nothing in the ledger is attributed to an unverified phase');

-- And the pre-plan corpus stays representable — the column is nullable forever, because
-- every tranche released before plans existed has no phase and must not become unrecordable.
select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct,
        payable_cents, stripe_transfer_id)
     values ('01170000-0000-0000-0000-0000000000e1', 'acct_0117_win', 100, 50000, 10, 45000,
             'tr_0117_legacy') $$,
  'an unattributed row still lands: the pre-#231 corpus stays recordable on redelivery');

-- ── 8. rule #1: the gate mints no Aura ──────────────────────────────────────────────────
-- Verifying a phase is the act that releases money. If ANY of it scored, reputation would
-- track money — the one thing the product's whole claim denies.
select is(
  (select count(*)::int from public.aura_events
    where profile_id = '01170000-0000-0000-0000-000000000001'),
  0,
  'the winner earned zero Aura from a verified phase and a released tranche');

select * from finish();
rollback;
