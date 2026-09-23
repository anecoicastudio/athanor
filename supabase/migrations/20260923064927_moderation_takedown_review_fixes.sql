-- #788 review fixes on 20260923062248 / 20260923063705 (both already on staging, so append-only).
--
-- 1. A takedown row outlives its report.
--    A takedown row is what makes a takedown stick (guard_takedown_undelete) and what
--    admin_purge_post_media checks for. But audit_log.report_id is ON DELETE CASCADE
--    (20260622142242:8), and reports.reporter_id cascades from profiles (20260620011307:9), so a
--    REPORTER erasing their account deleted the report and, with it, the takedown row —
--    reopening the author's undo and blocking the purge.
--    The FK itself cannot become SET NULL: `audit_log_moderation_shape` (20260815093035:37-40)
--    requires every VERDICT row to carry its report, deliberately, so verdict rows must keep
--    cascading with the report they judged. Only the content rows (takedown, purge_media —
--    whose shape CHECK already allows a null report, because a comment or an email report has
--    none) are detached: a BEFORE DELETE trigger on reports nulls their report_id first, and
--    the cascade that follows deletes the verdict rows only. The content row keeps its target,
--    actor and reason — ids and the operator's words, no reporter identity — which is the
--    retention the erasure design already applies to audit_log (20260908081549 tombstones
--    actor_id rather than deleting rows).
--    DEFINER: the delete that fires it can come from the erasure's cascade under any role, and
--    audit_log grants no client UPDATE. A trigger function: EXECUTE revoked (#409).
--
-- 2. admin_takedown, re-declared whole (same signature, so grants and the single overload
--    survive):
--    a. a report on a post or a message must be about the row being taken down — the audit
--       link is evidence, and v1 would journal an unrelated upheld report against any target;
--    b. a message takedown recomputes last_message_at together with the preview and sender,
--       from ONE surviving message. v1 moved sender and preview but left the timestamp, which
--       broke the unread derivation.

create function athanor.detach_content_audit_from_report()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.audit_log
     set report_id = null
   where report_id = old.id
     and action in ('takedown', 'purge_media');
  return old;
end; $$;

comment on function athanor.detach_content_audit_from_report() is
  '#788: BEFORE DELETE on reports. Nulls report_id on the takedown / purge_media rows that name '
  'the report, so the ON DELETE CASCADE that follows removes only its verdict rows and a '
  'takedown survives its report (a reporter''s erasure deletes the report).';

revoke execute on function athanor.detach_content_audit_from_report() from public, anon, authenticated;

create trigger reports_detach_content_audit
  before delete on public.reports
  for each row execute function athanor.detach_content_audit_from_report();

create or replace function public.admin_takedown(
  p_target_type text, p_target_id uuid, p_reason text, p_report_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_status text; v_rtype text; v_rtarget uuid; v_conv uuid;
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- `IF <null>` does not run (MIGRATIONS-ERRATA on 20260815093035): every null is named.
  if p_target_type is null or p_target_type not in ('post', 'comment', 'message') then
    raise exception 'target_type must be post, comment or message' using errcode = '22023';
  end if;
  if p_target_id is null then
    raise exception 'target_id required' using errcode = '22023';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason required' using errcode = '22023';
  end if;
  if char_length(btrim(p_reason)) > 2000 then
    raise exception 'reason too long' using errcode = '22023';
  end if;
  if p_report_id is not null then
    select status, target_type, target_id into v_status, v_rtype, v_rtarget
      from public.reports where id = p_report_id;
    if not found then
      raise exception 'report not found' using errcode = 'P0002';
    end if;
    if v_status <> 'upheld' then
      raise exception 'resolve the report (upheld) before taking its content down'
        using errcode = '22023';
    end if;
    -- A report on a post or a message is about THAT row: taking down anything else under its
    -- id would journal a link the report never made. A person or behaviour report is about a
    -- member, and may justify taking down any of their content — no row to match.
    if v_rtype in ('post', 'message')
       and (v_rtype <> p_target_type or v_rtarget is distinct from p_target_id) then
      raise exception 'report % is about % %, not % %',
        p_report_id, v_rtype, v_rtarget, p_target_type, p_target_id
        using errcode = '22023';
    end if;
  end if;

  if p_target_type = 'post' then
    update public.posts set deleted_at = coalesce(deleted_at, now()) where id = p_target_id;
  elsif p_target_type = 'comment' then
    update public.post_comments set deleted_at = coalesce(deleted_at, now()) where id = p_target_id;
  else
    update public.messages set deleted_at = coalesce(deleted_at, now()) where id = p_target_id
      returning conversation_id into v_conv;
  end if;
  if not found then
    raise exception '% % not found', p_target_type, p_target_id using errcode = 'P0002';
  end if;

  if v_conv is not null then
    -- All three from the SAME surviving message: unread is last_message_at > last_read_at AND
    -- last_message_sender_id <> me (20260902153057), so a sender from one message beside a
    -- timestamp from another lights the wrong thread. No survivor → the conversation's own
    -- creation time (the column is NOT NULL), no sender, no preview.
    update public.conversations c
       set (last_message_at, last_message_preview, last_message_sender_id) = (
             select coalesce(s.created_at, c.created_at), s.preview, s.sender_id
               from (select 1) one
               left join lateral (
                 select m.created_at,
                        coalesce(left(nullif(m.body, ''), 140),
                                 case when m.media_url is not null then '📷' end) as preview,
                        m.sender_id
                   from public.messages m
                  where m.conversation_id = c.id and m.kind = 'user' and m.deleted_at is null
                  order by m.created_at desc, m.id desc
                  limit 1) s on true)
     where c.id = v_conv;
  end if;

  insert into public.audit_log (report_id, actor_id, action, reason, target_type, target_id)
    values (p_report_id, (select auth.uid()), 'takedown', btrim(p_reason), p_target_type, p_target_id);
end; $$;

comment on function public.admin_takedown(text, uuid, text, uuid) is
  '#788: the moderator''s takedown. Soft-deletes a post, comment or message (deleted_at, so '
  'every member read drops it) and writes ONE audit_log row (action takedown, target_type + '
  'target_id, optional report_id). A report, when named, must already be upheld — resolve '
  'first, because the reported-read policies require deleted_at is null — and a post or message '
  'report must be about the row taken down. Keeps the bytes: a post''s are freed by '
  'admin_purge_post_media + post-media-reaper; a message''s chat-media object by the operator '
  '(RELEASE-RUNBOOK §7.8). A message takedown recomputes the conversation''s last message '
  '(time, preview, sender) from the newest survivor. DEFINER, is_admin() re-checked (42501). '
  'Zero Aura.';

revoke execute on function public.admin_takedown(text, uuid, text, uuid) from public, anon;
grant execute on function public.admin_takedown(text, uuid, text, uuid) to authenticated;
