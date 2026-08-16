-- Corrects 20260816164834_hosted_grant_sweep.sql, which is already applied and therefore
-- cannot be edited (project rule #7). See supabase/MIGRATIONS-ERRATA.md for the prose half.
--
-- The bug, in one line: THAT MIGRATION'S DERIVATION COUNTED RESTRICTIVE POLICIES AS IF THEY
-- GRANTED SOMETHING.
--
-- Its method — "a role gets exactly the verbs its RLS policies mediate" — was applied by reading
-- pg_policies without filtering on `permissive`. But a RESTRICTIVE policy grants nothing; it can
-- only subtract from what a PERMISSIVE policy already allows. A table whose only UPDATE policy is
-- restrictive permits no UPDATE at all, because there is nothing for the restriction to narrow.
--
-- #106's moderation net (`active_write_insert` / `active_write_update` / `active_write_delete`)
-- is RESTRICTIVE and sits on most user-content tables. So every table carrying it appeared to
-- have INSERT/UPDATE/DELETE policies when what it actually had was a suspension check attached to
-- verbs it never permitted in the first place. The sweep then "restated" grants for those verbs
-- and, worse, wrote them into 0121's expected list — so the tripwire built to catch
-- over-permissioning would have certified it.
--
-- Nothing here was reachable: with no permissive policy, RLS denies the statement regardless of
-- the grant, which is why the smoke passed and why this is still a hardening change. It is the
-- same "unreachable privilege is still an unaudited privilege" argument the swept migration makes
-- about the views, turned back on the sweep itself.
--
-- `candidacy_votes` is the sharpest case: 20260618131250 says in terms «no UPDATE policy/grant: a
-- vote is immutable; changing it = delete + insert», and MIGRATIONS-ERRATA records a real
-- incident where a stray non-1.000 UPDATE on that table corrupted consensusPercent. The previous
-- migration handed UPDATE back.
--
-- Verified before revoking: no client code issues any of these statements. The only hard deletes
-- in apps/ and packages/ are on blocks, connection_requests, post_reactions, story_reactions,
-- push_tokens and realization_plan_phases — every one of which keeps its DELETE below, because
-- every one has a permissive delete policy. The edge functions' deletes run as service_role,
-- which this sweep never touches.

-- ── UPDATE with no permissive update policy ──────────────────────────────────────────────
-- A reaction is toggled (insert / delete), never edited. A vote is immutable by design.
revoke update on table public.candidacy_votes  from authenticated;
revoke update on table public.post_reactions   from authenticated;
revoke update on table public.story_reactions  from authenticated;

-- athanor_days_interest loses both: its only permissive policies are select_own and insert_own.
-- The client registers interest with an upsert whose `ignoreDuplicates` maps to
-- `on conflict do nothing`, so INSERT alone serves it — a merge-upsert would have needed UPDATE.
revoke update, delete on table public.athanor_days_interest from authenticated;

-- ── DELETE with no permissive delete policy ──────────────────────────────────────────────
-- User content is soft-deleted: the client sets `deleted_at` through its UPDATE policy, and no
-- permissive delete policy exists on any of these. The DELETE grant was hosted residue that the
-- previous migration preserved instead of dropping.
revoke delete on table public.posts             from authenticated;
revoke delete on table public.post_comments     from authenticated;
revoke delete on table public.story_segments    from authenticated;
revoke delete on table public.moments           from authenticated;
revoke delete on table public.dreams            from authenticated;
revoke delete on table public.dream_milestones  from authenticated;
revoke delete on table public.dream_candidacies from authenticated;
revoke delete on table public.milestone_helps   from authenticated;
revoke delete on table public.favor_offers      from authenticated;
revoke delete on table public.projects          from authenticated;
revoke delete on table public.events            from authenticated;
revoke delete on table public.rsvps             from authenticated;

-- The four views keep the SELECT the previous migration granted. They carry no policies at all,
-- so their intent cannot be derived from pg_policies in either direction — it is declared by hand
-- in 0121 and unchanged here.
