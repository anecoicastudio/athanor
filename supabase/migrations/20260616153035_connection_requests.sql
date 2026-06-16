-- M5 connection-requests — the directed «Connetti» mechanic (backend 05 §2.4).
--
-- connection_requests is a directed state-machine (requester → addressee, pending →
-- accepted|declined). On accept a row is projected into connections (canonical-ordered
-- unordered pair, trigger-written only) and a `direct` conversation is opened by reusing
-- create_conversation_pair (no ice-breakers — those are Momento-only). Connections award
-- ZERO Aura (rule #1) and expose no public count (rule #3).
--
-- Privacy (Inv 7 — a decline must be indistinguishable from a withdrawal): clients can
-- SELECT a request ONLY while it is `pending`. Once accepted/declined the row drops out of
-- both parties' visibility — the requester sees absence, never a "declined" verdict, and
-- the connected state is read from `connections` instead. Because the post-transition row
-- is no longer client-visible, accept/decline cannot be a direct UPDATE (PostgREST's
-- RETURNING would fail its SELECT re-check); it goes through respond_to_connection (DEFINER),
-- mirroring the accept_momento RPC pattern.
--
-- Block-awareness (athanor.not_blocked) is deferred to M9 with the rest of the suite — no
-- `blocks` table exists yet (see conversations/dreams/storage). TODO(M9): not_blocked.

create type public.connection_status as enum ('pending', 'accepted', 'declined');

-- ── connection_requests ───────────────────────────────────────────────────────
create table public.connection_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        public.connection_status not null default 'pending',
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint connection_requests_no_self check (requester_id <> addressee_id)
);

-- one directed request per ordered pair
create unique index connection_requests_directed_uniq
  on public.connection_requests (requester_id, addressee_id);
-- at most one PENDING request across the unordered pair (blocks crossed A→B + B→A pending)
create unique index connection_requests_no_crossed_pending
  on public.connection_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  where status = 'pending';
-- incoming inbox feed (keyset; rule #9)
create index connection_requests_incoming_feed
  on public.connection_requests (addressee_id, created_at desc, id desc)
  where status = 'pending';
-- outgoing feed (button-state lookups)
create index connection_requests_outgoing
  on public.connection_requests (requester_id, created_at desc, id desc)
  where status = 'pending';

create trigger connection_requests_touch_updated_at
  before update on public.connection_requests
  for each row execute function public.touch_updated_at();

-- ── connections (established, trigger-written only) ─────────────────────────────
create table public.connections (
  id                uuid primary key default gen_random_uuid(),
  profile_a         uuid not null references public.profiles (id) on delete cascade,
  profile_b         uuid not null references public.profiles (id) on delete cascade,
  source_request_id uuid references public.connection_requests (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint connections_ordered_pair check (profile_a < profile_b)
);

create unique index connections_pair_uniq on public.connections (profile_a, profile_b);
-- per-participant keyset feeds for the searchable connections list (rule #9)
create index connections_a_feed on public.connections (profile_a, created_at desc, id desc);
create index connections_b_feed on public.connections (profile_b, created_at desc, id desc);

-- ── status-transition guard (invoker; pins the legal moves, stamps responded_at) ─
create function public.guard_connection_status_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'connection already %', old.status using errcode = 'check_violation';
  end if;
  if new.status not in ('accepted', 'declined') then
    raise exception 'illegal connection transition' using errcode = 'check_violation';
  end if;
  new.responded_at := now();
  return new;
end; $$;

create trigger connection_requests_guard_status
  before update on public.connection_requests
  for each row execute function public.guard_connection_status_change();

-- ── accept → project connections row + open a direct conversation ───────────────
create function public.on_connection_accepted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.connections (profile_a, profile_b, source_request_id)
      values (least(new.requester_id, new.addressee_id),
              greatest(new.requester_id, new.addressee_id),
              new.id)
      on conflict (profile_a, profile_b) do nothing;
    -- direct conversation (no ice-breakers; create_conversation_pair canonicalizes order)
    perform public.create_conversation_pair(new.requester_id, new.addressee_id, 'direct');
  end if;
  return new;
end; $$;
revoke execute on function public.on_connection_accepted() from public, anon, authenticated;

create trigger connection_requests_on_accepted
  after update on public.connection_requests
  for each row execute function public.on_connection_accepted();

-- ── respond_to_connection: the addressee accepts/declines (DEFINER, see header) ──
create function public.respond_to_connection(p_request_id uuid, p_accept boolean)
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
    where id = p_request_id and addressee_id = me and status = 'pending';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no pending request to respond to' using errcode = 'no_data_found';
  end if;
end; $$;
revoke execute on function public.respond_to_connection(uuid, boolean) from public, anon;
grant  execute on function public.respond_to_connection(uuid, boolean) to authenticated;

-- ── grants (clients never write connections; never UPDATE requests — respond via RPC) ─
revoke all on table public.connection_requests from anon, authenticated;
grant select, insert, delete on table public.connection_requests to authenticated;
grant all on table public.connection_requests to service_role;

revoke all on table public.connections from anon, authenticated;
grant select on table public.connections to authenticated;
grant all on table public.connections to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────────
alter table public.connection_requests enable row level security;
alter table public.connections enable row level security;

-- both parties see a request ONLY while pending (accepted/declined drop out → Inv 7:
-- requester sees absence, never a decline verdict). TODO(M9): and athanor.not_blocked(other)
create policy "connection_requests_select_party" on public.connection_requests
  for select to authenticated
  using (
    (select auth.uid()) in (requester_id, addressee_id)
    and status = 'pending'
  );

-- requester creates own, pending, to someone else.
-- TODO(M9): and athanor.not_blocked(addressee_id)
create policy "connection_requests_insert_own" on public.connection_requests
  for insert to authenticated
  with check (
    (select auth.uid()) = requester_id
    and status = 'pending'
    and requester_id <> addressee_id
  );

-- requester withdraws own pending request (silent; decline/withdraw indistinguishable).
-- accept/decline is NOT a client UPDATE — it goes through respond_to_connection (DEFINER).
create policy "connection_requests_delete_own_pending" on public.connection_requests
  for delete to authenticated
  using ((select auth.uid()) = requester_id and status = 'pending');

-- participant reads own connections only; no public enumeration (rule #3). No client
-- write policy — connections are written solely by on_connection_accepted (DEFINER).
-- TODO(M9): and athanor.not_blocked(other participant)
create policy "connections_select_participant" on public.connections
  for select to authenticated
  using ((select auth.uid()) in (profile_a, profile_b));

-- ── realtime (inbox subscription; RLS-scoped to pending rows for either party) ──
alter publication supabase_realtime add table public.connection_requests;
