begin;
select plan(23);

-- structure
select has_table('public', 'fund_editions', 'fund_editions exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fund_editions'::regclass),
  'RLS enabled on fund_editions'
);
select policies_are('public', 'fund_editions', array['fund_editions_select_public'],
  'exactly the public-select policy');

-- #215 cycle shape: the annual column is gone…
select hasnt_column('public', 'fund_editions', 'year', 'year is gone (cycles are event-driven)');

-- …and the three deferred minimums are NOT NULL with NO DEFAULT (FUND-SPEC §5 forcing
-- function — a default here would let a cycle open without anyone choosing its numbers).
select col_not_null('public', 'fund_editions', 'min_funding_cents', 'min_funding_cents is not null');
select col_not_null('public', 'fund_editions', 'min_voters', 'min_voters is not null');
select col_not_null('public', 'fund_editions', 'min_candidacies', 'min_candidacies is not null');
select col_hasnt_default('public', 'fund_editions', 'min_funding_cents', 'min_funding_cents has no default');
select col_hasnt_default('public', 'fund_editions', 'min_voters', 'min_voters has no default');
select col_hasnt_default('public', 'fund_editions', 'min_candidacies', 'min_candidacies has no default');

-- seed one cycle as service_role
set local role service_role;
insert into public.fund_editions
  (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies)
  values (now() + interval '30 days', 5000000, 'candidacy', 100000, 5, 3);
reset role;

-- anon CAN read the heartbeat (contrast every other table)
set local role anon;
select is((select count(*)::int from public.fund_editions), 1, 'anon can read the cycle (heartbeat)');
select throws_ok(
  $$insert into public.fund_editions (target_at, goal_cents, min_funding_cents, min_voters, min_candidacies)
    values (now(), 100, 1, 1, 1)$$,
  '42501', null, 'anon cannot insert a cycle');
select throws_ok(
  $$delete from public.fund_editions$$,
  '42501', null, 'anon cannot delete a cycle');
reset role;

-- authenticated cannot write
set local role authenticated;
select throws_ok(
  $$insert into public.fund_editions (target_at, goal_cents, min_funding_cents, min_voters, min_candidacies)
    values (now(), 100, 1, 1, 1)$$,
  '42501', null, 'authenticated cannot insert a cycle');
select throws_ok(
  $$update public.fund_editions set phase = 'closed'$$,
  '42501', null, 'authenticated cannot update a cycle');
select throws_ok(
  $$delete from public.fund_editions$$,
  '42501', null, 'authenticated cannot delete a cycle');
reset role;

-- service_role can write
set local role service_role;
select lives_ok(
  $$update public.fund_editions set phase = 'screening' where phase = 'candidacy'$$,
  'service_role can update the cycle');
reset role;

select is(
  (select count(*)::int from public.fund_editions where phase = 'screening'),
  1, 'service_role update landed');

-- ── #215: one active cycle GLOBALLY (fund_editions_one_active) ──────────────────────────
-- A second non-closed cycle collides even as service_role — the invariant is the index,
-- not a policy.
set local role service_role;
select throws_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies)
      values (now() + interval '60 days', 1000000, 'candidacy', 1, 1, 1)$$,
  '23505', null, 'a second non-closed cycle is a unique violation');
-- a CLOSED second cycle is fine — the index is partial on phase <> 'closed'
select lives_ok(
  $$insert into public.fund_editions
      (target_at, goal_cents, phase, min_funding_cents, min_voters, min_candidacies)
      values (now() - interval '400 days', 1000000, 'closed', 1, 1, 1)$$,
  'a closed cycle coexists with the active one');

-- ── #215: a cycle cannot open without its declared minimums (23502 not-null) ────────────
select throws_ok(
  $$insert into public.fund_editions (target_at, goal_cents, phase, min_voters, min_candidacies)
    values (now(), 100, 'closed', 1, 1)$$,
  '23502', null, 'insert without min_funding_cents is refused');
select throws_ok(
  $$insert into public.fund_editions (target_at, goal_cents, phase, min_funding_cents, min_candidacies)
    values (now(), 100, 'closed', 1, 1)$$,
  '23502', null, 'insert without min_voters is refused');
select throws_ok(
  $$insert into public.fund_editions (target_at, goal_cents, phase, min_funding_cents, min_voters)
    values (now(), 100, 'closed', 1, 1)$$,
  '23502', null, 'insert without min_candidacies is refused');
reset role;

select * from finish();
rollback;
