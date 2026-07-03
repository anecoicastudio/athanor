-- P2.3 — wire athanor.not_blocked() into the three connection policies that M9 deferred
-- (TODO(M9) markers in 20260616153035_connection_requests.sql). A blocked user could
-- still see and send connection requests, and existing connections with a blocked user
-- stayed visible. Effective bodies verified = original migration (no later alter policy).
-- Pattern mirrors conversations_select_participant in 20260619222420_m9_blocks_and_not_blocked.sql.
-- Storage media-bucket SELECT policies stay member-wide (deferred surface, tracked in
-- docs/PRODUCTION-READINESS.md P2.3 note).

-- both parties see a request ONLY while pending (Inv 7 preserved); hide it entirely
-- when either direction of a block exists between the two parties.
drop policy "connection_requests_select_party" on public.connection_requests;
create policy "connection_requests_select_party" on public.connection_requests
  for select to authenticated
  using (
    (select auth.uid()) in (requester_id, addressee_id)
    and status = 'pending'
    and athanor.not_blocked(
      case when (select auth.uid()) = requester_id then addressee_id else requester_id end
    )
  );

-- requester creates own, pending, to someone else — and never toward/from a block.
drop policy "connection_requests_insert_own" on public.connection_requests;
create policy "connection_requests_insert_own" on public.connection_requests
  for insert to authenticated
  with check (
    (select auth.uid()) = requester_id
    and status = 'pending'
    and requester_id <> addressee_id
    and athanor.not_blocked(addressee_id)
  );

-- participant reads own connections only; a connection with a blocked user disappears
-- from both sides (block ≠ disconnect — the row survives, visibility returns on unblock).
drop policy "connections_select_participant" on public.connections;
create policy "connections_select_participant" on public.connections
  for select to authenticated
  using (
    (select auth.uid()) in (profile_a, profile_b)
    and athanor.not_blocked(
      case when (select auth.uid()) = profile_a then profile_b else profile_a end
    )
  );
