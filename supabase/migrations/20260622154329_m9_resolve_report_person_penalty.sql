create or replace function public.resolve_report(
  p_report_id uuid, p_status text, p_resolution text,
  p_action text, p_severity text default null, p_penalty_points integer default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_ttype text; v_rows int;
begin
  if not athanor.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_status not in ('reviewing','upheld','dismissed') then raise exception 'bad status' using errcode = '22023'; end if;
  update public.reports
     set status = p_status, resolution = p_resolution, reviewed_by = (select auth.uid()), updated_at = now()
   where id = p_report_id and status in ('open','reviewing')
   returning target_id, target_type into v_target, v_ttype;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;
  insert into public.audit_log (report_id, actor_id, action, penalty_points, reason)
    values (p_report_id, (select auth.uid()), p_action, p_penalty_points, p_resolution);
  if p_action = 'penalty' then
    if v_ttype <> 'person' or v_target is null then
      raise exception 'penalty verdict requires a person target' using errcode = '22023';
    end if;
    perform athanor.enqueue_score_award(v_target, 'report_upheld', p_report_id, p_severity);
  end if;
end; $$;
revoke execute on function public.resolve_report(uuid,text,text,text,text,integer) from public, anon;
grant execute on function public.resolve_report(uuid,text,text,text,text,integer) to authenticated;
