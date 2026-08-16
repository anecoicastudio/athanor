-- Issue #405 — the schema-wide sweep that 20260816143114 deliberately deferred.
--
-- That migration narrowed three fund money tables and said the rest of the schema very likely
-- carried the same residue. It does. Staging (eralyiwkfrpqsawivegz) was queried directly for
-- this change; production is NOT touched here — its narrowing arrives via the #80 release push.
--
-- The residue's source, now located exactly rather than inferred. `pg_default_acl` carries TWO
-- rows for schema public, one per grantor:
--
--   postgres       | public | r | anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, ...
--   supabase_admin | public | r | anon=arwdDxtm/supabase_admin, ...
--
-- `arwdDxtm` is the complete set: INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
-- and — on PG17 — MAINTAIN. Migrations run as `postgres`, so the FIRST row is the one that fires
-- for every table and view we create, and it is the one this migration rewrites (section 3). The
-- supabase_admin row governs objects the platform creates and is not ours to change.
--
-- Two things the audit snapshot in docs/grants-audit/ could not show, both found by querying:
--
--   1. MAINTAIN is granted on 30 objects and is INVISIBLE to information_schema.role_table_grants,
--      which enumerates only the seven SQL-standard privileges. The snapshot's 72 rows therefore
--      undercount the real surface. MAINTAIN permits VACUUM / ANALYZE / REINDEX / CLUSTER /
--      REFRESH MATERIALIZED VIEW; REINDEX and CLUSTER take an ACCESS EXCLUSIVE lock, so it is a
--      denial-of-service verb in an authenticated client's hands. RLS does not apply to any of
--      them. This is the same class of blind spot as the one #405 was filed about, one layer
--      down, which is why 0121 reads aclexplode(relacl) and not information_schema.
--
--   2. Seven tables carry EXPLICIT COLUMN-LEVEL grants (pg_attribute.attacl): events,
--      momento_proposals, notifications, profiles, realization_plan_phases, realization_plans,
--      realization_updates. `REVOKE ALL ON TABLE` also drops column-level privileges, so 0119's
--      revoke-then-grant shape would silently delete a deliberate, working narrowing — the
--      column list on profiles is the only thing keeping `founding_member` and
--      `identity_verified` unwritable by their own owner. Three of those seven need narrowing
--      here, and they use named-verb REVOKEs for exactly that reason (section 2).
--
-- The intended surface is derived, not invented: a role gets exactly the verbs its RLS policies
-- mediate. Where the grant is already NARROWER than the policies (a policy exists with no
-- privilege behind it — the #406 inverse), this migration changes NOTHING and the PR body lists
-- each case as a question. Widening a grant to match a policy is a behaviour change and does not
-- belong in a hardening sweep.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 1. Tables with no column-level ACL — revoke-then-grant (0119's shape)
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Restating the whole surface, rather than naming the verbs to remove, is what stops the verb
-- list from being incomplete again: MAINTAIN did not exist when most of these were written, and
-- the next privilege Postgres adds will be caught by `revoke all` for free.

-- Interest in an Athanor day — the owner's own row, full CRUD (5 policies).
revoke all on table public.athanor_days_interest from anon, authenticated;
grant select, insert, update, delete on table public.athanor_days_interest to authenticated;

-- Ballot votes — cast, change, withdraw your own (6 policies).
revoke all on table public.candidacy_votes from anon, authenticated;
grant select, insert, update, delete on table public.candidacy_votes to authenticated;

-- Circle membership — readable by its owner; every write is Stripe's, via the webhook.
-- 20260618204459's own revoke named `insert, update, delete` and so left the rest standing.
revoke all on table public.circle_memberships from anon, authenticated;
grant select on table public.circle_memberships to authenticated;

-- Consent records — append and amend your own; never delete one (no DELETE policy, by design:
-- a withdrawn consent is a new row, so the audit trail survives).
revoke all on table public.consent from anon, authenticated;
grant select, insert, update on table public.consent to authenticated;

-- Dream candidacies, milestones, dreams — the author's own, plus the public read the
-- pre-sign-up web pages depend on.
revoke all on table public.dream_candidacies from anon, authenticated;
grant select, insert, update, delete on table public.dream_candidacies to authenticated;

revoke all on table public.dream_milestones from anon, authenticated;
grant select on table public.dream_milestones to anon;
grant select, insert, update, delete on table public.dream_milestones to authenticated;

revoke all on table public.dreams from anon, authenticated;
grant select on table public.dreams to anon;
grant select, insert, update, delete on table public.dreams to authenticated;

-- Event attendance — check in and out of an event you are attending. Note this table never
-- carried TRUNCATE (20260703's revoke caught that one), only MAINTAIN/REFERENCES/TRIGGER.
revoke all on table public.event_attendance from anon, authenticated;
grant select, insert on table public.event_attendance to authenticated;

-- Favour offers — offer, amend, retract your own.
revoke all on table public.favor_offers from anon, authenticated;
grant select, insert, update, delete on table public.favor_offers to authenticated;

-- Milestone helps — the same shape, on someone else's dream.
revoke all on table public.milestone_helps from anon, authenticated;
grant select, insert, update, delete on table public.milestone_helps to authenticated;

-- Momenti — the author's own thread.
revoke all on table public.moments from anon, authenticated;
grant select, insert, update, delete on table public.moments to authenticated;

-- Notification preferences — create and edit your own; never delete (the row is the default).
revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;

-- Posts and everything hanging off them.
revoke all on table public.posts from anon, authenticated;
grant select, insert, update, delete on table public.posts to authenticated;

revoke all on table public.post_comments from anon, authenticated;
grant select, insert, update, delete on table public.post_comments to authenticated;

revoke all on table public.post_media from anon, authenticated;
grant select, insert, update, delete on table public.post_media to authenticated;

revoke all on table public.post_reactions from anon, authenticated;
grant select, insert, update, delete on table public.post_reactions to authenticated;

-- Projects — the owner's own.
revoke all on table public.projects from anon, authenticated;
grant select, insert, update, delete on table public.projects to authenticated;

-- Push tokens — a device registers and deregisters itself.
revoke all on table public.push_tokens from anon, authenticated;
grant select, insert, update, delete on table public.push_tokens to authenticated;

-- Remote config — a read for everyone, and nothing else. anon held TRUNCATE on this one: the
-- kill-switch table, truncatable by an unauthenticated client, with RLS unable to intervene.
revoke all on table public.remote_config from anon, authenticated;
grant select on table public.remote_config to anon, authenticated;

-- RSVPs — accept, change, cancel your own.
revoke all on table public.rsvps from anon, authenticated;
grant select, insert, update, delete on table public.rsvps to authenticated;

-- Stories.
revoke all on table public.story_segments from anon, authenticated;
grant select, insert, update, delete on table public.story_segments to authenticated;

revoke all on table public.story_reactions from anon, authenticated;
grant select, insert, update, delete on table public.story_reactions to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 2. Tables WITH a column-level ACL — named-verb revokes only
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- `revoke all` here would drop the column grants too. The verbs removed below are the ones no
-- client should ever hold and that have no meaningful column-scoped form in this schema.

-- events — anon's SELECT is column-scoped (20 of the table's columns; the private organiser
-- fields are withheld). Only `authenticated` is narrowed, and only on the four residue verbs.
revoke maintain, references, trigger, truncate on table public.events from authenticated;

-- notifications — `authenticated` holds UPDATE on read_at alone (marking a Momento read) and
-- SELECT on the table. Both survive; the residue does not.
revoke maintain, references, trigger, truncate on table public.notifications from authenticated;

-- profiles — the most load-bearing column ACL in the schema: SELECT on 8 columns, INSERT on 14,
-- UPDATE on 15, with founding_member and identity_verified absent from the write lists because
-- they are the engine's to set. DELETE is revoked as well: there is no DELETE policy on profiles
-- (erasure runs service-role through the GDPR queue), so the privilege was pure residue.
revoke delete, maintain, references, trigger, truncate on table public.profiles from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 3. Views — grants apply to views too, and no policy exists to derive intent from
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #405's text says "every table"; its own evidence file showed the identical residue on views,
-- and #406 already proved the rebuild-loses-grants trap in CI. All four are security_invoker,
-- so the underlying tables' RLS still applies to the SELECT — the DML grants below were never
-- reachable (a multi-relation view is not auto-updatable without an INSTEAD OF trigger), which
-- is again the reason this is hardening and not an incident. An unreachable privilege is still
-- an unaudited one.

-- entitlements — the caller's own Circle entitlements. anon held the full DML set and no
-- migration ever revoked anything from anon on this view: 20260618204459 created it with a bare
-- `grant select … to authenticated` and the default privileges supplied the rest. anon is
-- removed entirely rather than left with SELECT; the view is security_invoker over
-- circle_memberships, so an anon read returns zero rows today and the revoke is a no-op in
-- behaviour and a real narrowing on paper.
revoke all on table public.entitlements from anon, authenticated;
grant select on table public.entitlements to authenticated;

-- favor_needs — the projection the favours screen reads.
revoke all on table public.favor_needs from anon, authenticated;
grant select on table public.favor_needs to authenticated;

-- fund_candidate_cards — the ballot card. Recreated by three separate migrations, each of which
-- restated `revoke all … from anon` / `grant select … to authenticated`, so anon stayed clean
-- while authenticated re-acquired the default set on every CREATE OR REPLACE.
revoke all on table public.fund_candidate_cards from anon, authenticated;
grant select on table public.fund_candidate_cards to authenticated;

-- fund_edition_expense_totals — landed narrow in 20260816161023 (the pattern applied by hand).
-- Restated here so the sweep is exhaustive and this view is not an exception a reader must
-- verify elsewhere.
revoke all on table public.fund_edition_expense_totals from anon, authenticated;
grant select on table public.fund_edition_expense_totals to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 4. The root cause — future objects are born narrow
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Without this, section 1–3 is a snapshot that rots on the next `create table`. Six migrations
-- before this one exist solely to patch this residue one table at a time; that is the cost of
-- leaving the default in place.
--
-- Scoped to the `postgres` grantor because that is who runs migrations and therefore owns every
-- object we create — `alter default privileges` with no `for role` clause targets the current
-- role, which is `postgres` here. The parallel supabase_admin row is untouched and unreachable
-- from a migration; it governs platform-created objects only.
--
-- Consequence, deliberately: a new table or view now reaches anon/authenticated with NO
-- privileges at all, and its migration must grant them explicitly. That is the point — an
-- explicit grant is reviewable and a default is not. 0121 fails loudly for any object whose
-- grants are not declared there, so the failure mode is a red test, not a broken screen.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Sequences and functions are left alone on purpose. The schema has no sequences (every table
-- takes a UUID primary key), and function EXECUTE is a separate axis that migrations already
-- handle per-function — 0080 asserts the SECURITY DEFINER half of it. Narrowing the function
-- default would silently break the next `create function` that a client is meant to call, which
-- is a different change with a different blast radius.

-- service_role is untouched throughout. It is the sole writer of the money tables (rule #6) and
-- the score tables (rule #1), and 0121 asserts its writes survived — a copy-paste that widened
-- any revoke above to service_role would break every webhook and the score engine.
