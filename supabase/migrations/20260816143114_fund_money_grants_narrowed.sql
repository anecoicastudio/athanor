-- Found while adding the fee coverage (#236): the fund money tables carry grants on the
-- hosted projects that no migration ever made, and BOTH staging (eralyiwkfrpqsawivegz) and
-- production (kwzeiqvrnnaagccyoose) were queried and carry them identically:
--
--   fund_contributions  authenticated → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   fund_editions       authenticated → SELECT, TRUNCATE, REFERENCES, TRIGGER
--   fund_aggregates     authenticated → SELECT, TRUNCATE, REFERENCES, TRIGGER
--
-- The residue of Supabase's schema-level default privileges: the hosted bootstrap grants
-- ALL on public tables to anon/authenticated, and the two creating migrations then revoked
-- only part of it. 20260617212319 revoked `insert, update, delete` from fund_editions and
-- fund_aggregates — naming three verbs left TRUNCATE, REFERENCES and TRIGGER standing.
-- 20260618153032 granted SELECT on fund_contributions without revoking anything first, so
-- that table kept the whole default set. A fresh CI stack does not reproduce this, which is
-- why the pgTAP suite has been green throughout: 0046's `client cannot update a
-- contribution` assertion is true in CI and was false on both hosted projects.
--
-- What was actually reachable: nothing, and that is the only reason this is a hardening
-- migration rather than an incident. PostgREST exposes no TRUNCATE, and RLS holds the rest —
-- fund_contributions has only a `select_own` policy, so a client INSERT raises 42501 and a
-- client UPDATE/DELETE matches zero rows. But TRUNCATE is NOT subject to row-level security,
-- so the grant was the entire protection on three money tables, and rule #2's deny-by-default
-- is a claim about the grant surface as much as about policies. A privilege nobody can
-- currently reach is still a privilege nobody audited.
--
-- This restates the grant surface the creating migrations intended, revoke-then-grant so the
-- verb list cannot be incomplete again. It is a no-op on any stack built from migrations
-- alone. Scope is deliberately the three fund money tables this work touched — the same
-- default-privilege residue very likely sits on other tables, and sweeping the schema is a
-- separate change with its own blast radius, not a rider on a payments PR.

-- ── fund_contributions — SELECT for the owner (RLS scopes it), nothing else ──────────────
revoke all on table public.fund_contributions from anon, authenticated;
grant select on table public.fund_contributions to authenticated;

-- ── fund_editions / fund_aggregates — public reads, no writes (20260617212319's intent) ──
revoke all on table public.fund_editions from anon, authenticated;
grant select on table public.fund_editions to anon, authenticated;

revoke all on table public.fund_aggregates from anon, authenticated;
grant select on table public.fund_aggregates to anon, authenticated;

-- service_role keeps `grant all` from the creating migrations — it is the sole writer of
-- every one of these tables (rule #6: money state is a cache the webhook writes).
