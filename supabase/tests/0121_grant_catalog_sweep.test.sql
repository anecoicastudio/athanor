-- 0121_grant_catalog_sweep.test.sql
--
-- The grant surface of EVERY table and view in `public`, declared explicitly (issue #405).
--
-- 0080 is the catalog sweep for POLICIES; this is the catalog sweep for GRANTS. The two are not
-- interchangeable and #404 is the proof: a "client cannot update X" behaviour assertion was true
-- in CI and false on both hosted projects, because RLS happened to swallow the statement while
-- the privilege sat there unaudited. RLS does not apply to TRUNCATE or MAINTAIN at all.
--
-- Why aclexplode(relacl) and not information_schema.role_table_grants:
-- information_schema enumerates only the seven SQL-standard privileges, so it CANNOT SEE
-- MAINTAIN — which PG17's default privileges were handing to `authenticated` on 30 objects here.
-- The audit snapshot this work started from was built from information_schema and undercounted
-- for exactly that reason. A test with the same blind spot would have re-certified the bug.
--
-- Why an explicit expected list rather than a derived one: a rule derived from pg_policies would
-- be self-fulfilling — it would ratify whatever the schema happens to do. The list below is the
-- INTENT, written down, and any divergence in either direction is a failure:
--   * a privilege present but not declared  -> something widened (the #405 class)
--   * a privilege declared but not present  -> something narrowed (the #406 class — a rebuilt
--     view losing its grants is the exact trap CI already caught once)
--
-- Adding a table or view means adding its row HERE, in the same change. That is the 0080
-- tripwire discipline, applied to grants.
--
-- Scope: table-level privileges for `anon` and `authenticated`. Column-level ACLs are asserted
-- separately (seven tables carry them deliberately, and `revoke all on table` would silently
-- drop them). service_role is asserted where it is the sole writer. Since #409 the file also
-- covers FUNCTION EXECUTE — the axis #408 left out — and the policy→grant direction.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- The declared surface
-- ─────────────────────────────────────────────────────────────────────────────────────
-- One row per object. '' means "this role holds nothing at table level" — for profiles,
-- momento_proposals and events/anon that is correct precisely BECAUSE their access is
-- column-scoped; see the column-ACL section at the end.

create temporary table expected_grants (
  obj         text primary key,
  anon_privs  text not null,
  auth_privs  text not null
);

insert into expected_grants (obj, anon_privs, auth_privs) values
  -- ── identity ────────────────────────────────────────────────────────────────────────
  ('profiles',                    '',       ''),                            -- column-scoped
  ('verifications',               '',       'SELECT'),
  ('consent',                     '',       'SELECT,INSERT,UPDATE'),        -- no DELETE: withdrawal is a new row
  ('invites',                     '',       'SELECT'),
  ('blocks',                      '',       'SELECT,INSERT,DELETE'),
  ('connections',                 '',       'SELECT'),                      -- written by respond_to_connection
  ('connection_requests',         '',       'SELECT,INSERT,DELETE'),
  ('circle_memberships',          '',       'SELECT'),                      -- every write is Stripe's
  ('entitlements',                '',       'SELECT'),                      -- view; anon removed by #405
  -- ── reputation: rule 1, engine-written, never client-writable ───────────────────────
  ('aura_events',                 '',       'SELECT'),
  ('aura_scores',                 'SELECT', 'SELECT'),
  ('stars',                       'SELECT', 'SELECT'),
  -- ── momenti ─────────────────────────────────────────────────────────────────────────
  ('moments',                     '',       'SELECT,INSERT,UPDATE'),
  ('momento_proposals',           '',       ''),                            -- column-scoped
  ('conversations',               '',       'SELECT'),                      -- created by get_or_create_conversation
  ('messages',                    '',       'SELECT,INSERT'),
  ('notifications',               '',       'SELECT'),                      -- + column UPDATE(read_at)
  ('notification_preferences',    '',       'SELECT,INSERT,UPDATE'),
  ('push_tokens',                 '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('push_receipts',               '',       ''),                            -- service-role only
  -- ── posts and stories ───────────────────────────────────────────────────────────────
  ('posts',                       '',       'SELECT,INSERT,UPDATE'),
  ('post_comments',               '',       'SELECT,INSERT,UPDATE'),
  ('post_media',                  '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('post_reactions',              '',       'SELECT,INSERT,DELETE'),
  ('story_segments',              '',       'SELECT,INSERT,UPDATE'),
  ('story_reactions',             '',       'SELECT,INSERT,DELETE'),
  -- ── dreams, projects, favours ───────────────────────────────────────────────────────
  ('dreams',                      'SELECT', 'SELECT,INSERT,UPDATE'),
  ('dream_milestones',            'SELECT', 'SELECT,INSERT,UPDATE'),
  ('dream_candidacies',           '',       'SELECT,INSERT,UPDATE'),
  ('milestone_helps',             '',       'SELECT,INSERT,UPDATE'),
  ('projects',                    '',       'SELECT,INSERT,UPDATE'),
  ('favor_offers',                '',       'SELECT,INSERT,UPDATE'),
  ('favor_needs',                 '',       'SELECT'),                      -- view
  -- ── events ──────────────────────────────────────────────────────────────────────────
  ('events',                      '',       'SELECT'),               -- anon SELECT + auth INSERT column-scoped
  ('event_attendance',            '',       'SELECT,INSERT'),
  ('event_live_stats',            'SELECT', 'SELECT'),
  ('event_tickets',               '',       'SELECT'),                      -- Stripe writes it
  ('rsvps',                       '',       'SELECT,INSERT,UPDATE'),
  ('athanor_days_interest',       '',       'SELECT,INSERT'),
  -- ── the fund: money is a cache of Stripe (rule 6), so clients read and never write ──
  ('fund_editions',               'SELECT', 'SELECT'),
  ('fund_aggregates',             'SELECT', 'SELECT'),
  ('fund_contributions',          '',       'SELECT'),
  ('fund_cycle_expenses',         'SELECT', 'SELECT'),
  ('fund_edition_expense_totals', 'SELECT', 'SELECT'),                      -- view
  ('fund_payout_ledger',          '',       'SELECT'),
  ('fund_candidate_cards',        '',       'SELECT'),                      -- view
  ('payout_accounts',             '',       'SELECT'),                      -- Stripe Connect writes it
  ('candidacy_votes',             '',       'SELECT,INSERT,DELETE'),
  ('screening_criteria',          'SELECT', 'SELECT'),
  ('realization_plans',           'SELECT', 'SELECT'),                      -- + column INSERT/UPDATE
  ('realization_plan_phases',     'SELECT', 'SELECT,DELETE'),               -- + column INSERT/UPDATE
  ('realization_updates',         'SELECT', 'SELECT'),                      -- + column INSERT/UPDATE
  -- ── platform ────────────────────────────────────────────────────────────────────────
  ('remote_config',               'SELECT', 'SELECT'),                      -- the kill switch: read only
  ('email_waitlist',              'INSERT', 'INSERT'),                      -- write-only, no select policy
  ('audit_log',                   '',       'SELECT'),
  ('reports',                     '',       'SELECT,INSERT'),
  ('gdpr_export_jobs',            '',       'SELECT,INSERT'),
  ('gdpr_erasure_requests',       '',       'SELECT,INSERT'),
  ('stripe_webhook_events',       '',       '');                            -- webhook dedupe, service-role only

-- The declared list, exploded to one row per (object, role, privilege).
create temporary view expected_acl as
  select obj, 'anon'::name as role, unnest(string_to_array(anon_privs, ',')) as priv
    from expected_grants where anon_privs <> ''
  union all
  select obj, 'authenticated'::name, unnest(string_to_array(auth_privs, ','))
    from expected_grants where auth_privs <> '';

-- What the catalog actually holds. aclexplode, so MAINTAIN is visible.
create temporary view actual_acl as
  select c.relname::text as obj,
         pg_get_userbyid(ax.grantee)::name as role,
         ax.privilege_type::text as priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) ax
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and pg_get_userbyid(ax.grantee) in ('anon', 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- The tripwire: every object in the schema is declared above
-- ─────────────────────────────────────────────────────────────────────────────────────

select is_empty(
  $$ select c.relname || ' (' || c.relkind::text || ')' from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d
                         where d.objid = c.oid and d.deptype = 'e')
        and c.relname not in (select obj from expected_grants) $$,
  '#405: every table and view in public declares its client grants in this file'
);

-- The converse: a declared object that no longer exists is a stale row to delete, not a
-- silently-passing assertion.
select is_empty(
  $$ select obj from expected_grants e
      where not exists (select 1 from pg_class c
                          join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relname = e.obj
                           and c.relkind in ('r', 'p', 'v', 'm', 'f')) $$,
  '#405: every object declared in this file still exists (no stale rows)'
);

-- Views are half the point — #405 said "every table" and its evidence showed the residue on
-- views. Pin the count so a new view cannot slip past the reader of this file.
select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')),
  4,
  '#405: 4 views in public (entitlements, favor_needs, fund_candidate_cards, fund_edition_expense_totals)'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Nothing wider than declared (the #405 class)
-- ─────────────────────────────────────────────────────────────────────────────────────

select is_empty(
  $$ select a.obj || ' / ' || a.role || ' / ' || a.priv from actual_acl a
      where not exists (select 1 from expected_acl e
                         where e.obj = a.obj and e.role = a.role and e.priv = a.priv) $$,
  '#405: no client role holds a table privilege this file does not declare'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Nothing narrower than declared (the #406 class — a rebuilt view loses its grants)
-- ─────────────────────────────────────────────────────────────────────────────────────

select is_empty(
  $$ select e.obj || ' / ' || e.role || ' / ' || e.priv from expected_acl e
      where not exists (select 1 from actual_acl a
                         where a.obj = e.obj and a.role = e.role and a.priv = e.priv) $$,
  '#405: every declared privilege is actually granted (a rebuilt view keeps its grants)'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- The rule itself, stated once, independent of the list above
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Even if someone adds one of these to the declared list by mistake, this fails. TRUNCATE and
-- MAINTAIN are the dangerous pair: neither is subject to row-level security, so on these
-- privileges a policy is not a second line of defence — the grant is the only one.

select is_empty(
  $$ select obj || ' / ' || role || ' / ' || priv from actual_acl
      where priv in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN') $$,
  '#405: no client role holds TRUNCATE / REFERENCES / TRIGGER / MAINTAIN on any object'
);

-- MAINTAIN called out on its own: it is PG17-new, invisible to information_schema, and permits
-- REINDEX and CLUSTER, which take an ACCESS EXCLUSIVE lock. It was granted on 30 objects here.
select is_empty(
  $$ select obj || ' / ' || role from actual_acl where priv = 'MAINTAIN' $$,
  '#405: MAINTAIN is held by no client role (REINDEX/CLUSTER would lock the table)'
);

-- anon is the unauthenticated internet. It may read what is published and add itself to the
-- waitlist; it may never mutate anything else.
select is_empty(
  $$ select obj || ' / ' || priv from actual_acl
      where role = 'anon' and priv <> 'SELECT'
        and not (obj = 'email_waitlist' and priv = 'INSERT') $$,
  '#405: anon holds only SELECT, plus INSERT on email_waitlist'
);

-- A RESTRICTIVE policy grants nothing — it can only subtract from what a PERMISSIVE policy
-- already allows. #106's moderation net (active_write_insert/update/delete) is restrictive and
-- sits on most user-content tables, so reading pg_policies without checking `permissive` makes a
-- table look as though it permits verbs it has never permitted. The first cut of the #405 sweep
-- made exactly that mistake and re-granted UPDATE on candidacy_votes, whose creating migration
-- says a vote is immutable. Views are excluded: they carry no policies, so their SELECT is
-- declared by hand above rather than derived.
select is_empty(
  $$ select a.obj || ' / ' || a.role || ' / ' || a.priv
       from actual_acl a
       join pg_class c on c.relname = a.obj
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind in ('r', 'p')
        and a.priv in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        and not exists (
          select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = a.obj
             and p.permissive = 'PERMISSIVE'
             and a.role::text = any(p.roles::text[])
             and p.cmd in (a.priv, 'ALL')) $$,
  '#405: every client grant on a table has a PERMISSIVE policy behind it (restrictive grants nothing)'
);

-- The other direction, and the reason #409's first residue class turned out to be empty. #408's
-- open questions listed eleven "policies with no grant behind them" across six tables; every one
-- of the eleven was an active_write_* policy — restrictive, therefore granting nothing — counted
-- as if it were permissive. Third sighting of that trap in three changes, so it stops being
-- something a reader has to remember: a permissive client policy with no privilege behind it is
-- a vestige, and it fails here.
--
-- Column-level ACLs count as the grant: momento_proposals and realization_updates deliberately
-- hold NO table-level privilege and scope the same verb to named columns instead, so a
-- table-only reading would report four false vestiges. DELETE is skipped in the column branch
-- because DELETE is not a column privilege (has_column_privilege would raise, not answer).
select is_empty(
  $$ with perm as (
       select p.tablename::text as obj, r.role::text as role, v.verb::text as priv
         from pg_policies p
         cross join lateral unnest(p.roles) as r(role)
         cross join lateral unnest(
           case when p.cmd = 'ALL' then array['SELECT','INSERT','UPDATE','DELETE']
                else array[p.cmd] end) as v(verb)
        where p.schemaname = 'public'
          and p.permissive = 'PERMISSIVE'
          and r.role::text in ('anon', 'authenticated'))
     select perm.obj || ' / ' || perm.role || ' / ' || perm.priv
       from perm
      where not has_table_privilege(perm.role, ('public.' || quote_ident(perm.obj))::regclass, perm.priv)
        and not exists (
          select 1 from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
           where c.relname = perm.obj
             and a.attacl is not null
             and perm.priv in ('SELECT', 'INSERT', 'UPDATE')
             and has_column_privilege(perm.role, c.oid, a.attnum, perm.priv)) $$,
  '#409: every PERMISSIVE client policy has a table or column grant behind it (no vestigial policy)'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- The root cause: future objects are born narrow
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Without this the list above is a snapshot that rots on the next `create table`. The default
-- ACL is what re-granted the whole set to every object the schema has ever created.

select is_empty(
  $$ select pg_get_userbyid(d.defaclrole) || ' -> ' || d.defaclacl::text
       from pg_default_acl d
       join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public'
        and d.defaclobjtype = 'r'
        and pg_get_userbyid(d.defaclrole) = 'postgres'
        and (d.defaclacl::text like '%anon=%' or d.defaclacl::text like '%authenticated=%') $$,
  '#405: default privileges on public tables grant nothing to anon/authenticated (postgres grantor)'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Column-level ACLs — the deliberate narrowings a `revoke all` would have destroyed
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Seven tables scope a client privilege to named columns. `revoke all on table` drops column
-- privileges too, so 0119's revoke-then-grant shape is UNSAFE on these and the sweep migration
-- used named-verb revokes instead. If that distinction is ever lost, these fail.

select is(
  (select count(distinct c.relname)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attacl is not null
    where n.nspname = 'public'),
  7,
  '#405: 7 tables carry explicit column-level ACLs (revoke ALL on these would drop them)'
);

-- profiles: the engine's columns are not the owner's to write, and that is enforced by the
-- column list, not by a policy. founding_member and identity_verified are the ones that matter.
select ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'),
  'profiles: the owner still updates their display_name');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'founding_member', 'UPDATE'),
  'profiles: nobody grants themselves founding_member');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'identity_verified', 'UPDATE'),
  'profiles: identity_verified is Stripe Identity''s to set, not the profile owner''s');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'profiles: no client DELETE — erasure runs service-role through the GDPR queue');

-- notifications: marking a Momento read is one column.
select ok(has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE'),
  'notifications: read_at is still updatable (marking a Momento read)');

-- events: anon reads the published columns only; the organiser's private fields are withheld.
select ok(has_column_privilege('anon', 'public.events', 'title', 'SELECT'),
  'events: anon still reads the public event columns');

-- events / authenticated (#446): the organiser's INSERT is scoped to the columns create_event
-- writes, and UPDATE is gone entirely. RLS filters rows and never columns, so before this the
-- ownership predicate on events_insert_own / events_update_own let an organiser write fee_pct,
-- is_athanor_day and settlement_ack_at straight through PostgREST. Asserted as PRIVILEGES: a
-- write that fails could always be RLS swallowing it rather than the grant refusing it.
select ok(has_column_privilege('authenticated', 'public.events', 'title', 'INSERT'),
  'events: the organiser still inserts the columns create_event writes');
select ok(not has_column_privilege('authenticated', 'public.events', 'fee_pct', 'INSERT'),
  'events: nobody sets their own platform fee (fee_pct is server config, PRD §4.6)');
select ok(not has_column_privilege('authenticated', 'public.events', 'is_athanor_day', 'INSERT'),
  'events: nobody flags their own event as an Athanor day (it gates the Circle-premium chip)');
select ok(not has_table_privilege('authenticated', 'public.events', 'UPDATE'),
  'events: no client UPDATE at all — nothing in the app updates an event, and the live window is swept server-side');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- The other half: the sole writers kept writing
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Every revoke in the sweep names anon and authenticated. A copy-paste that reached
-- service_role would break the webhooks and the score engine silently, so assert it did not.

select is_empty(
  $$ select t.tbl || ' / ' || pv.priv
       from (values ('public.fund_contributions'), ('public.fund_aggregates'),
                    ('public.aura_events'), ('public.aura_scores'),
                    ('public.stripe_webhook_events'), ('public.notifications'),
                    ('public.circle_memberships')) as t(tbl)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE')) as pv(priv)
      where not has_table_privilege('service_role', t.tbl::text, pv.priv::text) $$,
  '#405: service_role still reads and writes the money, score and webhook tables'
);

-- service_role is NOT declared object-by-object here, and that is #409's second ruling rather
-- than an omission. It holds the full arwdDxtm set on every object in this schema, from the
-- pg_default_acl rows of both grantors — one of which (supabase_admin) no migration can rewrite.
-- The drift is accepted: service_role bypasses RLS by definition and its key never leaves the
-- edge-function environment, so a narrower ACL buys no boundary, while a partial narrowing rots
-- on the next `create table` and breaks a webhook silently. It is also the one surface whose
-- answer differs between a from-zero replay and every hosted project, so pinning it would encode
-- one environment's truth as the invariant. The sole-writer assertion above is the part that
-- holds everywhere, and it is the part that matters.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Function EXECUTE — the axis #408 declared out of scope (#409)
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Same residue class, one object type over. PostgreSQL grants EXECUTE to PUBLIC on every new
-- function, and the pg_default_acl 'f' row adds anon and authenticated on top — #408 fixed the
-- 'r' row and left 'f' standing, so a new function is still born reachable by both client roles.
-- That default is deliberately left in place (a narrowed 'f' default would make every future RPC
-- 42501 unless its migration grants explicitly, and a broken screen is a worse failure mode than
-- a red test); these assertions are what makes leaving it safe.

create temporary view actual_function_acl as
  select p.proname::text as fn,
         case when ax.grantee = 0 then 'public'
              else pg_get_userbyid(ax.grantee)::text end as role,
         (p.prorettype = 'trigger'::regtype) as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ax
   where n.nspname = 'public'
     and ax.privilege_type = 'EXECUTE'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

-- A trigger function is invoked by the trigger, never called by a role — EXECUTE on one is a
-- privilege nobody can use and nobody audits. Stated as a rule and not a list, so it also covers
-- the trigger functions this schema does not have yet. Seven functions failed this before #409;
-- fifteen already passed it because their own migrations revoked.
select is_empty(
  $$ select fn || ' / ' || role from actual_function_acl
      where is_trigger and role in ('public', 'anon', 'authenticated') $$,
  '#409: no trigger function grants EXECUTE to public / anon / authenticated'
);

-- anon is the unauthenticated internet, and the 'f' default hands it every new function. This is
-- the assertion that makes a forgotten `revoke execute` loud: the default grants anon and
-- authenticated together, so anything that reaches authenticated by accident reaches anon too.
-- Declared one-directionally (nothing wider than this list) on purpose — the presence of these
-- four depends on whether the 'f' default ACL row exists in the database under test, which is a
-- platform fact, not a migration fact.
select is_empty(
  $$ select fn from actual_function_acl
      where role = 'anon'
        and fn not in ('events_nearby', 'f_profile_search', 'f_unaccent', 'is_on_ballot') $$,
  '#409: anon executes only events_nearby + the three search/ballot helpers'
);

-- PUBLIC is wider than anon: it includes every future role. The three that keep it are not RPCs —
-- f_unaccent and f_profile_search are index expressions (an index cannot depend on a privilege
-- the indexing role might lose) and is_on_ballot is a computed field PostgREST resolves per row.
select is_empty(
  $$ select fn from actual_function_acl
      where role = 'public'
        and fn not in ('f_profile_search', 'f_unaccent', 'is_on_ballot') $$,
  '#409: PUBLIC executes only the index-expression and computed-field helpers'
);

select * from finish();
rollback;
