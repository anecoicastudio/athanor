begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- #216 — failure states: closure reason, announcement snapshot, carry-forward, 'voided',
-- and the fund_contributions.edition_id freeze. FUND-42/43/45 · D33/D34.
-- Fixture: any live cycle is parked 'closed' first (no-op in CI's empty stack; on the
-- staging smoke it frees fund_editions_one_active, all rolled back — the 0107 pattern).

-- ── structure ───────────────────────────────────────────────────────────────────────────
select col_is_null('public', 'fund_editions', 'closure_reason',
  'closure_reason is nullable — present only when closed');
select col_is_null('public', 'fund_editions', 'confirmed_pool_cents',
  'confirmed_pool_cents is nullable — #220''s announcement transition writes it');
select col_not_null('public', 'fund_editions', 'carried_in_cents',
  'carried_in_cents is not null — always readable (FUND-45)');
select col_default_is('public', 'fund_editions', 'carried_in_cents', '0',
  'carried_in_cents defaults to 0 — nothing carried, not unknown');
select has_function('public', 'fund_contributions_edition_frozen',
  'edition freeze trigger function exists');
select has_trigger('public', 'fund_contributions', 'fund_contributions_freeze_edition',
  'freeze trigger is attached to fund_contributions');

-- ── fixture ─────────────────────────────────────────────────────────────────────────────
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'f1600000-0000-0000-0000-000000000001',
        'authenticated', 'authenticated', 'voided@test.athanor', '{}'::jsonb, now(), now());

-- ── closure_reason: a failure must be nameable, an open cycle must not carry one ────────
set local role service_role;
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 1, 1, 1, 10, 'costs', 'none')$$,
  '23514', null, 'a closed cycle without closure_reason is refused');
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'candidacy', 'realized', 1, 1, 1, 10, 'costs', 'none')$$,
  '23514', null, 'an open cycle carrying closure_reason is refused');
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 'abandoned', 1, 1, 1, 10, 'costs', 'none')$$,
  '23514', null, 'a closure_reason outside the D33 vocabulary is refused');

-- all four legal reasons close a cycle (closed rows coexist — the one-active index is partial)
select lives_ok(
  $$insert into public.fund_editions
      (id, target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values ('f1600000-0000-0000-0000-0000000000e2', now(), 100, 'closed', 'realized',
              1, 1, 1, 10, 'costs', 'none')$$,
  'realized closes a cycle');
select lives_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 'voided_underfunded', 1, 1, 1, 10, 'costs', 'none')$$,
  'voided_underfunded closes a cycle (FUND-42 floor)');
select lives_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 'voided_quorum', 1, 1, 1, 10, 'costs', 'none')$$,
  'voided_quorum closes a cycle (FUND-43 turnout)');
select lives_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 'voided_declined', 1, 1, 1, 10, 'costs', 'none')$$,
  'voided_declined closes a cycle (D33 — winner declined)');

-- ── confirmed_pool_cents: never before announcement, never negative ─────────────────────
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, confirmed_pool_cents, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'candidacy', 100, 1, 1, 1, 10, 'costs', 'none')$$,
  '23514', null, 'a snapshot before announcement is refused — nothing has snapshotted yet');
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, confirmed_pool_cents, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 'realized', -1, 1, 1, 1, 10, 'costs', 'none')$$,
  '23514', null, 'a negative snapshot is refused');
select lives_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, confirmed_pool_cents, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 'realized', 4832810, 1, 1, 1, 10, 'costs', 'none')$$,
  'a closed cycle carries its announcement snapshot');

-- ── carried_in_cents: non-negative, distinct amount, never folded in (FUND-45) ──────────
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, closure_reason, carried_in_cents, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 'realized', -1, 1, 1, 1, 10, 'costs', 'none')$$,
  '23514', null, 'a negative carry-forward is refused');

-- the fixture cycle: the successor a voided predecessor carried into
select lives_ok(
  $$insert into public.fund_editions
      (id, target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values ('f1600000-0000-0000-0000-0000000000ed', now() + interval '30 days', 5000000, 'voting',
              100000, 3, 3, 10, 'fixture costs statement', 'none')$$,
  'an open successor cycle needs neither reason nor snapshot');
select is(
  (select carried_in_cents from public.fund_editions
    where id = 'f1600000-0000-0000-0000-0000000000ed'),
  0::bigint, 'carried_in_cents reads 0 by default — nothing carried is a readable amount');
reset role;

-- ── 'voided' in the status vocabulary, never on the ballot ──────────────────────────────
select lives_ok(
  $$insert into public.dream_candidacies
      (id, edition_id, profile_id, story, goal, impact, video_url, plan,
       budget_cents, min_viable_cents, status)
      values ('f1600000-0000-0000-0000-00000000c001', 'f1600000-0000-0000-0000-0000000000ed',
              'f1600000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p',
              800000, 500000, 'voided')$$,
  'voided is in the status vocabulary (D33/D34)');
select throws_ok(
  $$insert into public.dream_candidacies
      (edition_id, profile_id, story, goal, impact, video_url, plan,
       budget_cents, min_viable_cents, status, rejection_reasons)
      values ('f1600000-0000-0000-0000-0000000000ed', 'f1600000-0000-0000-0000-000000000001',
              's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'voided', array['plan_coherent'])$$,
  '23514', null, 'voided is not a rejection — it must not carry rejection_reasons');
select throws_ok(
  $$insert into public.dream_candidacies
      (edition_id, profile_id, story, goal, impact, video_url, plan,
       budget_cents, min_viable_cents, status)
      values ('f1600000-0000-0000-0000-0000000000ed', 'f1600000-0000-0000-0000-000000000001',
              's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'annulled')$$,
  '23514', null, 'the widened CHECK still refuses statuses outside the vocabulary');
select is(
  (select public.is_on_ballot(c) from public.dream_candidacies c
    where c.id = 'f1600000-0000-0000-0000-00000000c001'),
  false, 'voided is NEVER on the ballot — excluded by the is_on_ballot() allowlist');

-- ── fund_contributions.edition_id is immutable, even for the service role ───────────────
set local role service_role;
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values ('f1600000-0000-0000-0000-0000000000ed', 'f1600000-0000-0000-0000-000000000001',
          500, 'cs_0108', 'succeeded');

select throws_ok(
  $$update public.fund_contributions
       set edition_id = 'f1600000-0000-0000-0000-0000000000e2'
     where stripe_checkout_session_id = 'cs_0108'$$,
  'P0001', null, 're-pointing a contribution to another cycle is refused (rule 6)');
select lives_ok(
  $$update public.fund_contributions set status = 'refunded'
     where stripe_checkout_session_id = 'cs_0108'$$,
  'status stays writable — the freeze covers only edition_id');
select lives_ok(
  $$update public.fund_contributions set edition_id = edition_id
     where stripe_checkout_session_id = 'cs_0108'$$,
  'a same-value write-back is not a change (IS DISTINCT FROM)');
reset role;

select * from finish();
rollback;
