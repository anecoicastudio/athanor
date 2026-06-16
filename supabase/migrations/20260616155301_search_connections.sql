-- M5 connection-requests — searchable connections list (frontend 05 §3.5 «Connessioni»).
--
-- The peer in a `connections` row is whichever participant isn't the caller, so a plain
-- PostgREST select can't both resolve the peer's handle AND filter/keyset on it in one
-- query. This SECURITY INVOKER function does it server-side: RLS on connections still
-- applies (only the caller's own rows), it resolves the peer + handle, optionally filters
-- by handle, and keyset-paginates on (created_at, id) desc (rule #9 — never offset).
create function public.search_connections(
  p_query              text default '',
  p_cursor_created_at  timestamptz default null,
  p_cursor_id          uuid default null,
  p_limit              int default 20
)
returns table (connection_id uuid, peer_id uuid, peer_handle text, created_at timestamptz)
language sql security invoker set search_path = '' stable as $$
  select
    c.id as connection_id,
    case when c.profile_a = (select auth.uid()) then c.profile_b else c.profile_a end as peer_id,
    p.handle as peer_handle,
    c.created_at
  from public.connections c
  join public.profiles p
    on p.id = (case when c.profile_a = (select auth.uid()) then c.profile_b else c.profile_a end)
  where (coalesce(p_query, '') = '' or p.handle ilike '%' || p_query || '%')
    and (
      p_cursor_created_at is null
      or c.created_at < p_cursor_created_at
      or (c.created_at = p_cursor_created_at and c.id < p_cursor_id)
    )
  order by c.created_at desc, c.id desc
  limit greatest(1, least(p_limit, 50));
$$;
revoke execute on function public.search_connections(text, timestamptz, uuid, int) from public, anon;
grant  execute on function public.search_connections(text, timestamptz, uuid, int) to authenticated;
