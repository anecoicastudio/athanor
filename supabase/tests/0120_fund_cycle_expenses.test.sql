-- #234 / FUND-29 — the per-cycle cost record.
-- doc §20 «principali categorie di spesa; eventuali compensi o costi di gestione previsti» ·
-- PRD.md:256 · docs/FUND-SPEC.md §"Platform economics" · divergence D-16.
--
-- Asserts: the world reads the cost record — signed out included, because FUND-38 publishes
-- it to a page an unregistered visitor sees; no client writes it, in either the policy sense
-- or the grant sense; the category vocabulary is closed, and refuses a value the public page
-- would not know how to render; a cost carries an account of itself; amounts sum per CYCLE
-- and per CATEGORY, with a credit netting against the cost it corrects; and a cycle carrying
-- a cost record cannot be deleted out from under it.
--
-- THE GRANT ASSERTIONS ARE DIRECT, NOT BEHAVIOURAL — the 0119 pattern, and this file is the
-- third table to need it. `has_table_privilege` is asked about every verb rather than
-- proving a client INSERT fails, because an INSERT can fail for the wrong reason: RLS
-- swallowing the statement looks identical to the privilege being absent, and TRUNCATE is
-- not subject to RLS at all, so on a table whose only write protection is «there is no
-- policy» the grant surface IS the protection. Both halves are asserted — the client's
-- privileges are absent AND service_role's are present, because a copy-pasted `revoke all`
-- that widened to service_role would silently break the only writer there is.
--
-- WHAT IS DELIBERATELY NOT ASSERTED: any relationship to fund_contributions.coverage_cents.
-- The coverage members chose to add is not recorded here and must not be — this table is
-- Athanor's gross spending, the coverage is members' money, and the offset is a report-time
-- computation (#237/#238). A test that reconciled the two here would be asserting a ledger
-- linkage the migration deliberately does not have.
begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

-- fixture: park any live cycle (staging smoke; no-op in CI) — the 0108/0110/0114/0116 pattern.
-- A phase move, never a declaration move: the #232 freeze trigger fires on split_pct /
-- cost_fee_statement / equity_declared only, and this touches none of them.
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

-- ── structure ───────────────────────────────────────────────────────────────────────────
select has_table('public', 'fund_cycle_expenses', 'fund_cycle_expenses exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fund_cycle_expenses'::regclass),
  'RLS enabled on fund_cycle_expenses');
-- The shape, pinned. No profile_id and no member-identifying column of any kind: this is
-- Athanor's own bookkeeping, which is why it sits outside 0096's GDPR export sweep (that
-- sweep covers tables with an FK into profiles/auth.users, and adding this one to
-- gdpr_excluded would misfile it as personal data the export chose to omit).
select columns_are('public', 'fund_cycle_expenses',
  array['id', 'edition_id', 'category', 'amount_cents', 'description',
        'incurred_on', 'created_at', 'updated_at'],
  'the cost record names no member — no profile_id, and no column that could become one');
select policies_are('public', 'fund_cycle_expenses',
  array['fund_cycle_expenses_select_public'],
  'one policy, and it is a read — no client write policy, and no #106 net (no member writes here)');
select has_trigger('public', 'fund_cycle_expenses', 'fund_cycle_expenses_touch_updated_at',
  'fund_cycle_expenses carries the touch_updated_at trigger');
select has_index('public', 'fund_cycle_expenses', 'fund_cycle_expenses_edition_category',
  'the grouping index exists — (edition_id, category) include (amount_cents)');
select has_view('public', 'fund_edition_expense_totals',
  'the published per-cycle per-category shape exists (PostgREST exposes no sum())');

-- ── grants: the client half is absent ───────────────────────────────────────────────────
select ok(has_table_privilege('anon', 'public.fund_cycle_expenses', 'SELECT'),
  'anon reads the cost record — FUND-38 publishes it before sign-up');
select ok(has_table_privilege('authenticated', 'public.fund_cycle_expenses', 'SELECT'),
  'authenticated reads the cost record');
select ok(not has_table_privilege('authenticated', 'public.fund_cycle_expenses', 'INSERT'),
  'authenticated may not INSERT a cost — the record is the operator''s (service_role)');
select ok(not has_table_privilege('authenticated', 'public.fund_cycle_expenses', 'UPDATE'),
  'authenticated may not UPDATE a cost');
select ok(not has_table_privilege('authenticated', 'public.fund_cycle_expenses', 'DELETE'),
  'authenticated may not DELETE a cost');
