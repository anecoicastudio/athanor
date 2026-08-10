-- 0080_rls_catalog_sweep.test.sql
--
-- SPEC-FIRST catalog sweeps. Every other file in supabase/tests/ asserts one table's policies.
-- This one asserts the RULES themselves, mechanically, across ALL tables and ALL policies at
-- once -- so it fails on the NEXT bad policy, not just today's.
--
-- PRD.md:417 -- "RLS: pgTAP suite -- every table, every role, including 'client cannot write
-- score' assertion." A per-table file satisfies that for the tables that exist today; nothing
-- forced the next table to get the same treatment. These sweeps do.
--
-- Derived from CLAUDE.md rule 2 and .claude/rules/supabase.md L10-11:
--   * RLS on every table, deny-by-default
--   * policies use the wrapped form `(select auth.uid())`
--   * always `TO authenticated`/`TO anon` + ownership predicate -- never PUBLIC
--   * UPDATE policies need BOTH `USING` and `WITH CHECK`
--   * never `auth.role()`; never authorize from `user_metadata` -- use `app_metadata`
--   * `SECURITY DEFINER` => locked `search_path`, execute revoked from public/anon/authenticated
--
-- Every assertion is an is_empty() over a violations query, so a failure NAMES the offender.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Rule 2 -- RLS on every table, deny-by-default
-- ─────────────────────────────────────────────────────────────────────────────────────

-- Ordinary + partitioned tables in the two schemas we own. Extension-owned tables are
-- excluded (pgtap lives in `extensions`, but be explicit rather than lucky).
select is_empty(
  $$ select n.nspname || '.' || c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'athanor')
        and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_depend d
                         where d.objid = c.oid and d.deptype = 'e')
        and c.relrowsecurity = false $$,
  'rule 2: every table in public/athanor has row level security enabled'
);

-- PRD.md:417 tripwire. 48 tables are created across supabase/migrations/ and each one has a
-- dedicated file in supabase/tests/. When this count changes, the new table needs its own
-- pgTAP file before this number is bumped -- that is the whole point of the assertion.
-- 47 -> 48: athanor.waitlist_throttle (issue #23), covered by 0083_waitlist_rate_limit.
select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'athanor')
      and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')),
  48,
  'PRD.md:417 tripwire: 48 tables, each with its own pgTAP file (bump only WITH a new test)'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Rule 2 -- never PUBLIC; always TO authenticated / TO anon
-- ─────────────────────────────────────────────────────────────────────────────────────

-- A policy written without a TO clause targets PUBLIC, which includes every role the
-- platform ever adds. Rule 2 requires the role to be named.
select is_empty(
  $$ select schemaname || '.' || tablename || '.' || policyname || ' -> ' || roles::text
       from pg_policies
      where schemaname in ('public', 'athanor')
        and 'public' = any(roles) $$,
  'rule 2: no policy targets PUBLIC -- every policy names TO authenticated / TO anon'
);

