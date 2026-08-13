-- #313 — the warn verdict tells the member (PRD §4.13; follow-up to #106 / PR #310).
--
-- PR #310's resolve_report recorded a warn in audit_log and stopped: no notification type
-- existed, so an upheld warn was invisible to the warned member — indistinguishable from
-- nothing having happened. This wires the missing producer through the existing fan-out
-- (athanor.enqueue_notification → notification-fan-out, the sole writer of notifications
-- rows). Guarded no-op like every producer: unconfigured fan-out never blocks the verdict.
--
-- Type decision: a NEW 'moderation' type, not a reuse. The help-status precedent
-- (20260813062922) reused 'dreamMilestone' to spare the constraint cascade, but a
-- governance notice under a borrowed type would render with that type's lead in the app
-- AND share its per-type mute — a member who muted an unrelated type would silently mute
-- their own warnings. 'moderation' deliberately gets NO row in the prefs UI (the
-- 'connection' type already sets that precedent): the in-app row always lands; push obeys
-- only the master toggle.
--
-- Recipient: 'person' → the target; 'post' → the post's author; 'behavior' (or a report
-- whose target_id is null) names no subject — nothing to send. The open→resolved guard
-- already makes the verdict idempotent, so one upheld warn is at most one notification.

-- ── 1. 'moderation' joins the closed type set ────────────────────────────────────────────
-- Both CHECKs are inline column constraints from 20260620025158; Postgres named them
-- <table>_type_check. Mirrored in packages/schemas NOTIFICATION_TYPES (same commit).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation'));

alter table public.notification_preferences drop constraint notification_preferences_type_check;
alter table public.notification_preferences add constraint notification_preferences_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation'));

-- ── 2. resolve_report v4 — warn gains its notification ───────────────────────────────────
-- create or replace, same signature: no drop, so the grant and PostgREST resolution are
-- untouched (the PGRST203 overload trap from v3's NOTE cannot occur here).
create or replace function public.resolve_report(
  p_report_id uuid, p_status text, p_resolution text,
  p_action text, p_severity text default null, p_penalty_points integer default null,
  p_suspend_until timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_ttype text; v_category text; v_recipient uuid; v_rows int;
begin
  if not athanor.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- 'reviewing' left the valid set: no caller ever sent it (packages/api/src/admin.ts maps
  -- dismiss→dismissed, everything else→upheld) and a verdict RPC that can park a report in
  -- limbo is a bug surface, not a feature.
  if p_action not in ('dismiss', 'warn', 'penalty', 'suspend', 'ban') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if (p_action = 'dismiss') <> (p_status = 'dismissed') or p_status not in ('dismissed', 'upheld') then
    raise exception 'action/status mismatch' using errcode = '22023';
  end if;
  -- penalty_points is the record of a penalty; on any other action a value would assert an
  -- Aura deduction that never happened.
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

  if p_action in ('penalty', 'suspend', 'ban') then
    if v_ttype <> 'person' or v_target is null then
      raise exception '% verdict requires a person target', p_action using errcode = '22023';
    end if;
  end if;

  if p_action = 'penalty' then
    -- severity comes from the caller (computed in @athanor/core), never reverse-mapped in SQL.
    perform athanor.enqueue_score_award(v_target, 'report_upheld', p_report_id, p_severity);
  elsif p_action = 'suspend' then
    -- greatest(): a new verdict can extend a running suspension, never shorten it.
    update public.profiles
       set suspended_until = greatest(coalesce(suspended_until, p_suspend_until), p_suspend_until),
           updated_at = now()
     where id = v_target;
    perform athanor.enqueue_moderation_enforce(v_target, 'suspend', p_suspend_until);
  elsif p_action = 'ban' then
    update public.profiles
       set banned_at = coalesce(banned_at, now()), -- idempotent: the first ban date is the fact
           updated_at = now()
     where id = v_target;
    perform athanor.enqueue_moderation_enforce(v_target, 'ban', null);
  elsif p_action = 'warn' then
    -- #313: the audit row records the verdict; the fan-out tells the member. Warn stays
    -- legal on every target type (unlike penalty/suspend/ban), so the recipient is
    -- resolved, never asserted: 'behavior' — and a target_id that no longer resolves —
    -- name no subject, and the warn remains audit-only.
    if v_ttype = 'person' then
      v_recipient := v_target;
    elsif v_ttype = 'post' and v_target is not null then
      select author_id into v_recipient from public.posts where id = v_target;
    end if;
    if v_recipient is not null then
      perform athanor.enqueue_notification(
        v_recipient, 'moderation', 'notif.tpl.warn',
        jsonb_build_object('reason', v_category),
        jsonb_build_object('kind', 'report', 'id', p_report_id::text));
    end if;
  end if;
  -- 'dismiss': the audit row above IS the outcome.
end; $$;

comment on function public.resolve_report(uuid, text, text, text, text, integer, timestamptz) is
  'Moderation verdict (#106): dismiss | warn | penalty | suspend | ban (PRD §4.13). DEFINER, re-checks is_admin. penalty → enqueue_score_award (rule #1: the engine writes Aura, never this). suspend/ban → profiles state (RLS half) + enqueue_moderation_enforce (GoTrue half). warn → enqueue_notification to the reported member (#313). Zero aura_events written here.';