select ok(not has_table_privilege('authenticated', 'public.fund_cycle_expenses', 'TRUNCATE'),
  'authenticated may not TRUNCATE the cost record — RLS would not have stopped it');
select ok(not has_table_privilege('authenticated', 'public.fund_cycle_expenses', 'TRIGGER'),
  'authenticated may not attach a TRIGGER to the cost record');
select ok(not has_table_privilege('authenticated', 'public.fund_cycle_expenses', 'REFERENCES'),
  'authenticated may not REFERENCE the cost record');
select ok(not has_table_privilege('anon', 'public.fund_cycle_expenses', 'INSERT'),
  'anon may not INSERT a cost');
select ok(not has_table_privilege('anon', 'public.fund_cycle_expenses', 'TRUNCATE'),
  'anon may not TRUNCATE the cost record');
select ok(not has_table_privilege('anon', 'public.fund_cycle_expenses', 'TRIGGER'),
  'anon may not attach a TRIGGER to the cost record');

-- ── grants: the writer half is present ──────────────────────────────────────────────────
-- `revoke all` names anon and authenticated; a copy-paste that included service_role would
-- leave the table unwritable by the only thing that writes it, and every assertion above
-- would still pass.
select ok(has_table_privilege('service_role', 'public.fund_cycle_expenses', 'INSERT'),
  'service_role still records a cost');
select ok(has_table_privilege('service_role', 'public.fund_cycle_expenses', 'UPDATE'),
  'service_role still corrects a typo in a cost');
select ok(has_table_privilege('service_role', 'public.fund_cycle_expenses', 'DELETE'),
  'service_role still deletes a cost recorded in error');

-- ── grants: the published view ──────────────────────────────────────────────────────────
select ok(has_table_privilege('anon', 'public.fund_edition_expense_totals', 'SELECT'),
  'anon reads the per-category totals — this is the published figure');
select ok(has_table_privilege('authenticated', 'public.fund_edition_expense_totals', 'SELECT'),
  'authenticated reads the per-category totals');
select ok(not has_table_privilege('anon', 'public.fund_edition_expense_totals', 'INSERT'),
  'the totals view is not writable — a published total is derived, never asserted');

-- ── fixture: three cycles ───────────────────────────────────────────────────────────────
--   e1 — the sum fixture: two payment_processing rows (a cost and its credit), plus two more
--        categories, so «per cycle, per category» has something to be wrong about
--   e2 — one management_fee row, to prove the grouping does not leak across cycles
--   e3 — one row of every category in the vocabulary
-- All three closed, which is both what `fund_editions_one_active` allows (one non-closed
-- cycle exists at a time) and the state a cost record is read in: the §20 report reconciles
-- what a cycle declared against what it spent once the cycle is over.
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason,
                                  candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
values
  ('01200000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'closed',
   'realized', false, false, 100000, 1, 1, 10, 'fixture costs statement', 'none'),
  ('01200000-0000-0000-0000-0000000000e2', now() + interval '30 days', 5000000, 'closed',
   'realized', false, false, 100000, 1, 1, 10, 'fixture costs statement', 'none'),
  ('01200000-0000-0000-0000-0000000000e3', now() + interval '30 days', 5000000, 'closed',
   'realized', false, false, 100000, 1, 1, 10, 'fixture costs statement', 'none');

insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
values
  ('01200000-0000-0000-0000-0000000000e1', 'payment_processing', 12000,
   'Commissioni Stripe sui contributi del ciclo.'),
  ('01200000-0000-0000-0000-0000000000e1', 'platform_operations', 4500,
   'Infrastruttura attribuita al ciclo.'),
  ('01200000-0000-0000-0000-0000000000e1', 'legal_compliance', 90000,
   'Parere legale sulla raccolta pubblica.'),
  ('01200000-0000-0000-0000-0000000000e2', 'management_fee', 5000,
   'Compenso di gestione del ciclo.');

-- The correction, recorded as a row rather than as an edit of the row above.
select lives_ok(
  $$ insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
     values ('01200000-0000-0000-0000-0000000000e1', 'payment_processing', -2000,
             'Storno: commissioni riaccreditate su una sessione duplicata.') $$,
  'a credit is a negative row — a published cost is corrected by recording, never by editing');

insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
select '01200000-0000-0000-0000-0000000000e3', c, 100, 'una riga per categoria'
  from unnest(array['payment_processing', 'payout_transfer', 'platform_operations',
                    'legal_compliance', 'management_fee', 'other']) as c;

