begin;
select plan(21);

-- #232 — declared per-cycle economics: mandatory at open, frozen after.
-- Rule-1 adjacent: these are the legal disclosures behind block ⑤ of the sixteen facts
-- (FUND-18); a cycle that can open without them, or quietly change them after, breaks
-- «stabiliti preventivamente» (doc §11, D15).

-- ── structure: NOT NULL, no default — same forcing function as the min_* trio ──────────
select col_not_null('public', 'fund_editions', 'split_pct', 'split_pct is not null');
select col_not_null('public', 'fund_editions', 'cost_fee_statement', 'cost_fee_statement is not null');
select col_not_null('public', 'fund_editions', 'equity_declared', 'equity_declared is not null');
select col_hasnt_default('public', 'fund_editions', 'split_pct', 'split_pct has no default');
select col_hasnt_default('public', 'fund_editions', 'cost_fee_statement', 'cost_fee_statement has no default');
select col_hasnt_default('public', 'fund_editions', 'equity_declared', 'equity_declared has no default');

-- ── the freeze mechanism exists ─────────────────────────────────────────────────────────
select has_function('public', 'fund_editions_declarations_frozen', 'freeze trigger function exists');
select has_trigger('public', 'fund_editions', 'fund_editions_freeze_declarations',
  'freeze trigger is attached to fund_editions');

-- ── a cycle opens only with its declarations chosen ────────────────────────────────────
set local role service_role;
select lives_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now() + interval '30 days', 5000000, 'candidacy', 100000, 5, 3,
              10, 'fixture costs statement', 'none')$$,
  'a cycle with all three declarations opens');

-- each missing declaration refuses the open (23502 not-null); phase 'closed' keeps the
-- one-active index out of the way, as in 0040
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 1, 1, 1, 'costs', 'none')$$,
  '23502', null, 'insert without split_pct is refused');
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, equity_declared)
      values (now(), 100, 'closed', 1, 1, 1, 10, 'none')$$,
  '23502', null, 'insert without cost_fee_statement is refused');
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement)
      values (now(), 100, 'closed', 1, 1, 1, 10, 'costs')$$,
  '23502', null, 'insert without equity_declared is refused');

-- a blank statement is not a statement (23514 check violation)
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 1, 1, 1, 10, '   ', 'none')$$,
  '23514', null, 'blank cost_fee_statement is refused');
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 1, 1, 1, 10, 'costs', '   ')$$,
  '23514', null, 'blank equity_declared is refused');
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies,
       split_pct, cost_fee_statement, equity_declared)
      values (now(), 100, 'closed', 1, 1, 1, 101, 'costs', 'none')$$,
  '23514', null, 'split_pct above 100 is refused');

-- ── frozen at open: even the service role cannot change a declaration ──────────────────
select throws_ok(
  $$update public.fund_editions set split_pct = 20 where phase <> 'closed'$$,
  'P0001', null, 'changing split_pct after open is refused');
select throws_ok(
  $$update public.fund_editions set cost_fee_statement = 'rewritten' where phase <> 'closed'$$,
  'P0001', null, 'changing cost_fee_statement after open is refused');
select throws_ok(
  $$update public.fund_editions set equity_declared = 'rewritten' where phase <> 'closed'$$,
  'P0001', null, 'changing equity_declared after open is refused');

-- writing the same value back is legal (IS DISTINCT FROM — idempotent service writes)…
select lives_ok(
  $$update public.fund_editions set split_pct = split_pct where phase <> 'closed'$$,
  'a same-value write-back is not a change');
-- …and everything else on the row stays writable
select lives_ok(
  $$update public.fund_editions set phase = 'screening' where phase = 'candidacy'$$,
  'phase transitions are untouched by the freeze');
reset role;

-- the declarations survived every attempt above
select is(
  (select split_pct::int from public.fund_editions where phase <> 'closed'),
  10, 'the declared percentage is intact');

select * from finish();
rollback;
