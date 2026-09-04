-- #236 / FUND-51 — the optional fee coverage and the split a refund needs.
--
-- The property this file exists to pin: `amount_cents` IS THE GIFT. Five live functions
-- read it as the pool (recompute_fund_aggregate, enter_announcement, declare_winner,
-- close_cycle, rollover_voided); if a later change ever re-points the column at Stripe's
-- charge, the public ticker starts counting processing costs as generosity and the FUND-42
-- floor becomes clearable with Stripe's fees. The aggregate assertion below is the tooth:
-- a covered contribution must move the ticker by the GIFT, never by the charge.
--
-- Also asserted: the €1 floor stays on the gift (coverage cannot smuggle a sub-€1
-- contribution over the line), the charge is derived and unwritable, and the new column
-- opens no client-write hole in a money table (rule #6).
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- fixture: park any live cycle (staging smoke; no-op in CI) — the 0108/0109/0110 pattern
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

-- two contributors (the handle_new_user trigger auto-creates their public.profiles rows)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01180000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'cover_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01180000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'cover_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── structure ───────────────────────────────────────────────────────────────────────────
select has_column('public', 'fund_contributions', 'coverage_cents',
  'fund_contributions carries coverage_cents');
select col_not_null('public', 'fund_contributions', 'coverage_cents',
  'coverage_cents is NOT NULL — «no coverage» is 0, never unknown');
select col_default_is('public', 'fund_contributions', 'coverage_cents', '0',
  'coverage_cents defaults to 0 — the unticked box is the default state (CRD Art. 22)');
select has_column('public', 'fund_contributions', 'charged_cents',
  'fund_contributions carries charged_cents');
select is(
  (select attgenerated from pg_attribute
    where attrelid = 'public.fund_contributions'::regclass and attname = 'charged_cents'),
  's',
  'charged_cents is a STORED generated column — no writer can drift it from its parts');

-- ── the split, written by the sole writer ───────────────────────────────────────────────
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01180000-0000-0000-0000-0000000000ed', now() + interval '10 days', 1000000, true,
          100000, 5, 3, 10, 'fixture costs statement', 'none');

-- A covered €1,00 gift: charged €1,27, coverage €0,27 — the gross-up #236 quotes.
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, coverage_cents, stripe_checkout_session_id, status)
     values ('01180000-0000-0000-0000-0000000000ed','01180000-0000-0000-0000-000000000001',
             100, 27, 'cs_covered', 'succeeded') $$,
  'service_role records a covered contribution');

-- An uncovered €5,00 gift: coverage omitted entirely, so the default carries it.
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
     values ('01180000-0000-0000-0000-0000000000ed','01180000-0000-0000-0000-000000000002',
             500, 'cs_plain', 'succeeded') $$,
  'a contribution written without a coverage lands at 0, not NULL');

select results_eq(
  $$ select amount_cents, coverage_cents, charged_cents from public.fund_contributions
     where stripe_checkout_session_id in ('cs_covered','cs_plain')
     order by amount_cents $$,
  $$ values (100::bigint, 27::bigint, 127::bigint),
            (500::bigint, 0::bigint, 500::bigint) $$,
  'charged_cents derives the Stripe charge; the uncovered row charges exactly the gift');

-- ── what the shape refuses ──────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, coverage_cents, stripe_checkout_session_id, status)
     values ('01180000-0000-0000-0000-0000000000ed','01180000-0000-0000-0000-000000000001',
             100, -27, 'cs_neg', 'succeeded') $$,
  '23514', null, 'a negative coverage is refused — it could only mean skimming the gift');

-- The floor is on the GIFT, never on the charge: €0,99 + €0,30 of «coverage» clears €1 as a
-- charge and is still refused, because the fund would receive less than the declared minimum.
select throws_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, coverage_cents, stripe_checkout_session_id, status)
     values ('01180000-0000-0000-0000-0000000000ed','01180000-0000-0000-0000-000000000001',
             99, 30, 'cs_underfloor', 'succeeded') $$,
  '23514', null, 'coverage cannot push a sub-€1 gift over the floor');

-- Generated means generated: even the service role cannot state the charge by hand.
select throws_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, coverage_cents, charged_cents,
        stripe_checkout_session_id, status)
     values ('01180000-0000-0000-0000-0000000000ed','01180000-0000-0000-0000-000000000001',
             100, 27, 999, 'cs_forged', 'succeeded') $$,
  '428C9', null, 'charged_cents cannot be written — it is the reconciliation handle, not an input');

-- Raising the coverage re-derives the charge in the same statement.
select lives_ok(
  $$ update public.fund_contributions set coverage_cents = 40
      where stripe_checkout_session_id = 'cs_plain' $$,
  'service_role can correct a coverage');
select is(
  (select charged_cents from public.fund_contributions
    where stripe_checkout_session_id = 'cs_plain'),
  540::bigint,
  'charged_cents follows its parts without anyone recomputing it');
-- put it back: the aggregate assertions below describe the original pair
update public.fund_contributions set coverage_cents = 0
 where stripe_checkout_session_id = 'cs_plain';
reset role;

-- ── the tooth: the ticker counts the GIFT, never the charge ─────────────────────────────
set local role service_role;
select public.recompute_fund_aggregate('01180000-0000-0000-0000-0000000000ed');
select results_eq(
  $$ select raised_cents, contributor_count from public.fund_aggregates
     where edition_id = '01180000-0000-0000-0000-0000000000ed' $$,
  $$ values (600::bigint, 2::bigint) $$,
  'raised_cents is 600 (100 + 500), NOT 627 — coverage is plumbing, not generosity');
reset role;

-- A refund returns the contribution, never the coverage (FUND-51). The operator refunds
-- `amount_cents`; the ticker is exact under either choice because it never counted the
-- coverage — the status flip removes precisely the gift.
set local role service_role;
update public.fund_contributions set status = 'refunded'
 where stripe_checkout_session_id = 'cs_covered';
select public.recompute_fund_aggregate('01180000-0000-0000-0000-0000000000ed');
select results_eq(
  $$ select raised_cents, contributor_count from public.fund_aggregates
     where edition_id = '01180000-0000-0000-0000-0000000000ed' $$,
  $$ values (500::bigint, 1::bigint) $$,
  'reversing a covered contribution removes the gift only — never the 27 the fund never held');
reset role;

-- ── the new column opens no client-write hole (rule #6) ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01180000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.fund_contributions set coverage_cents = 0 $$,
  '42501', null, 'a contributor cannot rewrite their own coverage');
reset role;

-- ── rule #1: covering fees mints nothing ────────────────────────────────────────────────
-- The contributor is new in this transaction, so any Aura at all would have come from here.
select is(
  (select count(*)::int from public.aura_events
    where profile_id = '01180000-0000-0000-0000-000000000001'),
  0, 'a covered contribution creates ZERO aura events (rule #1)');

select * from finish();
rollback;
