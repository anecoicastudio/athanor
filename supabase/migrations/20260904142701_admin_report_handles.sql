-- #664 — the moderation queue loses a reporter's handle when the admin and the reporter are a
-- blocked pair.
--
-- getReportQueue / getReportDetail (packages/api/src/admin.ts) resolved the reporter through a
-- PostgREST embed, `reporter:profiles!reports_reporter_id_fkey(handle)`, which runs under
-- profiles_select_authenticated. That policy composes the SYMMETRIC athanor.not_blocked
-- (20260619222420:52-64; latest policy form 20260818114947:108-112), so when a block exists in
-- EITHER direction between the signed-in admin and the reporter, the embed comes back NULL and
-- the queue row renders «@—». The report row itself is untouched (reports_select_admin), so the
-- panel shows a report it cannot attribute.
--
-- The issue names the reporter. The same conjunct nulls two more handles on the same surface:
-- the direct `from('profiles')` read that named a `person` report's TARGET, and the one inside
-- readReportedMessage that named a `message` report's SENDER — the person a verdict lands on.
-- 20260818114947:103-107 added `or athanor.is_admin()` precisely so the target read would not
-- lose its handle, but only on the not_banned axis; not_blocked sat outside that parenthesis.
-- So the panel could lose the name of the member it was about to ban, which is the worse half.
--
-- WHY NOT THE POLICY. The other fix on the table was extending that admin carve-out so it
-- wrapped not_blocked too. #97's ruling (Marco, 2026-08-30) closes that door: the admin read
-- path reaches REPORTED CONTENT ONLY — a report carries the specific reported thing, and the
-- admin never reaches the surrounding surface. profiles_select_authenticated is inherited by
-- every profiles read in the app (search_all's person arm, every author/partner/candidate
-- embed), so widening it would make every member an admin has blocked, or been blocked by,
-- visible to that admin everywhere: a widening of the surface, not a read of reported content.
-- 0050 keeps asserting mutual invisibility both ways and stays untouched; 0144 asserts the
-- policy text still leads with an unconditional not_blocked(id).
--
-- So the panel gets its own channel, the shape #663 gave the blocker's ledger (20260903083235):
-- a SECURITY DEFINER function that reads through the policy for ONE surface and projects ONLY
-- what that surface renders. It takes the report ids the queue already holds and answers
-- report_id → (reporter handle, subject handle). Both are the report's own parties: the person
-- who filed it and the person it is about. Nothing else about either — no id, no avatar, no
-- display name — and no row for a report the caller did not name.
--
-- SUBJECT is resolved the way resolve_report v5 (20260831153524) resolves the verdict's
-- subject, for the two target types the panel names today: person → the target itself,
-- message → messages.sender_id. A `post` or `behavior` report has no subject handle here —
-- the panel never rendered one, and resolving a post's author would be new behaviour, not a
-- fix. A message that no longer resolves (erased, `target_id` carries no FK) yields NULL, the
-- same absence readReportedMessage already reports beside it.
--
-- POSTURE. The same one resolve_report (20260622142310, latest 20260831153524) and the admin
-- readers admin_list_waitlist / admin_list_abandoned_dispatches take: client-callable —
-- EXECUTE revoked from public + anon, granted to authenticated — with athanor.is_admin()
-- re-checked INSIDE the body (42501 otherwise), so the grant is not the authorization. The
-- panel calls it with the operator's own cookie session, exactly as it calls resolve_report.
-- search_path locked. No 0121 row is owed: that file pins anon's and PUBLIC's executable
-- surface BY NAME, so a function that revokes from both never joins those lists — and would
-- turn 0121 red if the revoke were forgotten. 0144 asserts the three privileges directly.
--
-- A BANNED party still names: the profiles policy already shows banned members to an admin
-- (`or athanor.is_admin()`, 20260818114947), so the embed and the direct reads named them
-- before this change and the channel keeps that behaviour rather than inventing a tombstone
-- for the panel. A reporter whose profile is gone (cascade) has no report row left either.
--
-- Bounded: at most 1000 ids per call (22023 above that — the queue page is 26). A null or
-- empty array returns nothing; `IF <null>` does not run in plpgsql, so the null is handled by
-- name (MIGRATIONS-ERRATA on 20260815093035). Read-only, `stable`; zero aura path (rule 1).

create function public.admin_report_handles(p_report_ids uuid[])
returns table (report_id uuid, reporter_handle text, subject_handle text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_report_ids is null or cardinality(p_report_ids) = 0 then
    return;
  end if;
  if cardinality(p_report_ids) > 1000 then
    raise exception 'admin_report_handles takes at most 1000 report ids'
      using errcode = '22023';
  end if;
  return query
    select r.id,
           rp.handle,
           case r.target_type
             when 'person' then tp.handle
             when 'message' then sp.handle
           end
      from public.reports r
      join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles tp
        on r.target_type = 'person' and tp.id = r.target_id
      left join public.messages m
        on r.target_type = 'message' and m.id = r.target_id
      left join public.profiles sp on sp.id = m.sender_id
     where r.id = any (p_report_ids);
end; $$;

comment on function public.admin_report_handles(uuid[]) is
  'report_id -> (reporter handle, subject handle) for the moderation panel (#664). SECURITY '
  'DEFINER because profiles_select_authenticated composes the SYMMETRIC athanor.not_blocked, '
  'which nulls every profiles read whenever the admin and the party are a blocked pair; the '
  'policy is unchanged (#97: the admin read path reaches reported content only, never the '
  'surrounding surface) and this is the one channel that reads through it. Subject = person '
  'target or message sender, as resolve_report v5 resolves it; NULL for post/behavior. '
  'athanor.is_admin() re-checked inside, 42501 otherwise; at most 1000 ids (22023). Two '
  'handles and nothing else.';

revoke execute on function public.admin_report_handles(uuid[]) from public, anon;
grant execute on function public.admin_report_handles(uuid[]) to authenticated;
