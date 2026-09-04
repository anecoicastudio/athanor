-- #247 — fund_payout_ledger: the transfer path's ledger (ruling #244). SRW posture
-- (owner + admin read, every client write 42501, service_role — the stripe-webhook
-- transfer arms — writes), the #232 basis freeze (a row's basis must match the cycle's
-- frozen declared economics), and the #244 cap (released-net never exceeds payable,
-- reversals restore headroom). Zero Aura from anything here (rule #1).
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- fixture: park any live cycle (staging smoke; no-op in CI) — the 0108/0109/0110 pattern
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01120000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'led_win@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01120000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'led_other@test.athanor', '{}'::jsonb, now(), now());

-- ── structure ───────────────────────────────────────────────────────────────────────────
select has_table('public', 'fund_payout_ledger', 'fund_payout_ledger exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fund_payout_ledger'::regclass),
  'RLS enabled on fund_payout_ledger');
select policies_are('public', 'fund_payout_ledger',
  array['fund_payout_ledger_select_own', 'fund_payout_ledger_select_admin'],
  'exactly the owner-select and admin-select policies');
select has_trigger('public', 'fund_payout_ledger', 'fund_payout_ledger_touch_updated_at',
  'fund_payout_ledger carries the touch_updated_at trigger');
select has_trigger('public', 'fund_payout_ledger', 'fund_payout_ledger_within_basis',
  'fund_payout_ledger carries the within-basis trigger (#244 cap, #232 freeze)');

-- ── fixture: a confirmed cycle (pool 50000, split 10 → payable 45000) + the winner ──────
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01120000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'announcement', false, false,
          100000, 1, 1, 10, 'fixture costs statement', 'none', 50000);
insert into public.payout_accounts (profile_id, stripe_account_id, charges_enabled, payouts_enabled)
  values ('01120000-0000-0000-0000-000000000001', 'acct_0112_win', true, true);
-- a closed cycle that never reached its snapshot — the no-basis refusal below
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open,
                                  contributions_enabled, min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('01120000-0000-0000-0000-0000000000e2', now() + interval '30 days', 100, 'closed', 'voided_underfunded',
          false, false, 1, 1, 1, 10, 'void fixture', 'none');
reset role;

-- ── the webhook (service_role) records; the basis is checked where the row lands ────────
set local role service_role;
select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 20000, 50000, 10, 45000, 'tr_0112_1') $$,
  'service_role records a transfer within the declared payable');

-- row-level idempotency: the same Stripe transfer never lands twice. Tested here, with
-- headroom still open, so the unique violation is what fires — at payable the within-basis
-- trigger would refuse first (BEFORE triggers precede constraint checks).
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 1, 50000, 10, 45000, 'tr_0112_1') $$,
  '23505', null, 'a redelivered stripe_transfer_id is a unique violation, not a second row');

-- #232 freeze: a basis diverging from the cycle's frozen columns cannot land, even from
-- the service role — "never a figure chosen at transfer time" is a table property.
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 1000, 50000, 20, 40000, 'tr_0112_bad1') $$,
  'P0001', 'basis diverges from declared economics', 'a diverged split is refused');
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 1000, 60000, 10, 54000, 'tr_0112_bad2') $$,
  'P0001', 'basis diverges from declared economics', 'a diverged pool is refused');

-- the derivation CHECK: payable must be floor(pool × (100 − split) / 100), exactly
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 1000, 50000, 10, 46000, 'tr_0112_bad3') $$,
  '23514', null, 'a payable not derived from the basis violates its CHECK');

-- #244 cap: 20000 released; at-payable passes, one cent past refuses
select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 25000, 50000, 10, 45000, 'tr_0112_2') $$,
  'a release landing exactly at payable is legal (25000 + 20000 = 45000)');
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 1000, 50000, 10, 45000, 'tr_0112_3') $$,
  'P0001', 'released exceeds declared payable', 'past payable no row lands (#244)');

-- a reversal restores headroom: the return nets against what remains unreleased (#244)
select lives_ok(
  $$ update public.fund_payout_ledger set reversed_cents = 5000
     where stripe_transfer_id = 'tr_0112_2' $$,
  'the transfer.reversed arm nets a partial reversal onto the row');
select lives_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 5000, 50000, 10, 45000, 'tr_0112_3') $$,
  'the reversed 5000 releases again — released-net honours reversals');

-- reconciliation invariant, stated as data: released-net equals payable, never above it
select is(
  (select sum(amount_cents - reversed_cents)::bigint from public.fund_payout_ledger
    where edition_id = '01120000-0000-0000-0000-0000000000e1'),
  45000::bigint, 'released-net reconciles to the declared payable, not a cent more');

-- row shape: reversal bounded by amount; the status vocabulary is arithmetic, not free
select throws_ok(
  $$ update public.fund_payout_ledger set reversed_cents = 99999
     where stripe_transfer_id = 'tr_0112_1' $$,
  '23514', null, 'a reversal past the amount violates its CHECK');
select throws_ok(
  $$ update public.fund_payout_ledger set status = 'reversed'
     where stripe_transfer_id = 'tr_0112_1' $$,
  '23514', null, 'status ''reversed'' with money still out violates the shape CHECK');
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e2', 'acct_0112_win', 1000, 50000, 10, 45000, 'tr_0112_4') $$,
  'P0001', 'no confirmed pool', 'a cycle that never snapshotted has no payable to release against');
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-00000000dead', 'acct_0112_win', 1000, 50000, 10, 45000, 'tr_0112_5') $$,
  'P0001', 'edition not found', 'an unknown cycle refuses before the FK even fires');

reset role;

-- ── reads: anon nothing, owner own, stranger nothing, admin everything ──────────────────
set local role anon;
select throws_ok(
  $$ select * from public.fund_payout_ledger $$,
  '42501', null, 'anon cannot read the payout ledger');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::bigint from public.fund_payout_ledger),
  3::bigint, 'the winner reads their own payout rows (via their payout account)');
set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::bigint from public.fund_payout_ledger),
  0::bigint, 'another member sees no payout rows (RLS filters)');

-- no client write (rule #6): the grant strips writes before RLS is even consulted
select throws_ok(
  $$ insert into public.fund_payout_ledger
       (edition_id, destination_account_id, amount_cents, pool_cents, split_pct, payable_cents, stripe_transfer_id)
     values ('01120000-0000-0000-0000-0000000000e1', 'acct_0112_win', 1, 50000, 10, 45000, 'tr_0112_hax') $$,
  '42501', null, 'client cannot insert a payout row');
select throws_ok(
  $$ update public.fund_payout_ledger set amount_cents = 1 $$,
  '42501', null, 'client cannot update a payout row (no self-served releases)');
select throws_ok(
  $$ delete from public.fund_payout_ledger $$,
  '42501', null, 'client cannot delete a payout row');

set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}';
select is(
  (select count(*)::bigint from public.fund_payout_ledger),
  3::bigint, 'an admin reads every payout row (the §20 report''s view)');
reset role;

-- rule #1 tooth: recording payouts emits ZERO aura events. Scoped to the fixture profiles
-- so the assertion also holds on a seeded world (staging).
select is(
  (select count(*)::int from public.aura_events
   where profile_id in ('01120000-0000-0000-0000-000000000001',
                        '01120000-0000-0000-0000-000000000002')),
  0, 'no aura_events for either fixture profile (a payout = 0 Aura)');

select * from finish();
rollback;
