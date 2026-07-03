-- P2.3 follow-up (athanor-reviewer Warning) — close the DEFINER bypass in
-- respond_to_connection: RLS now hides a blocked pair's pending request, but the accept
-- path is SECURITY DEFINER and only checked addressee+pending, so a blocked party holding
-- a cached request id (pre-block inbox/realtime) could still accept it — creating the
-- connection + opening a conversation + notifying the blocker. Add not_blocked(requester_id)
-- to the UPDATE's WHERE; a blocked pair now raises the same no_data_found as a missing
-- request (Inv 7: block state stays unobservable through this RPC).
--
-- Note: connection_requests_delete_own_pending stays un-gated on purpose — withdrawing
-- your own request post-block is harmless cleanup and leaks nothing.

create or replace function public.respond_to_connection(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  n  int;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.connection_requests
    set status = (case when p_accept then 'accepted' else 'declined' end)::public.connection_status
    where id = p_request_id and addressee_id = me and status = 'pending'
      and athanor.not_blocked(requester_id);
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no pending request to respond to' using errcode = 'no_data_found';
  end if;
end; $$;
