-- #574 item 3 — the admin read path to REPORTED CONTENT ONLY.
--
-- This is the half #97 gated, and its ruling (2026-08-30) is the specification:
--
--   «A report on a chat message carries the specific reported message(s); the admin read path
--    never reaches the surrounding conversation or the thread. The reporter's act supplies the
--    basis for that copy; the non-reporting party's other words stay private.»
--
-- So the scope of both policies below is the REPORT JOIN, never conversation membership: a
-- message is admin-readable exactly while a report names it as its target, and one message
-- becoming readable tells the reader nothing about the message before or after it. There is no
-- conversation-wide arm here and no `conversations` policy change — a moderator reading a
-- report does not become a participant.
--
-- Why a policy rather than the service role: the panel reaches the database with the operator's
-- OWN cookie session on the publishable key (`apps/web/utils/supabase/server.ts` →
-- `createAuthedClient`), exactly as it already does for `reports` and `audit_log`. A
-- service-role read would work and would be worse — it would put the evidence outside RLS,
-- where no policy states the boundary and no pgTAP test can assert it. `athanor.is_admin()`
-- reads `app_metadata` (never `user_metadata`, rule #2) and is the same predicate
-- `reports_select_admin` and `resolve_report` already derive admin status from.
--
-- Both policies are additive PERMISSIVE arms: for a non-admin the `is_admin()` conjunct is
-- false and nothing about the existing participant reads changes. Neither adds a grant —
-- `messages` already grants SELECT to `authenticated` (0121:70) and `storage.objects` is
-- Supabase-managed — so `0121` needs no new row.

-- ── 1. the reported message row ─────────────────────────────────────────────────────────
-- `deleted_at is null` on this arm too, matching `messages_select_participant`. A message the
-- GDPR job has soft-deleted is gone for the moderator as well: erasure is not conditional on
-- whether someone reported the member first, and a report whose target no longer resolves
-- renders as "no longer available" in the panel (`target_id` has no FK — 20260620011307).
create policy "messages_select_reported" on public.messages
  for select to authenticated
  using (
    (select athanor.is_admin())
    and deleted_at is null
    and exists (
      select 1 from public.reports r
      where r.target_type = 'message'
        and r.target_id = messages.id
    )
  );

-- No status predicate on that EXISTS, and it is a decision. Scoping the read to
-- status in ('open','reviewing') would be tighter by a hair and would make an admin unable to
-- re-read the evidence behind their OWN recorded verdict — the panel renders a resolved report
-- and its audit trail, and evidence that disappears at the moment of the verdict makes that
-- page a claim nobody can check. The boundary that matters is "a report names this message",
-- not "the report is still open".

-- ── 2. the reported message's chat-media object ─────────────────────────────────────────
-- Same join, one level down: the object is readable exactly while some report targets the
-- message whose `media_url` IS this object's key. `messages.media_url` holds the storage key
-- ({sender_uid}/{conversation_id}/{media_id}.jpg), never a URL, so the equality below is the
-- whole binding — no path parsing, no cast, and therefore none of the uuid-shape-guard
-- machinery the participant policies need before their `::uuid` casts.
--
-- Deliberately NOT carried over from `chat-media_select_participant`:
--   • the conversation-membership EXISTS — that is the participant story, and reproducing it
--     here would be the conversation-wide reach #97's ruling forbids;
--   • `athanor.not_blocked` / `not_banned` of the owner — those hide a member's bytes from
--     someone who blocked them or from a banned author's readers. A moderator reviewing a
--     report is neither: a reported member is frequently exactly the member who is about to be
--     banned, and gating the evidence on the subject's standing would make the worst cases the
--     unreviewable ones.
create policy "chat-media_select_reported" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (select athanor.is_admin())
    and exists (
      select 1
        from public.reports r
        join public.messages m on m.id = r.target_id
       where r.target_type = 'message'
         and m.deleted_at is null
         and m.media_url = objects.name
    )
  );

-- Both EXISTS clauses read their tables under the CALLER's RLS, which is the property that
-- makes this chain honest rather than a second privilege: the storage arm can only see a
-- message row the messages arm above already admits, and that arm can only see a report row
-- `reports_select_admin` already admits. Break any link and the evidence stops resolving —
-- it never falls open.
