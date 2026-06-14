-- confirm_milestone_help — owner-confirms a help is done, atomically.
-- Bundles the two owner writes (milestone_helps.status accepted->completed AND the parent
-- tappa dream_milestones.status -> done) into ONE transaction so they can't diverge.
-- SECURITY INVOKER: runs as the caller, so the existing RLS (owner-only UPDATE on both
-- tables) + the milestone_helps_guard legal-edge trigger still apply — this function adds
-- atomicity, not privilege. The completed transition is the +40 helper / +10 owner event the
-- M6 engine reads; this function writes NO aura_* (rule #1). TODO(M6): engine consumes it.

create function public.confirm_milestone_help(p_help_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_milestone_id uuid;
begin
  -- Derive the tappa from the help itself (RLS-gated read) so a caller can't mark an
  -- unrelated milestone done by passing a mismatched id. NULL => not visible / not found.
  select milestone_id into v_milestone_id
  from public.milestone_helps
  where id = p_help_id and deleted_at is null;

  if v_milestone_id is null then
    raise exception 'help not found or not visible' using errcode = 'P0002';
  end if;

  -- help accepted -> completed (guard enforces the legal edge; RLS enforces dream-owner-only)
  update public.milestone_helps
  set status = 'completed'
  where id = p_help_id and deleted_at is null;

  -- the tappa -> done (RLS enforces dream-owner-only). Same transaction: if this raises or
  -- the prior update was a no-op for a non-owner, nothing partial is committed.
  update public.dream_milestones
  set status = 'done'
  where id = v_milestone_id and deleted_at is null;
end;
$$;
revoke execute on function public.confirm_milestone_help(uuid) from public, anon;
grant execute on function public.confirm_milestone_help(uuid) to authenticated;
