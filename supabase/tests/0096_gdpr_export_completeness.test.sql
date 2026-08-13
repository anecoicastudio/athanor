-- GDPR export completeness (#129) — the DB half of the contract pinned in
-- supabase/functions/gdpr-export-job/logic.ts (EXPORT_SPEC) and its logic.test.ts mirror.
--
-- Sweep: every public table with a FK into public.profiles or auth.users carries a member's
-- personal data and MUST be either exported by gdpr-export-job or explicitly excluded here
-- with a reason. A new personal-data table fails this test until its export fate is decided.
-- Known limit: second-degree tables (FK into a content table, not into profiles — e.g.
-- dream_milestones, post_media) are not auto-swept; they appear in the exported list by hand
-- and EXPORT_SPEC reaches them via their parent's ids.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

-- the archive sections of EXPORT_SPEC (logic.ts) — keep the three lists in the same order
-- as the spec so a diff reads side-by-side
create temp table gdpr_exported (t text primary key);
insert into gdpr_exported values
  ('profiles'), ('dreams'), ('dream_milestones'), ('milestone_helps'),
  ('posts'), ('post_media'), ('post_reactions'), ('post_comments'),
  ('moments'), ('momento_proposals'), ('story_segments'), ('story_reactions'),
  ('projects'), ('favor_offers'),
  ('events'), ('athanor_days_interest'), ('rsvps'), ('event_tickets'), ('event_attendance'),
  ('messages'), ('connection_requests'), ('connections'), ('blocks'), ('reports'),
  ('notifications'), ('notification_preferences'), ('push_tokens'),
  ('aura_events'), ('aura_scores'), ('stars'),
  ('dream_candidacies'), ('candidacy_votes'), ('fund_contributions'), ('circle_memberships'),
  ('invites'), ('consent'), ('verifications'), ('gdpr_export_jobs'), ('gdpr_erasure_requests');

-- personal-data-adjacent tables deliberately NOT in the archive, each with its reason
create temp table gdpr_excluded (t text primary key, reason text not null);
insert into gdpr_excluded values
  ('conversations',  'pairwise container: the member''s content is the messages (exported); the row itself mostly names the counterpart'),
  ('audit_log',      'moderation internals: actor_id is the acting admin, not the member; verdicts reach the member as notifications (exported)'),
  ('push_receipts',  'transient delivery telemetry, purged by the receipt sweep — no durable member content');

-- (1) the sweep: no FK-to-profiles table is unaccounted
select is(
  coalesce((
    select string_agg(cl.relname, ', ' order by cl.relname)
    from (
      select distinct cl.relname
      from pg_constraint c
      join pg_class cl      on cl.oid  = c.conrelid
      join pg_namespace n   on n.oid   = cl.relnamespace
      join pg_class fcl     on fcl.oid = c.confrelid
      join pg_namespace fn  on fn.oid  = fcl.relnamespace
      where c.contype = 'f'
        and n.nspname = 'public'
        and ((fn.nspname = 'public' and fcl.relname = 'profiles')
          or (fn.nspname = 'auth'   and fcl.relname = 'users'))
    ) cl
    where cl.relname not in (select t from gdpr_exported)
      and cl.relname not in (select t from gdpr_excluded)
  ), ''),
  '',
  'every FK-to-profiles table is exported by gdpr-export-job or excluded here with a reason');

-- (2) the exported list names only real tables (typo/rename guard)
select is(
  coalesce((
    select string_agg(e.t, ', ' order by e.t) from gdpr_exported e
    where not exists (
      select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relname = e.t and cl.relkind = 'r')
  ), ''),
  '', 'every exported table exists in public');

-- (3) the excluded list names only real tables
select is(
  coalesce((
    select string_agg(e.t, ', ' order by e.t) from gdpr_excluded e
    where not exists (
      select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relname = e.t and cl.relkind = 'r')
  ), ''),
  '', 'every excluded table exists in public');

-- (4) a table cannot be on both lists
select is(
  coalesce((
    select string_agg(t, ', ' order by t) from gdpr_exported where t in (select t from gdpr_excluded)
  ), ''),
  '', 'exported and excluded are disjoint');

select finish();
rollback;
