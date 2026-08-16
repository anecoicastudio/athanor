-- fund-settle-sweep (#248): the daily pg_cron caller for release-fund-payout's sweep
-- mode. The wrapper carries no eligibility logic (the executor's refusal ladder decides
-- whether money moves); what this file asserts is the cron half of rule 8 — definer with
-- a locked search_path, no client EXECUTE, key resolved through athanor.runtime_setting
-- at call time, and — the branch that matters most — a quiet no-op when the Vault pair
-- is absent, which is every fresh CI stack and production until the operator creates it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ── the wrapper ──────────────────────────────────────────────────────────────
select has_function('public', 'invoke_fund_settle_sweep', array[]::text[],
  'invoke_fund_settle_sweep exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_fund_settle_sweep'),
  true, 'invoke_fund_settle_sweep is security definer');
select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_fund_settle_sweep'),
  array['search_path=""'], 'invoke_fund_settle_sweep locks search_path to empty');
select ok(not has_function_privilege('anon', 'public.invoke_fund_settle_sweep()', 'execute'),
  'anon cannot invoke the sweep');
select ok(not has_function_privilege('authenticated', 'public.invoke_fund_settle_sweep()', 'execute'),
  'authenticated cannot invoke the sweep');
select ok(not has_function_privilege('public', 'public.invoke_fund_settle_sweep()', 'execute'),
  'public cannot invoke the sweep');

-- reads config through the resolver, so a Vault rotation is picked up (rule 8) …
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_fund_settle_sweep') like '%runtime_setting%',
  'the sweep resolves url/key through athanor.runtime_setting');
-- … and presents it on the apikey header, never a hand-built Authorization bearer.
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_fund_settle_sweep') like '%edge_auth_headers%',
  'the sweep builds headers through athanor.edge_auth_headers');

-- ── the absent-secret branch, explicitly ─────────────────────────────────────
-- No GUC, no Vault row on this stack: runtime_setting returns NULL and the guard must
-- TAKE the no-op branch, not skip it — `if v_url is null or …` tests NULL explicitly,
-- where a bare `if v_url != ''` would be NULL → false → fall through to http_post.
select lives_ok(
  $$ select public.invoke_fund_settle_sweep() $$,
  'both settings absent → quiet no-op, the daily job never error-loops pre-deploy'
);
-- Half-configured is still unconfigured: url present, key absent → same quiet no-op.
select set_config('app.settings.release_fund_payout_url', 'http://localhost:1/x', true);
select lives_ok(
  $$ select public.invoke_fund_settle_sweep() $$,
  'url set but key absent → still a no-op, never an unauthenticated post'
);

-- ── the schedule ─────────────────────────────────────────────────────────────
select is(
  (select schedule from cron.job where jobname = 'fund-settle-sweep'),
  '41 4 * * *',
  'the sweep runs daily — settlement moves in days (SEPA), so an hourly pass buys nothing'
);
select ok(
  (select command from cron.job where jobname = 'fund-settle-sweep')
    like '%invoke_fund_settle_sweep%',
  'cron calls the wrapper — never a literal key in cron.job.command'
);

select * from finish();
rollback;
