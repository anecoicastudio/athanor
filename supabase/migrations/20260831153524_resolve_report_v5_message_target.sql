-- #574 — resolve_report v5: a message target carries a subject, so a verdict can land on it.
--
-- v4 (20260813135602) hard-gates penalty | suspend | ban on `v_ttype = 'person'` and resolves
-- the warn recipient for 'person' and 'post' only. With `'message'` newly legal in the CHECK
-- (20260831153523) but unknown here, every message report would admit exactly one verdict —
-- dismiss — which is a report button that cannot be acted on.
--
-- ── the shape of the fix: a SUBJECT, resolved once ──────────────────────────────────────
-- v4 carried two overlapping ideas in one variable: `v_target` is the report's target_id, and
-- for a 'person' report it also happens to be the member a verdict lands on. For a 'post' the
-- two already differed, which is why the warn arm had its own `posts.author_id` lookup. A
-- message makes that split unavoidable — `target_id` is a message row, and no verdict can be
-- applied to a message row. So v5 resolves `v_subject` ONCE, per target type, and every arm
-- below reads it:
--
--   person  → the target itself          (identical to v4)
--   post    → posts.author_id            (v4's warn-only lookup, hoisted)
--   message → messages.sender_id         (new)
--   behavior / unresolvable target → null
--
-- Behaviour for the three pre-existing target types is unchanged by construction: for 'person'
-- v_subject IS v_target, and 'post' keeps warn-only because the enforcement gate below still
-- excludes it. `0062:71-73` (penalty on a post target → 22023) and `0091:78-79` (ban on a post
-- target → 22023) both stay green, and `0091:116-136`'s warn-recipient assertions are untouched.
--
-- ── why 'message' joins the enforcement gate and 'post' does not ────────────────────────
-- Not an oversight carried forward: widening 'post' would be a product decision about whether
-- a single post can cost Aura or a suspension, which nobody has taken. A message report,
-- however, is #574's entire point — the offending act IS the message, and if it can only ever
-- be dismissed the granularity buys nothing.
--
-- A `kind='user'` row may legally carry a NULL sender: `messages_user_shape` (#336, still v3
-- after #155) admits the deleted-member shape the `sender_id ON DELETE SET NULL` action
-- produces mid-erasure. That resolves to `v_subject = null` and the gate then refuses the
-- verdict with 22023 rather than enforcing against nobody. An erased member is out of reach of
-- moderation by construction, and saying so loudly beats a silent no-op.
--
-- SECURITY DEFINER, so the two lookups read `posts` / `messages` with RLS bypassed. That is
-- deliberate and is what keeps the verdict independent of the admin's own read arms
-- (20260831153525): the subject resolves whether or not a policy would let the admin see the
-- row. `create or replace`, same signature — no drop, so the grant and PostgREST's single
-- overload survive untouched (`0091:280-283` pins the count at 1).

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
  -- longer resolves — an erased message, a deleted post, a 'behavior' report naming no
  -- subject — leaves this null, and each arm decides what null means for it.
  if v_ttype = 'person' then
    v_subject := v_target;
  elsif v_ttype = 'post' and v_target is not null then
    select author_id into v_subject from public.posts where id = v_target;
  elsif v_ttype = 'message' and v_target is not null then
    select sender_id into v_subject from public.messages where id = v_target;
  end if;

  if p_action in ('penalty', 'suspend', 'ban') then
    if v_ttype not in ('person', 'message') or v_subject is null then
      raise exception '% verdict requires a person or message target with a resolvable subject',
        p_action using errcode = '22023';
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
    -- on every target type (unlike penalty/suspend/ban), so an unresolvable subject leaves the
    -- warn audit-only rather than raising. The payload carries the report's CATEGORY and
    -- nothing else — never the note, never the reported words (#602's zero-content contract).
    if v_subject is not null then
      perform athanor.enqueue_notification(
        v_subject, 'moderation', 'notif.tpl.warn',
        jsonb_build_object('reason', v_category),
        jsonb_build_object('kind', 'report', 'id', p_report_id::text));
    end if;
  end if;
  -- 'dismiss': the audit row above IS the outcome.
end; $$;

comment on function public.resolve_report(uuid, text, text, text, text, integer, timestamptz) is
  'Moderation verdict (#106): dismiss | warn | penalty | suspend | ban (PRD §4.13). DEFINER, re-checks is_admin. v5 (#574) resolves a SUBJECT per target type — person → itself, post → posts.author_id, message → messages.sender_id — and penalty/suspend/ban require a person or message target whose subject resolves. penalty → enqueue_score_award (rule #1: the engine writes Aura, never this). suspend/ban → profiles state (RLS half) + enqueue_moderation_enforce (GoTrue half). warn → enqueue_notification carrying the category only (#313). Zero aura_events written here.';