select is_empty(
  $$ select schemaname || '.' || tablename || '.' || policyname || ' -> ' || roles::text
       from pg_policies
      where schemaname in ('public', 'athanor')
        and not (roles <@ '{authenticated,anon,service_role}'::name[]) $$,
  'rule 2: every policy targets only authenticated / anon / service_role'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Rule 2 -- the wrapped (select auth.uid()) form, never bare
-- ─────────────────────────────────────────────────────────────────────────────────────

-- Postgres renders the wrapped form as `( SELECT auth.uid() AS uid)`. Blank that out; any
-- surviving `auth.uid()` was written bare, which re-evaluates per row (initplan lost).
select is_empty(
  $$ select schemaname || '.' || tablename || '.' || policyname from pg_policies
      where schemaname in ('public', 'athanor')
        and replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                    '( SELECT auth.uid() AS uid)', 'WRAPPED') like '%auth.uid()%' $$,
  'rule 2: auth.uid() in a policy is always the wrapped (select auth.uid()) form'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- .claude/rules/supabase.md:10 -- never auth.role()
-- ─────────────────────────────────────────────────────────────────────────────────────

-- auth.role() is deprecated, and `auth.role() = 'authenticated'` passes for anonymous
-- sign-ins too -- the role clause is the correct control.
select is_empty(
  $$ select schemaname || '.' || tablename || '.' || policyname from pg_policies
      where schemaname in ('public', 'athanor')
        and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%auth.role()%' $$,
  'rules/supabase.md:10: no policy predicate calls auth.role()'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Rule 2 -- UPDATE needs BOTH using and with check
-- ─────────────────────────────────────────────────────────────────────────────────────

-- Without WITH CHECK a user passing USING can rewrite the row's owner column and hand it to
-- someone else.
select is_empty(
  $$ select schemaname || '.' || tablename || '.' || policyname from pg_policies
      where schemaname in ('public', 'athanor')
        and cmd in ('UPDATE', 'ALL')
        and (qual is null or with_check is null) $$,
  'rule 2: every UPDATE/ALL policy carries both USING and WITH CHECK'
);

-- And the converse shape check: a policy must actually constrain the command it targets.
select is_empty(
  $$ select schemaname || '.' || tablename || '.' || policyname || ' (' || cmd || ')'
       from pg_policies
      where schemaname in ('public', 'athanor')
        and ( (cmd in ('SELECT', 'DELETE') and qual is null)
           or (cmd = 'INSERT' and with_check is null) ) $$,
  'rule 2: SELECT/DELETE policies have a USING, INSERT policies have a WITH CHECK'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Rule 2 -- authorize from app_metadata, never user_metadata
-- ─────────────────────────────────────────────────────────────────────────────────────

-- raw_user_meta_data / user_metadata are writable by the user via the auth API. Reading them
-- in a policy lets a member grant themselves whatever the policy checks for.
select is_empty(
  $$ select schemaname || '.' || tablename || '.' || policyname from pg_policies
      where schemaname in ('public', 'athanor')
        and ( coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%user_metadata%'
           or coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%raw_user_meta_data%' ) $$,
  'rule 2: no policy authorizes from user_metadata (must be app_metadata)'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- .claude/rules/supabase.md:11 -- SECURITY DEFINER hygiene
-- ─────────────────────────────────────────────────────────────────────────────────────

-- A SECURITY DEFINER function with an inherited search_path can be hijacked by a caller who
-- creates a shadowing object in a schema earlier on the path. The locked form is
-- `set search_path = ''` with every reference schema-qualified.
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'athanor')
        and p.prosecdef
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                         where cfg like 'search_path=%') $$,
  'rules/supabase.md:11: every SECURITY DEFINER function pins its search_path'
);

select is_empty(
  $$ select n.nspname || '.' || p.proname || ' -> ' || array_to_string(p.proconfig, ',')
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'athanor')
        and p.prosecdef
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                     where cfg like 'search_path=%' and cfg like '%$user%') $$,
  'rules/supabase.md:11: no SECURITY DEFINER function keeps $user on its search_path'
);

-- Postgres grants EXECUTE to PUBLIC by default, so a SECURITY DEFINER function in `public` is
-- a public API endpoint until someone revokes it. anon inherits PUBLIC, so probing anon
-- catches both a forgotten revoke and an explicit grant.
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'athanor')
        and p.prosecdef
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'rules/supabase.md:11: no SECURITY DEFINER function is executable by anon (or PUBLIC)'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Rule 1 -- Aura is never client-writable (PRD.md:417 "client cannot write score")
-- ─────────────────────────────────────────────────────────────────────────────────────

-- 0035 / 0036 prove the behaviour for today's policy set. This proves the SHAPE: no write
-- policy may ever exist on a score table, so adding one is a test failure rather than a
-- silent capability. `stars` is included -- badges are engine-awarded on the same principle.
select is_empty(
  $$ select tablename || '.' || policyname || ' (' || cmd || ' to ' || roles::text || ')'
       from pg_policies
      where schemaname = 'public'
        and tablename in ('aura_events', 'aura_scores', 'stars')
        and cmd <> 'SELECT' $$,
  'rule 1: no non-SELECT policy exists on aura_events / aura_scores / stars'
);

-- Grants are the other half: a policy is irrelevant if the privilege was never granted, and
-- a privilege is dangerous the moment someone adds a matching policy. Deny both.
select is_empty(
  $$ select t.tbl || ' / ' || r.role || ' / ' || pv.priv
       from (values ('public.aura_events'), ('public.aura_scores'), ('public.stars')) as t(tbl)
       cross join (values ('anon'), ('authenticated')) as r(role)
       cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as pv(priv)
      where has_table_privilege(r.role::name, t.tbl::text, pv.priv::text) $$,
  'rule 1: anon/authenticated hold no INSERT/UPDATE/DELETE/TRUNCATE on the score tables'
);

select * from finish();
rollback;
