-- The grant surface of the fund money tables (found while adding #236's fee coverage).
--
-- Rule #2's deny-by-default is a claim about GRANTS as much as about policies, and the two
-- are not interchangeable: RLS does not apply to TRUNCATE, so on a table where the only
-- protection is «there is no policy», a TRUNCATE privilege is the whole story. Both hosted
-- projects carried TRUNCATE (and, on fund_contributions, the full DML set) for
-- `authenticated` — Supabase's schema default privileges, which the creating migrations
-- revoked only partly. A fresh CI stack does not reproduce that, which is exactly why this
-- file asserts the surface directly instead of trusting an insert to fail.
--
-- Privilege assertions, not behaviour assertions, on purpose: a behaviour test passes for
-- the wrong reason the moment RLS happens to swallow the statement.
begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- ── fund_contributions: the owner reads their own rows, and that is all a client may do ──
select ok(has_table_privilege('authenticated', 'public.fund_contributions', 'SELECT'),
  'authenticated may SELECT contributions (RLS scopes it to their own)');
select ok(not has_table_privilege('authenticated', 'public.fund_contributions', 'INSERT'),
  'authenticated may not INSERT a contribution — money rows are the webhook''s (rule #6)');
select ok(not has_table_privilege('authenticated', 'public.fund_contributions', 'UPDATE'),
  'authenticated may not UPDATE a contribution');
select ok(not has_table_privilege('authenticated', 'public.fund_contributions', 'DELETE'),
  'authenticated may not DELETE a contribution');
select ok(not has_table_privilege('authenticated', 'public.fund_contributions', 'TRUNCATE'),
  'authenticated may not TRUNCATE contributions — RLS would not have stopped it');
select ok(not has_table_privilege('authenticated', 'public.fund_contributions', 'TRIGGER'),
  'authenticated may not attach a TRIGGER to contributions — it would fire on webhook writes');
select ok(not has_table_privilege('anon', 'public.fund_contributions', 'SELECT'),
  'anon cannot see contributions at all');

-- ── fund_editions: a public read (the cycle is published), never a write ─────────────────
select ok(has_table_privilege('authenticated', 'public.fund_editions', 'SELECT'),
  'authenticated reads the cycle');
select ok(has_table_privilege('anon', 'public.fund_editions', 'SELECT'),
  'anon reads the cycle — the fund is public before sign-up');
select ok(not has_table_privilege('authenticated', 'public.fund_editions', 'TRUNCATE'),
  'authenticated may not TRUNCATE the cycle table');
select ok(not has_table_privilege('authenticated', 'public.fund_editions', 'TRIGGER'),
  'authenticated may not attach a TRIGGER to the cycle table');
select ok(not has_table_privilege('anon', 'public.fund_editions', 'TRUNCATE'),
  'anon may not TRUNCATE the cycle table');

-- ── fund_aggregates: the public ticker, derived and read-only to every client ────────────
select ok(has_table_privilege('authenticated', 'public.fund_aggregates', 'SELECT'),
  'authenticated reads the ticker');
select ok(has_table_privilege('anon', 'public.fund_aggregates', 'SELECT'),
  'anon reads the ticker');
select ok(not has_table_privilege('authenticated', 'public.fund_aggregates', 'TRUNCATE'),
  'authenticated may not TRUNCATE the ticker');
select ok(not has_table_privilege('authenticated', 'public.fund_aggregates', 'TRIGGER'),
  'authenticated may not attach a TRIGGER to the ticker');
select ok(not has_table_privilege('anon', 'public.fund_aggregates', 'TRUNCATE'),
  'anon may not TRUNCATE the ticker');

-- ── the sole writer keeps writing ───────────────────────────────────────────────────────
-- The revoke above names anon and authenticated only; a copy-paste that widened it to
-- service_role would silently break every webhook write, so assert the other half too.
select ok(has_table_privilege('service_role', 'public.fund_contributions', 'INSERT'),
  'service_role still inserts contributions (the webhook)');
select ok(has_table_privilege('service_role', 'public.fund_contributions', 'UPDATE'),
  'service_role still updates contributions (the refund/dispute reversal)');
select ok(has_table_privilege('service_role', 'public.fund_aggregates', 'INSERT'),
  'service_role still writes the ticker (recompute_fund_aggregate)');

select * from finish();
rollback;
