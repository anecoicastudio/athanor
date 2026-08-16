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
-- separately at the bottom (seven tables carry them deliberately, and `revoke all on table`
-- would silently drop them). service_role is asserted where it is the sole writer.

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

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
  ('moments',                     '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('momento_proposals',           '',       ''),                            -- column-scoped
  ('conversations',               '',       'SELECT'),                      -- created by get_or_create_conversation
  ('messages',                    '',       'SELECT,INSERT'),
  ('notifications',               '',       'SELECT'),                      -- + column UPDATE(read_at)
  ('notification_preferences',    '',       'SELECT,INSERT,UPDATE'),
  ('push_tokens',                 '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('push_receipts',               '',       ''),                            -- service-role only
  -- ── posts and stories ───────────────────────────────────────────────────────────────
  ('posts',                       '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('post_comments',               '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('post_media',                  '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('post_reactions',              '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('story_segments',              '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('story_reactions',             '',       'SELECT,INSERT,UPDATE,DELETE'),
  -- ── dreams, projects, favours ───────────────────────────────────────────────────────
  ('dreams',                      'SELECT', 'SELECT,INSERT,UPDATE,DELETE'),
  ('dream_milestones',            'SELECT', 'SELECT,INSERT,UPDATE,DELETE'),
  ('dream_candidacies',           '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('milestone_helps',             '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('projects',                    '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('favor_offers',                '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('favor_needs',                 '',       'SELECT'),                      -- view
  -- ── events ──────────────────────────────────────────────────────────────────────────
  ('events',                      '',       'SELECT,INSERT,UPDATE,DELETE'), -- anon SELECT is column-scoped
  ('event_attendance',            '',       'SELECT,INSERT'),
  ('event_live_stats',            'SELECT', 'SELECT'),
  ('event_tickets',               '',       'SELECT'),                      -- Stripe writes it
  ('rsvps',                       '',       'SELECT,INSERT,UPDATE,DELETE'),
  ('athanor_days_interest',       '',       'SELECT,INSERT,UPDATE,DELETE'),
  -- ── the fund: money is a cache of Stripe (rule 6), so clients read and never write ──
  ('fund_editions',               'SELECT', 'SELECT'),
  ('fund_aggregates',             'SELECT', 'SELECT'),
  ('fund_contributions',          '',       'SELECT'),
  ('fund_cycle_expenses',         'SELECT', 'SELECT'),
  ('fund_edition_expense_totals', 'SELECT', 'SELECT'),                      -- view
  ('fund_payout_ledger',          '',       'SELECT'),
  ('fund_candidate_cards',        '',       'SELECT'),                      -- view
  ('payout_accounts',             '',       'SELECT'),                      -- Stripe Connect writes it
  ('candidacy_votes',             '',       'SELECT,INSERT,UPDATE,DELETE'),
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

select * from finish();
rollback;
