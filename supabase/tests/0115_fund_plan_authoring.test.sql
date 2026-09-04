-- #229 — the winner authors the realization plan, then publishes it.
-- FUND-25, FUND-53 · D25 («authored after selection, re-costed to the actual pool»).
-- 0114 owns #228's shape (the tables, the binds-winner trigger, the payable ceiling, the
-- ledger linkage, service-role visibility). This file owns the WRITE PATH that issue left
-- open: who may draft, what the draft state permits, what publication refuses, and what
-- stops being writable the moment the plan becomes the public commitment.
--
-- The whole story runs as a CLIENT, deliberately. Every write below is `set local role
-- authenticated` with a jwt claim, because the claim #229 makes is about members writing
-- through RLS — a service-role fixture would prove nothing about it.
--
-- No row is addressed by a literal id: `id` is deliberately NOT in the INSERT grants, so a
-- client cannot choose one. Rows are reached the way the app reaches them — the plan by its
-- unique edition_id, a phase by (plan_id, sort).
begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

-- fixture: park any live cycle (staging smoke; no-op in CI) — the 0108/0110/0114 pattern
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01150000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'plan_author@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01150000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'plan_stranger@test.athanor', '{}'::jsonb, now(), now());

-- ── the privileges RLS cannot express ───────────────────────────────────────────────────
-- Two columns stay unreachable from a client whatever a policy says: publication is a
-- function's, and verification is #231's service-side gate.
select ok(
  has_function_privilege('authenticated', 'public.publish_realization_plan(uuid)', 'execute'),
  'the author''s role may call publish_realization_plan');
select ok(
  not has_function_privilege('anon', 'public.publish_realization_plan(uuid)', 'execute'),
  'anon may not — publication is a member act, never an anonymous one');
select is_definer('public', 'publish_realization_plan', array['uuid'],
  'publish_realization_plan is SECURITY DEFINER: published_at and fund_editions are both closed to clients');
select ok(
  not has_column_privilege('authenticated', 'public.realization_plans', 'published_at', 'update'),
  'no client can UPDATE published_at — publication is the function, not a column write');
select ok(
  not has_column_privilege('authenticated', 'public.realization_plan_phases', 'verified_at', 'update'),
  'no client can UPDATE verified_at — no self-served verification (#231)');
select ok(
  has_column_privilege('authenticated', 'public.realization_plan_phases', 'amount_cents', 'update'),
  're-costing a draft phase is an UPDATE, granted by name');
select ok(
  not has_table_privilege('authenticated', 'public.realization_plans', 'delete'),
  'a plan is never client-deleted — one per cycle, corrected by editing');

-- ── fixture: two cycles, each with a confirmed winner ────────────────────────────────────
--   e1 — announcement, pool 50000 / split 10 → payable 45000, winner c1 (author) confirmed
--   e2 — closed realized, pool 20000 / split 10, winner c2 (stranger) confirmed: the
--        out-of-phase publication case
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01150000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'announcement', false, false,
          100000, 1, 1, 10, 'fixture costs statement', 'none', 50000);
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open,
                                  contributions_enabled, min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01150000-0000-0000-0000-0000000000e2', now() + interval '30 days', 100000, 'closed', 'realized',
          false, false, 1, 1, 1, 10, 'fixture costs statement', 'none', 20000);
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('01150000-0000-0000-0000-0000000000c1', '01150000-0000-0000-0000-0000000000e1',
   '01150000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner'),
  ('01150000-0000-0000-0000-0000000000c2', '01150000-0000-0000-0000-0000000000e2',
   '01150000-0000-0000-0000-000000000002', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner');

set local role service_role;
update public.fund_editions
   set winner_candidacy_id = '01150000-0000-0000-0000-0000000000c1', winner_confirmed_at = now()
 where id = '01150000-0000-0000-0000-0000000000e1';
update public.fund_editions
   set winner_candidacy_id = '01150000-0000-0000-0000-0000000000c2', winner_confirmed_at = now()
 where id = '01150000-0000-0000-0000-0000000000e2';
reset role;

-- ── the winner drafts, as a client ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01150000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result,
                                           professionals, suppliers)
     values ('01150000-0000-0000-0000-0000000000e1', '01150000-0000-0000-0000-0000000000c1',
             'aprire il laboratorio', 'un laboratorio aperto al quartiere', 'un ceramista', '') $$,
  'the confirmed winner drafts their own plan — no relay, no service role');
select is(
  (select published_at from public.realization_plans
    where edition_id = '01150000-0000-0000-0000-0000000000e1'),
  null::timestamptz, 'it lands as a DRAFT: the client cannot set published_at, so it defaults null');

select lives_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for,
                                                 amount_cents, verification_criteria)
     values ((select id from public.realization_plans
               where edition_id = '01150000-0000-0000-0000-0000000000e1'),
             1, 'allestimento', current_date, 20000, 'contratto firmato') $$,
  'the author adds a phase to their draft');
