-- #258 — a live seat claim refuses a second concurrent claim instead of re-extending it.
--
-- #105 (20260812225214) made the pending claim row the pre-charge arbiter and left the
-- same-user refusal semantics to #258: the ON CONFLICT branch re-claimed the caller's own
-- pending row idempotently, so two concurrent checkouts by the SAME member both got
-- 'claimed' and both minted a Checkout Session. If both were paid, the webhook's
-- ignoreDuplicates upsert swallowed the second charge — card charged, no ticket, 200.
--
-- The fix is one new verdict: an UNEXPIRED own pending claim returns 'claim_pending' and
-- no Session is minted. That closes the double-charge structurally, not probabilistically:
-- the claim (35 min) strictly outlives the Session it backs (30 min, Stripe's minimum —
-- create-ticket-checkout/logic.ts caps it), so refusing while the claim is live means at
-- most ONE payable Session can exist per (user, event) at any moment. By the time a
-- re-claim is allowed again, the previous Session is at least 5 minutes dead.
--
-- The cost is bounded, not permanent: a member who cancels hosted Checkout waits out the
-- claim TTL (≤35 min) before retrying — the lockout #258 refused to trade for is the
-- unbounded one. An expired pending claim, a refunded row, and a missing row all still
-- re-claim exactly as before.
--
-- Body of 20260813045347 (the moderation re-create, which added the is_active() guard)
-- plus the own-row pre-check. Concurrent callers serialize on the events FOR UPDATE lock,
-- so the pre-check cannot race another claim; the webhook does not take that lock, but the
-- ON CONFLICT ... WHERE belt below stays the fail-closed arbiter for that interleaving
-- (a pending row paid between pre-check and insert falls through to 'already_owned').
create or replace function public.claim_event_seat(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_capacity integer;
  v_taken bigint;
  v_status text;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'claim_event_seat: not authenticated';
  end if;
  if not athanor.is_active() then
    raise exception 'claim_event_seat: account suspended or banned' using errcode = '42501';
  end if;

  -- The events row is the arbiter: concurrent claims for one event queue here.
  select capacity into v_capacity
  from public.events
  where id = p_event_id and deleted_at is null
  for update;
  if not found then
    return 'not_found';
  end if;

  -- #258 — a live claim means a payable Session may already exist for this caller: refuse
  -- before the capacity count (a member mid-checkout should hear "you have a purchase in
  -- progress", never "sold out"). NULL expires_at is treated as expired — no writer leaves
  -- a pending row without one, and failing open here would be a permanent lockout.
  select status, expires_at into v_status, v_expires
  from public.event_tickets
  where user_id = v_uid and event_id = p_event_id;
  if found and v_status = 'pending' and v_expires is not null and v_expires > now() then
    return 'claim_pending';
  end if;

  if v_capacity is not null then
    select count(*) into v_taken
    from public.event_tickets
    where event_id = p_event_id
      and user_id <> v_uid  -- the caller's own row is replaced below, never double-counted
      and (status in ('paid', 'checked_in')
           or (status = 'pending' and expires_at > now()));
    if v_taken >= v_capacity then
      return 'sold_out';
    end if;
  end if;

  -- One row per (user, event): a fresh claim, a re-claim of an abandoned/expired one, and a
  -- re-buy after a refund all land on the same row. paid/checked_in rows are untouchable —
  -- the edge function refuses them first ('ticket already owned'), and the WHERE below is
  -- the fail-closed belt when it didn't.
  insert into public.event_tickets (user_id, event_id, status, expires_at)
  values (v_uid, p_event_id, 'pending', now() + interval '35 minutes')
  on conflict (user_id, event_id) do update
    set status = 'pending',
        expires_at = excluded.expires_at,
        stripe_payment_id = null,
        qr_token = null
    where event_tickets.status in ('pending', 'refunded');
  if not found then
    return 'already_owned';
  end if;
  return 'claimed';
end;
$$;

comment on function public.claim_event_seat(uuid) is
  'Pre-charge seat claim for paid events (#105): locks the events row, counts held seats (paid, checked_in, unexpired pending), writes the caller''s pending claim. An UNEXPIRED own pending claim refuses a second claim (#258, ''claim_pending'') — the claim outlives the Session it backs, so at most one payable Session exists per (user, event). DEFINER: the count, the lock and the insert are all denied to the invoker by design. Caller is auth.uid(), never a parameter.';
