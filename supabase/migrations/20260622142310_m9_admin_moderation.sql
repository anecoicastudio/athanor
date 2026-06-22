-- M9 Trust · admin moderation (web /admin). Role from app_metadata (rule #2).
-- resolve_report: DEFINER, re-checks is_admin (defense-in-depth), transitions report,
-- writes audit_log, and for a penalty enqueues report_upheld to score-engine via guarded
-- pg_net (no-op until app.settings.score_engine_* set). Rule #1: writes NO aura_events.

create extension if not exists pg_net;

-- ── admin predicate (reads app_metadata, NEVER user_metadata) ────────────────
create or replace function athanor.is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
revoke execute on function athanor.is_admin() from public, anon;
grant execute on function athanor.is_admin() to authenticated;

-- ── admins read every report (members keep own-only from the reports slice) ───
create policy "reports_select_admin"
  on public.reports for select
  to authenticated
  using (athanor.is_admin());

-- ── append-only audit_log: admins read ──────────────────────────────────────
create policy "audit_log_select_admin"
  on public.audit_log for select
  to authenticated
  using (athanor.is_admin());

-- ── guarded enqueue to score-engine (mirrors enqueue_push) ───────────────────
create or replace function athanor.enqueue_score_award(
  p_profile uuid, p_type text, p_ref uuid, p_severity text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text := current_setting('app.settings.score_engine_url', true);
  v_key text := current_setting('app.settings.score_engine_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- engine not configured (pre-deploy) → no-op, never block the verdict
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'mode','award','profileId',p_profile,'type',p_type,'refId',p_ref,
      'ctx', jsonb_build_object('severity', p_severity))
  );
end; $$;
revoke execute on function athanor.enqueue_score_award(uuid, text, uuid, text) from public, anon, authenticated;

-- ── the verdict RPC ──────────────────────────────────────────────────────────
create or replace function public.resolve_report(
  p_report_id uuid, p_status text, p_resolution text,
  p_action text, p_severity text default null, p_penalty_points integer default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_rows int;
begin
  if not athanor.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('reviewing','upheld','dismissed') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  update public.reports
     set status = p_status, resolution = p_resolution,
         reviewed_by = (select auth.uid()), updated_at = now()
   where id = p_report_id and status in ('open','reviewing')
   returning target_id into v_target;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return; -- already resolved or missing → no-op (idempotent guard)
  end if;
  insert into public.audit_log (report_id, actor_id, action, penalty_points, reason)
    values (p_report_id, (select auth.uid()), p_action, p_penalty_points, p_resolution);
  if p_action = 'penalty' and v_target is not null then
    -- severity comes from the caller (computed in @athanor/core), never reverse-mapped in SQL.
    perform athanor.enqueue_score_award(v_target, 'report_upheld', p_report_id, p_severity);
  end if;
end; $$;
revoke execute on function public.resolve_report(uuid,text,text,text,text,integer) from public, anon;
grant execute on function public.resolve_report(uuid,text,text,text,text,integer) to authenticated;