-- The ceiling is #228's trigger, but it has never been crossed by a CLIENT before: the
-- refusal must reach the member as that same named refusal, not as a policy denial.
select throws_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for,
                                                 amount_cents, verification_criteria)
     values ((select id from public.realization_plans
               where edition_id = '01150000-0000-0000-0000-0000000000e1'),
             2, 'troppo', current_date, 25001, 'c') $$,
  'P0001', 'phases exceed declared payable',
  'a client cannot cost a plan past the money that exists (20000 + 25001 > 45000)');
select lives_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for,
                                                 amount_cents, verification_criteria)
     values ((select id from public.realization_plans
               where edition_id = '01150000-0000-0000-0000-0000000000e1'),
             2, 'apertura', current_date + 30, 25000, 'foto e registro') $$,
  're-costed to the pool, the same phase lands (20000 + 25000 = 45000)');
select throws_ok(
  $$ update public.realization_plan_phases set amount_cents = 25001 where sort = 2 $$,
  'P0001', 'phases exceed declared payable',
  'the ceiling holds on the UPDATE path too — re-costing upward is refused');

select lives_ok(
  $$ update public.realization_plans set objective = 'aprire il laboratorio di ceramica'
      where edition_id = '01150000-0000-0000-0000-0000000000e1' $$,
  'the author edits their draft''s prose');
select lives_ok(
  $$ update public.realization_plan_phases set title = 'allestimento e collaudo' where sort = 1 $$,
  'the author edits a draft phase — an UPDATE, never delete-and-recreate');
select throws_ok(
  $$ update public.realization_plan_phases set verified_at = now() where sort = 1 $$,
  '42501', null,
  'the author cannot verify their own phase: verified_at is granted to nobody (#231)');
select throws_ok(
  $$ delete from public.realization_plans $$,
  '42501', null, 'the author cannot delete the plan itself');

-- ── a member who is not the winner ───────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"01150000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result)
     values ('01150000-0000-0000-0000-0000000000e1', '01150000-0000-0000-0000-0000000000c1',
             'il mio piano per il sogno di un altro', 'r') $$,
  '42501', null, 'a stranger cannot author a plan against someone else''s candidacy');
select is(
  (select count(*)::bigint from public.realization_plans),
  0::bigint, 'a stranger cannot even see the draft');
-- RLS filters an UPDATE/DELETE rather than raising, so these are attempts, not assertions —
-- what they cost is measured back in the author's session, below.
update public.realization_plans set objective = 'dirottato';
delete from public.realization_plan_phases;
select throws_ok(
  $$ select public.publish_realization_plan(
       (select id from public.realization_plans
         where edition_id = '01150000-0000-0000-0000-0000000000e1')) $$,
  'P0001', 'plan not found',
  'and a stranger cannot publish it — invisible to their SELECT, so the id itself is out of reach');

-- ── back in the author's session: nothing the stranger did landed ────────────────────────
set local request.jwt.claims = '{"sub":"01150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select objective from public.realization_plans
    where edition_id = '01150000-0000-0000-0000-0000000000e1'),
  'aprire il laboratorio di ceramica', 'the stranger''s UPDATE reached no row');
select is(
  (select count(*)::bigint from public.realization_plan_phases),
  2::bigint, 'the stranger''s DELETE reached no phase');

-- ── the publication ladder ───────────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.publish_realization_plan('01150000-0000-0000-0000-0000000000fe') $$,
  'P0001', 'plan not found', 'an unknown plan refuses before anything else');

-- A plan with no tranches is nothing for #231 to verify and nothing for the sweep to
-- release. Asserted by emptying the draft, then restoring it — which is also the honest
-- proof that a DRAFT phase is deletable (nothing has funded it; after publication it is
-- not, because fund_payout_ledger.plan_phase_id is ON DELETE SET NULL).
delete from public.realization_plan_phases;
select is(
  (select count(*)::bigint from public.realization_plan_phases),
  0::bigint, 'the author CAN delete a phase while the plan is a draft');
select throws_ok(
  $$ select public.publish_realization_plan(
       (select id from public.realization_plans
         where edition_id = '01150000-0000-0000-0000-0000000000e1')) $$,
  'P0001', 'plan has no phases', 'an empty plan cannot be published');
-- Restored one notch UNDER payable (40000 of 45000), not at it. A plan costed to the last
-- cent would make the next assertion lie: BEFORE triggers run ahead of the RLS WITH CHECK,
-- so an append to a full published plan is refused by the ceiling and the policy never gets
-- to speak. Leaving headroom is what makes «no client write after publication» the reason.
insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for,
                                            amount_cents, verification_criteria)
select p.id, v.sort, v.title, v.d, v.amount, 'criterio'
  from public.realization_plans p,
       (values (1, 'allestimento', current_date, 20000::bigint),
               (2, 'apertura', current_date + 30, 20000::bigint)) as v(sort, title, d, amount)
 where p.edition_id = '01150000-0000-0000-0000-0000000000e1';

select lives_ok(
  $$ select public.publish_realization_plan(
       (select id from public.realization_plans
         where edition_id = '01150000-0000-0000-0000-0000000000e1')) $$,
  'the winner publishes the plan they authored');