-- ── the vocabulary is closed ────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.fund_edition_expense_totals
    where edition_id = '01200000-0000-0000-0000-0000000000e3'),
  6, 'every category the CHECK names is insertable — the vocabulary and the constraint agree');
select throws_ok(
  $$ insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
     values ('01200000-0000-0000-0000-0000000000e1', 'marketing', 100, 'campagna') $$,
  '23514', null,
  'a category outside the vocabulary is refused — the public page renders these, so free text would be unrenderable');

-- ── a cost accounts for itself, and moves a total ───────────────────────────────────────
select throws_ok(
  $$ insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
     values ('01200000-0000-0000-0000-0000000000e1', 'other', 100, '   ') $$,
  '23514', null,
  'a blank description is refused — under ''other'' it is the only account of the money there is');
select throws_ok(
  format($$ insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
            values ('01200000-0000-0000-0000-0000000000e1', 'other', 100, %L) $$, repeat('x', 501)),
  '23514', null,
  'a description over 500 chars is refused — the bound mirrors packages/schemas exactly');
select throws_ok(
  $$ insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
     values ('01200000-0000-0000-0000-0000000000e1', 'other', 0, 'niente') $$,
  '23514', null,
  'a zero amount is refused — a row that moves no total is noise in a transparency record');

-- ── the cycle a cost belongs to cannot be deleted out from under it ─────────────────────
select throws_ok(
  $$ delete from public.fund_editions where id = '01200000-0000-0000-0000-0000000000e1' $$,
  '23503', null,
  'ON DELETE RESTRICT: a cycle carrying a cost record is not deletable — the record is the §20 report''s evidence');
reset role;

-- ── the world reads it ──────────────────────────────────────────────────────────────────
set local role anon;
select is(
  (select count(*)::int from public.fund_cycle_expenses
    where edition_id = '01200000-0000-0000-0000-0000000000e1'),
  4, 'a signed-out visitor reads the cost record — FUND-38 publishes it, so RLS must not gate it');
select throws_ok(
  $$ insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
     values ('01200000-0000-0000-0000-0000000000e1', 'other', 100, 'mio') $$,
  '42501', null, 'anon cannot record a cost against the fund');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01200000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.fund_cycle_expenses
    where edition_id = '01200000-0000-0000-0000-0000000000e1'),
  4, 'a member reads the cost record');
select throws_ok(
  $$ insert into public.fund_cycle_expenses (edition_id, category, amount_cents, description)
     values ('01200000-0000-0000-0000-0000000000e1', 'other', 100, 'mio') $$,
  '42501', null, 'a member cannot record a cost against the fund');
select throws_ok(
  $$ update public.fund_cycle_expenses set amount_cents = 1
      where edition_id = '01200000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'a member cannot rewrite what the cycle cost');
select throws_ok(
  $$ delete from public.fund_cycle_expenses
      where edition_id = '01200000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'a member cannot erase what the cycle cost');
reset role;

-- ── the published figure: per cycle, per category, signed ───────────────────────────────
set local role anon;
select is(
  (select total_cents from public.fund_edition_expense_totals
    where edition_id = '01200000-0000-0000-0000-0000000000e1' and category = 'payment_processing'),
  10000::bigint,
  'the credit nets against the cost it corrects: 12000 - 2000, and both rows remain visible');
select is(
  (select entry_count from public.fund_edition_expense_totals
    where edition_id = '01200000-0000-0000-0000-0000000000e1' and category = 'payment_processing'),
  2, 'the correction did not replace the cost — two rows stand behind the one published number');
select is(
  (select count(*)::int from public.fund_edition_expense_totals
    where edition_id = '01200000-0000-0000-0000-0000000000e1'),
  3, 'a category with no rows is absent, not zero — the report renders what was spent');
select is(
  (select sum(total_cents)::bigint from public.fund_edition_expense_totals
    where edition_id = '01200000-0000-0000-0000-0000000000e1'),
  104500::bigint, 'the cycle total is the sum of its published categories');
select is(
  (select total_cents from public.fund_edition_expense_totals
    where edition_id = '01200000-0000-0000-0000-0000000000e2' and category = 'management_fee'),
  5000::bigint, 'e2 sums independently — the grouping is per cycle, and e1''s costs stay e1''s');
reset role;

select * from finish();
rollback;
