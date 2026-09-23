-- #788 — moderation catches up with /child-safety: a takedown, a ban from a post or behaviour
-- report, and a child-safety report category. Scope is Marco's 2026-09-23 ruling on the issue,
-- plus three rulings taken at the start of the lane (recorded in the PR body):
--   • a behaviour report reaches a ban only when its target_id names a profile;
--   • a post's bytes are freed in a SECOND, separate admin step, never by the takedown itself;
--   • a message's chat-media object is removed by the operator (RELEASE-RUNBOOK §7.8).
--
-- Seven parts, one transaction:
--   1. reports.category admits 'child_safety' (+ a partial index for triaging it first);
--   2. audit_log learns 'takedown' and 'purge_media', and grows the target columns a takedown
--      needs — a comment has no report type, and an email report has no report row at all, so
--      the report_id alone cannot say what was removed;
--   3. resolve_report v6 — suspend | ban on a post or behaviour report, and a child-safety warn
--      that does not tell the suspect;
--   4. admin_report_handles names the subject v6 now resolves;
--   5. admin_takedown() — the audited soft delete of a post, comment or message;
--   6. admin_purge_post_media() — the second step that lets post-media-reaper free the bytes;
--   7. the two member-read media policies stop serving an object whose post / message is
--      deleted, so a takedown hides the image the moment it hides the row.
--
-- ── resolve first, take down second ───────────────────────────────────────────────────────
-- messages_select_reported and chat-media_select_reported (20260831153525) both require
-- `deleted_at is null`: once a message is taken down, the moderator can no longer read it. So
-- admin_takedown refuses a report that is not yet upheld. A takedown with no report (a comment,
-- an email report) passes p_report_id => null and is audited on its target alone.
--
-- ── where the bytes go ────────────────────────────────────────────────────────────────────
-- SQL cannot remove an object: a storage.objects row delete orphans the file in the object
-- store (20260828103400's header quotes the Supabase docs). So:
--   • post       → admin_takedown hides the post and KEEPS its post_media rows, so its bytes
--                  survive for the police report (§7.8 step 5). admin_purge_post_media then
--                  deletes those rows, and post-media-reaper — which frees any post-media
--                  object no post_media row references, after a 1-hour grace — removes the
--                  files at its next run (nightly 04:29 UTC, or invoked by the operator).
--                  No reaper change: its predicate already covers an unreferenced object.
--   • comment    → carries no media (20260614185212).
--   • message    → the image stays in chat-media, unservable to both participants (part 7);
--                  the operator deletes the object through the Storage API (§7.8). No
--                  chat-media reaper exists, and building one is outside the lane.
--
-- Zero Aura anywhere here (rule 1): no aura_events, no score path. A penalty still goes through
-- enqueue_score_award exactly as v5 did.

-- ── 1. reports.category: 'child_safety' ───────────────────────────────────────────────────
-- The CHECK was declared inline and unnamed in 20260620011307:12-13, so its name is Postgres's
-- default. Verified as `reports_category_check` on staging before this was written; production
-- replays the same migration from the same statement, so it gets the same default. Dropped by
-- name WITHOUT `if exists`: a hosted project where the name differed must fail loudly here,
-- not leave the old CHECK standing beside the new one.
alter table public.reports drop constraint reports_category_check;
alter table public.reports add constraint reports_category_check
  check (category in ('selling', 'income', 'mlm', 'harassment', 'spam', 'impersonation',
                      'child_safety', 'other'));

comment on constraint reports_category_check on public.reports is
  '#788: the report reasons. Mirrors REPORT_CATEGORIES (packages/schemas/src/report.ts). '
  '''child_safety'' is triaged first by getReportQueue and never named to the reported member '
  '(resolve_report v6 keeps its warn audit-only).';

-- getReportQueue reads child-safety reports ahead of the date-ordered queue, per status. The
-- general reports_admin_queue (status, created_at) would serve it only with a filter on every
-- row it walks; this one holds nothing but the rows that query wants, in its order.
create index reports_child_safety_queue
  on public.reports (status, created_at desc, id desc)
  where category = 'child_safety';

-- ── 2. audit_log: 'takedown' / 'purge_media' and their target ─────────────────────────────
-- Two nullable columns rather than composing the target into `reason` the way verify_phase
-- composes its phase: a takedown is looked up BY target (purge refuses a post nobody took
-- down), and a free-text id is not something a query should parse. Ids only — never the
-- content — so nothing here outlives an erasure that removes the content itself.
alter table public.audit_log
  add column target_type text check (target_type in ('post', 'comment', 'message')),
  add column target_id uuid;

comment on column public.audit_log.target_type is
  '#788: what a takedown / purge_media row acted on (post | comment | message). Null on every other action.';
comment on column public.audit_log.target_id is
  '#788: the id of the taken-down row. No FK — the row may later be erased; the id is the record.';

-- Drop → re-add, 20260816110227's pattern: the action list is re-declared whole, moderation,
-- then fund, then content — the order AUDIT_LOG_ACTIONS spells (packages/schemas/src/admin.ts;
-- audit-log-actions.mirror.test.ts reads the last `add constraint` of each name).
alter table public.audit_log
  drop constraint audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check check (
    action in ('dismiss','warn','penalty','suspend','ban','declare_winner',
               'screen_start','screen_pass','screen_reject','screen_reopen',
               'announce','void_cycle','winner_confirm','winner_decline',
               'close_cycle','rollover_cycle','publish_plan','verify_phase',
               'takedown','purge_media')
  ),
  add constraint audit_log_content_shape check (
    action not in ('takedown','purge_media')
    or (target_type is not null and target_id is not null and actor_id is not null
        and edition_id is null and penalty_points is null)
  ),
  add constraint audit_log_target_only_on_content check (
    action in ('takedown','purge_media')
    or (target_type is null and target_id is null)
  );

create index audit_log_target on public.audit_log (target_type, target_id, created_at desc)
  where target_id is not null;

-- ── 3. resolve_report v6 ──────────────────────────────────────────────────────────────────
-- Same signature, `create or replace`: the grant and PostgREST's single overload survive
-- (0091 pins the count at 1). Three changes from v5 (20260831153524), nothing else moves:
--
-- (a) SUBJECT gains 'behavior': a behaviour report whose target_id names a profile resolves
--     to that profile. That is the shape the staging seed files (seed-staging.sql:879) and the
--     one reports_target_required_unless_behavior (20260904152300) permits. A behaviour report
--     with no target — every one the app's Settings / Trust rows file today — still resolves
--     to nobody, so suspend/ban on it still raises 22023, and §7.8's person-report route is the
--     fallback for it. Resolved against `profiles`, not taken on trust: a target_id that names
--     no member is not a subject.
--
-- (b) THE ENFORCEMENT GATE widens for suspend | ban only. Marco's ruling names those two;
--     penalty stays person | message, because what a single post may cost in Aura is still a
--     decision nobody has taken (v5's header). 0062:74 and 0141:254 (penalty on a post →
--     22023) stay green by construction, as does 0091:83 (ban on a post whose target resolves
--     to nobody → 22023).
--
-- (c) A child-safety WARN is audit-only. The warn arm sends the category token to the member
--     (#313), and REASON_LABELS would render it as «Tutela dei minori»: to the very person a
--     child-safety report is about, that names the report. The notification is withheld; the
--     audit row still records the verdict. Every other category warns exactly as v5 did.
create or replace function public.resolve_report(
  p_report_id uuid, p_status text, p_resolution text,
  p_action text, p_severity text default null, p_penalty_points integer default null,
  p_suspend_until timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_ttype text; v_category text; v_subject uuid; v_rows int;
begin
  if not athanor.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_action not in ('dismiss', 'warn', 'penalty', 'suspend', 'ban') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if (p_action = 'dismiss') <> (p_status = 'dismissed') or p_status not in ('dismissed', 'upheld') then
    raise exception 'action/status mismatch' using errcode = '22023';
  end if;
  if p_action <> 'penalty' and p_penalty_points is not null then
    raise exception 'penalty_points requires action penalty' using errcode = '22023';
  end if;
  if p_action = 'suspend' and (p_suspend_until is null or p_suspend_until <= now()) then
    raise exception 'suspend requires a future p_suspend_until' using errcode = '22023';
  end if;

  update public.reports
     set status = p_status, resolution = p_resolution,
         reviewed_by = (select auth.uid()), updated_at = now()
   where id = p_report_id and status in ('open', 'reviewing')
   returning target_id, target_type, category into v_target, v_ttype, v_category;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if; -- already resolved or missing → no-op (idempotent guard)

  insert into public.audit_log (report_id, actor_id, action, penalty_points, reason)
    values (p_report_id, (select auth.uid()), p_action, p_penalty_points, p_resolution);

  -- The member this report is ABOUT, resolved once for every arm below. A target that no
  -- longer resolves — an erased message, a deleted post, a behaviour report naming no one —
  -- leaves this null, and each arm decides what null means for it.
  if v_ttype = 'person' then
    v_subject := v_target;
  elsif v_ttype = 'post' and v_target is not null then
    select author_id into v_subject from public.posts where id = v_target;
  elsif v_ttype = 'message' and v_target is not null then
    select sender_id into v_subject from public.messages where id = v_target;
  elsif v_ttype = 'behavior' and v_target is not null then
    select id into v_subject from public.profiles where id = v_target;
  end if;

  if p_action = 'penalty' then
    if v_ttype not in ('person', 'message') or v_subject is null then
      raise exception 'penalty verdict requires a person or message target with a resolvable subject'
        using errcode = '22023';
    end if;
  elsif p_action in ('suspend', 'ban') then
    if v_subject is null then
      raise exception '% verdict requires a target whose subject resolves', p_action
        using errcode = '22023';
    end if;
  end if;

  if p_action = 'penalty' then
    -- severity comes from the caller (computed in @athanor/core), never reverse-mapped in SQL.
    perform athanor.enqueue_score_award(v_subject, 'report_upheld', p_report_id, p_severity);
  elsif p_action = 'suspend' then
    -- greatest(): a new verdict can extend a running suspension, never shorten it.
    update public.profiles
       set suspended_until = greatest(coalesce(suspended_until, p_suspend_until), p_suspend_until),
           updated_at = now()
     where id = v_subject;
    perform athanor.enqueue_moderation_enforce(v_subject, 'suspend', p_suspend_until);
  elsif p_action = 'ban' then
    update public.profiles
       set banned_at = coalesce(banned_at, now()), -- idempotent: the first ban date is the fact
           updated_at = now()
     where id = v_subject;
    perform athanor.enqueue_moderation_enforce(v_subject, 'ban', null);
  elsif p_action = 'warn' then
    -- #313: the audit row records the verdict; the fan-out tells the member. Warn stays legal
    -- on every target type, so an unresolvable subject leaves the warn audit-only rather than
    -- raising. The payload carries the report's CATEGORY and nothing else — never the note,
    -- never the reported words (#602's zero-content contract). A child-safety category is
    -- never sent (#788): to the member it is about, the reason names the report.
    if v_subject is not null and v_category <> 'child_safety' then
      perform athanor.enqueue_notification(
        v_subject, 'moderation', 'notif.tpl.warn',
        jsonb_build_object('reason', v_category),
        jsonb_build_object('kind', 'report', 'id', p_report_id::text));
    end if;
  end if;
  -- 'dismiss': the audit row above IS the outcome.
end; $$;

comment on function public.resolve_report(uuid, text, text, text, text, integer, timestamptz) is
  'Moderation verdict (#106): dismiss | warn | penalty | suspend | ban (PRD §4.13). DEFINER, re-checks is_admin. v6 (#788) resolves a SUBJECT per target type — person → itself, post → posts.author_id, message → messages.sender_id, behavior → the profile its target_id names (none → no subject). penalty requires a person or message target whose subject resolves; suspend/ban require only a subject. penalty → enqueue_score_award (rule #1: the engine writes Aura, never this). suspend/ban → profiles state (RLS half) + enqueue_moderation_enforce (GoTrue half). warn → enqueue_notification carrying the category only (#313), withheld for child_safety. Zero aura_events written here.';

-- ── 4. admin_report_handles: the subject v6 resolves ──────────────────────────────────────
-- 20260904142701 named a subject for person and message reports only, "the two target types
-- the panel names today". v6 now lands a ban on a post's author and on a behaviour report's
-- named profile, so the header that names "the person the verdict will hit" has to name them
-- too — otherwise the operator bans someone the screen never showed. Same projection (two
-- handles), same posture, same bounds; `create or replace` with an unchanged return type.
create or replace function public.admin_report_handles(p_report_ids uuid[])
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
             when 'behavior' then tp.handle
             when 'message' then sp.handle
             when 'post' then ap.handle
           end
      from public.reports r
      join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles tp
        on r.target_type in ('person', 'behavior') and tp.id = r.target_id
      left join public.messages m
        on r.target_type = 'message' and m.id = r.target_id
      left join public.profiles sp on sp.id = m.sender_id
      left join public.posts p
        on r.target_type = 'post' and p.id = r.target_id
      left join public.profiles ap on ap.id = p.author_id
     where r.id = any (p_report_ids);
end; $$;

comment on function public.admin_report_handles(uuid[]) is
  'report_id -> (reporter handle, subject handle) for the moderation panel (#664). SECURITY '
  'DEFINER because profiles_select_authenticated composes the SYMMETRIC athanor.not_blocked, '
  'which nulls every profiles read whenever the admin and the party are a blocked pair; the '
  'policy is unchanged (#97: the admin read path reaches reported content only, never the '
  'surrounding surface) and this is the one channel that reads through it. Subject = the '
  'member resolve_report v6 lands a verdict on: person target, behaviour target profile, '
  'message sender, post author (#788); NULL when it does not resolve. athanor.is_admin() '
  're-checked inside, 42501 otherwise; at most 1000 ids (22023). Two handles and nothing else.';

-- Unchanged by `create or replace`, restated so this file reads whole.
revoke execute on function public.admin_report_handles(uuid[]) from public, anon;
grant execute on function public.admin_report_handles(uuid[]) to authenticated;

-- ── 5. admin_takedown ─────────────────────────────────────────────────────────────────────
-- POSTURE: resolve_report's. Client-callable by the operator's own session — EXECUTE revoked
-- from public + anon, granted to authenticated — with athanor.is_admin() re-checked inside
-- (42501), so the grant is not the authorization. SECURITY DEFINER because the three content
-- tables grant a client no path to another member's row: posts and post_comments are updated
-- only by their author, and messages carry no client UPDATE at all. Nothing else here needs
-- the elevation, and nothing is read back to the caller.
--
-- A takedown is a SOFT delete — `deleted_at`, the same column an author's own delete sets —
-- so every member read path (all of them filter `deleted_at is null`) drops the row at once,
-- and the bytes survive for step 5. `coalesce(deleted_at, now())`: an author who deleted the
-- row first keeps their date; the takedown is still journaled, because the operator needs the
-- record that moderation acted on it whatever the author did.
--
-- A message takedown also recomputes the conversation's `last_message_preview` /
-- `last_message_sender_id` from the newest surviving user message: the preview is a stored
-- copy of the message text (or '📷'), and leaving it would keep the removed words on both
-- members' chat list. `last_message_at` is left alone — it orders the list and drives unread,
-- and moving it backwards would reshuffle a list for a reason neither member can see.
--
-- Refusals, all before any write: 42501 not admin; 22023 bad type / null id / blank or long
-- reason; P0002 unknown report; 22023 report not upheld (resolve first — see the header);
-- P0002 the target names no row.
create function public.admin_takedown(
  p_target_type text, p_target_id uuid, p_reason text, p_report_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_status text; v_conv uuid;
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
    select status into v_status from public.reports where id = p_report_id;
    if not found then
      raise exception 'report not found' using errcode = 'P0002';
    end if;
    if v_status <> 'upheld' then
      raise exception 'resolve the report (upheld) before taking its content down'
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
    update public.conversations c
       set (last_message_preview, last_message_sender_id) = (
             select coalesce(left(nullif(m.body, ''), 140),
                             case when m.media_url is not null then '📷' end),
                    m.sender_id
               from public.messages m
              where m.conversation_id = c.id and m.kind = 'user' and m.deleted_at is null
              order by m.created_at desc, m.id desc
              limit 1)
     where c.id = v_conv;
  end if;

  insert into public.audit_log (report_id, actor_id, action, reason, target_type, target_id)
    values (p_report_id, (select auth.uid()), 'takedown', btrim(p_reason), p_target_type, p_target_id);
end; $$;

comment on function public.admin_takedown(text, uuid, text, uuid) is
  '#788: the moderator''s takedown. Soft-deletes a post, comment or message (deleted_at, so '
  'every member read drops it) and writes ONE audit_log row (action takedown, target_type + '
  'target_id, optional report_id). A report, when named, must already be upheld — resolve '
  'first, because the reported-read policies require deleted_at is null. Keeps the bytes: a '
  'post''s are freed by admin_purge_post_media + post-media-reaper; a message''s chat-media '
  'object by the operator (RELEASE-RUNBOOK §7.8). A message takedown recomputes the '
  'conversation preview. DEFINER, is_admin() re-checked (42501). Zero Aura.';

revoke execute on function public.admin_takedown(text, uuid, text, uuid) from public, anon;
grant execute on function public.admin_takedown(text, uuid, text, uuid) to authenticated;

-- ── 6. admin_purge_post_media ─────────────────────────────────────────────────────────────
-- The irreversible half, deliberately its own call. Deleting a taken-down post's post_media
-- rows is all SQL can do; post-media-reaper then finds the objects unreferenced and frees them
-- through the Storage API (grace 1 hour, and these are older). The operator runs it once §7.8
-- step 5 is done — the takedown alone never starts that clock.
--
-- Refuses a post that is not currently taken down: it must carry a 'takedown' audit row AND
-- still be deleted. The second half matters on staging, where refresh-staging revives the
-- seeded posts in place every hour — a revived post's media must never be purged by a
-- stale takedown. Returns how many post_media rows it released (0 is a legal answer: a text
-- post, or a second call). Same posture as admin_takedown.
create function public.admin_purge_post_media(p_post_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_report uuid; v_n integer;
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_post_id is null then
    raise exception 'post_id required' using errcode = '22023';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason required' using errcode = '22023';
  end if;
  if char_length(btrim(p_reason)) > 2000 then
    raise exception 'reason too long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.posts where id = p_post_id and deleted_at is not null) then
    raise exception 'post % is not taken down', p_post_id using errcode = 'P0001';
  end if;
  select a.report_id into v_report
    from public.audit_log a
   where a.action = 'takedown' and a.target_type = 'post' and a.target_id = p_post_id
   order by a.created_at desc
   limit 1;
  if not found then
    raise exception 'post % has no takedown on record', p_post_id using errcode = 'P0001';
  end if;

  delete from public.post_media where post_id = p_post_id;
  get diagnostics v_n = row_count;

  insert into public.audit_log (report_id, actor_id, action, reason, target_type, target_id)
    values (v_report, (select auth.uid()), 'purge_media', btrim(p_reason), 'post', p_post_id);
  return v_n;
end; $$;

comment on function public.admin_purge_post_media(uuid, text) is
  '#788: releases a taken-down post''s media for post-media-reaper. Deletes its post_media rows '
  '(the reaper then frees the unreferenced objects through the Storage API at its next run) and '
  'writes ONE audit_log row (purge_media, carrying the takedown''s report_id). Refuses (P0001) a '
  'post that is not deleted or has no takedown on record. Irreversible; run after RELEASE-RUNBOOK '
  '§7.8 step 5. DEFINER, is_admin() re-checked (42501). Returns rows released.';

revoke execute on function public.admin_purge_post_media(uuid, text) from public, anon;
grant execute on function public.admin_purge_post_media(uuid, text) to authenticated;

-- ── 7. the bytes stop being servable the moment the row goes ──────────────────────────────
-- A soft delete hides the ROW; it does not hide the OBJECT. Neither member-read policy on the
-- two media buckets consults the content row: `post-media_select_member` gates on the owner's
-- standing only (20260818114947), and `chat-media_select_participant` on conversation
-- membership (20260827054252). So a member who still holds a key — any feed reader's cached
-- post, the recipient's cached chat image — could mint a fresh signed URL for a taken-down
-- image right up to the purge (post) or the operator's manual delete (message). The takedown
-- would hide the card and leave the picture one request away.
--
-- athanor.media_taken_down(bucket, name) answers "does the content this object belongs to
-- still exist?", and both policies gain `not athanor.media_taken_down(bucket_id, name)`:
--   • post-media — keyed on the PATH, `{uid}/{post_id}/{n}.{ext}` (20260614204500:6): the
--     post named by the second segment is deleted. Not on post_media rows, because
--     admin_purge_post_media deletes those, and a hide keyed on them would re-expose the
--     bytes for the hours between the purge and the reaper's run. A key whose second segment
--     is not a uuid, or names no post yet (the composer uploads BEFORE the write, #579), is
--     not hidden — an in-flight publish must keep reading its own upload.
--     This hides an author's own soft-deleted post's media too, which nothing renders.
--   • chat-media — the message whose `media_url` is this key is deleted. The row survives a
--     takedown (soft delete), so the hide holds until the operator removes the object.
--
-- SECURITY DEFINER, and it has to be: both answers are about DELETED rows, and the caller's
-- own read of posts / messages filters `deleted_at is null`, so an invoker function would
-- never see the row it is looking for and would hide nothing. It returns one boolean about
-- one key the caller already names in the policy and leaks nothing else. EXECUTE stays with
-- authenticated (the policy runs as the caller) and is revoked from public + anon, which
-- carry no read on either bucket.
create function athanor.media_taken_down(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_bucket = 'post-media'
         and split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from public.posts p
         where p.id = split_part(p_name, '/', 2)::uuid and p.deleted_at is not null)
    when p_bucket = 'chat-media'
      then exists (
        select 1 from public.messages m
         where m.media_url = p_name and m.deleted_at is not null)
    else false
  end
$$;

comment on function athanor.media_taken_down(text, text) is
  '#788: true when the content a post-media / chat-media object belongs to is deleted — the '
  'post named by the key''s second segment, or the message whose media_url is the key. Read '
  'by post-media_select_member and chat-media_select_participant so a taken-down image stops '
  'being servable before its bytes are removed. DEFINER because the rows it looks for are '
  'exactly the ones the caller''s own RLS hides.';

revoke execute on function athanor.media_taken_down(text, text) from public, anon;
grant execute on function athanor.media_taken_down(text, text) to authenticated;

-- The chat arm probes messages by media_url among deleted rows only — a handful, ever.
create index messages_media_url_deleted
  on public.messages (media_url)
  where deleted_at is not null and media_url is not null;

-- Drop → re-create, each predicate restated whole from its live definition (read from
-- pg_policies on staging) plus the one new conjunct. Not `alter policy`: re-creating keeps the
-- full predicate in this file, which is what the next reader of the bucket needs.
drop policy "post-media_select_member" on storage.objects;
create policy "post-media_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
    and not athanor.media_taken_down(bucket_id, name)
  );

drop policy "chat-media_select_participant" on storage.objects;
create policy "chat-media_select_participant" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
    and not athanor.media_taken_down(bucket_id, name)
  );