select isnt(
  (select published_at from public.realization_plans
    where edition_id = '01150000-0000-0000-0000-0000000000e1'),
  null::timestamptz, 'published_at is stamped');
select is(
  (select phase from public.fund_editions where id = '01150000-0000-0000-0000-0000000000e1'),
  'realization', 'and the cycle enters realization WITH its plan, never before it');
select throws_ok(
  $$ select public.publish_realization_plan(
       (select id from public.realization_plans
         where edition_id = '01150000-0000-0000-0000-0000000000e1')) $$,
  'P0001', 'plan already published', 'publication happens once');

-- ── after publication the commitment is frozen to the client ─────────────────────────────
update public.realization_plans set objective = 'riscritto dopo la pubblicazione';
select is(
  (select objective from public.realization_plans
    where edition_id = '01150000-0000-0000-0000-0000000000e1'),
  'aprire il laboratorio di ceramica',
  'the author''s own UPDATE no longer reaches the row: a published plan is a commitment');
select throws_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for,
                                                 amount_cents, verification_criteria)
     values ((select id from public.realization_plans
               where edition_id = '01150000-0000-0000-0000-0000000000e1'),
             3, 'fase aggiunta dopo', current_date, 1, 'c') $$,
  '42501', null, 'no phase may be appended to a published plan');
update public.realization_plan_phases set amount_cents = 19000 where sort = 1;
select is(
  (select amount_cents from public.realization_plan_phases where sort = 1),
  20000::bigint, 'a published phase cannot be re-costed by its author');
delete from public.realization_plan_phases where sort = 2;
select is(
  (select count(*)::bigint from public.realization_plan_phases),
  2::bigint,
  'and cannot be deleted — which is what keeps a funded release''s attribution (ON DELETE SET NULL) from being silently dropped');
reset role;

-- ── publication is what opens the transparency surface (#237/#230) ───────────────────────
set local role anon;
select is(
  (select count(*)::bigint from public.realization_plans),
  1::bigint, 'the published plan is world-readable, signed out');
select is(
  (select count(*)::bigint from public.realization_plan_phases),
  2::bigint, 'its phases with it');
select throws_ok(
  $$ select public.publish_realization_plan('01150000-0000-0000-0000-0000000000fe') $$,
  '42501', null, 'anon cannot call the publication function at all (no execute grant)');
reset role;

-- ── out of phase: a closed cycle publishes nothing ───────────────────────────────────────
-- ('viability not confirmed' is unreachable from here by construction: #228's binds_winner
-- trigger refuses the INSERT of a plan on an unconfirmed cycle, so no such plan can exist
-- to publish. The function still states the precondition — 0114 asserts the trigger.)
set local role authenticated;
set local request.jwt.claims = '{"sub":"01150000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ insert into public.realization_plans (edition_id, candidacy_id, objective, expected_result)
     values ('01150000-0000-0000-0000-0000000000e2', '01150000-0000-0000-0000-0000000000c2',
             'obiettivo 2', 'risultato 2') $$,
  'a past cycle''s winner can still draft (the trigger only asks for a confirmed winner)');
select lives_ok(
  $$ insert into public.realization_plan_phases (plan_id, sort, title, scheduled_for,
                                                 amount_cents, verification_criteria)
     values ((select id from public.realization_plans
               where edition_id = '01150000-0000-0000-0000-0000000000e2'),
             1, 'fase e2', current_date, 5000, 'criterio') $$,
  'with a phase inside its own cycle''s payable');
select throws_ok(
  $$ select public.publish_realization_plan(
       (select id from public.realization_plans
         where edition_id = '01150000-0000-0000-0000-0000000000e2')) $$,
  'P0001', 'publication out of phase',
  'but a closed cycle cannot be moved into realization by publishing a plan');
reset role;

-- (The exhaustive policy catalogue for both tables stays in 0114's structure section — one
-- home, so a future policy is one edit and not two that can disagree.)

-- ── the transition is journaled like every other fund-state change ───────────────────────
select is(
  (select count(*)::bigint from public.audit_log
    where action = 'publish_plan'
      and edition_id = '01150000-0000-0000-0000-0000000000e1'
      and actor_id = '01150000-0000-0000-0000-000000000001'),
  1::bigint, 'publication writes one audit row, and it names the member who published');
select is(
  (select report_id from public.audit_log where action = 'publish_plan'
    and edition_id = '01150000-0000-0000-0000-0000000000e1'),
  null::uuid, 'shaped as a fund row, not a moderation one (audit_log_fund_shape)');

-- ── rule #1 tooth: authoring and publishing a plan earns ZERO Aura ───────────────────────
select is(
  (select count(*)::int from public.aura_events
   where profile_id in ('01150000-0000-0000-0000-000000000001',
                        '01150000-0000-0000-0000-000000000002')),
  0, 'no aura_events for either fixture profile (authoring + publishing a plan = 0 Aura)');

select * from finish();
rollback;
