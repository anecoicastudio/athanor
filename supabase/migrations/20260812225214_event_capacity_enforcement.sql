-- Event capacity, enforced end-to-end (#105).
--
-- Until now `events.capacity` was collected at creation and read by nothing: free RSVPs
-- never checked it, and the ticket path stated the design outright ("paid tickets consume
-- no capacity", stripe-webhook/handlers.ts). This migration DELIBERATELY REVERSES that
-- design decision (#105): from here on a seat is held by
--   · a 'going' RSVP                                  (free path), and
--   · a paid / checked_in ticket, or an UNEXPIRED pending claim   (paid path).
--
-- Both paths get the same arbiter: a FOR UPDATE lock on the parent events row. Two
-- concurrent claims (or RSVPs) serialize on that lock, and the second one's count sees the
-- first one's committed row — a naive read-then-act count cannot promise that. The lock
-- object is the same in both writers, so there is no deadlock ordering between them, and
-- each transaction holds it only for a count + one row write (no external calls inside).
--
-- "Sold" while a Checkout Session is open but unpaid (#105's open decision): a pending
-- claim row holds the seat for 35 minutes. The edge function caps the Session at 30
-- minutes (Stripe's minimum expiry), so the claim strictly outlives the Session it backs;
-- an abandoned claim stops counting on expiry with no sweep job — expiry is a predicate,
-- not a process. The claim row also becomes the pre-charge arbiter #258 asks for; the
-- refusal semantics of a same-user concurrent re-claim stay with #258.

-- ── 1. pending-claim TTL ─────────────────────────────────────────────────────────────────
-- Meaningful only while status = 'pending' (the webhook nulls it when it pays the row).
alter table public.event_tickets
  add column expires_at timestamptz;
comment on column public.event_tickets.expires_at is
  'Seat-hold TTL for status=pending claims (#105). NULL on paid/checked_in/refunded rows. An expired pending row holds no seat and is reused by the owner''s next claim.';

-- The capacity count filters on all three seat-holding statuses; the existing partial
-- index (event_tickets_by_event) covers only paid/checked_in and stays for the check-in
-- reads it serves.
create index event_tickets_seats
  on public.event_tickets (event_id)
  where status in ('pending', 'paid', 'checked_in');

-- ── 2. claim_event_seat — the paid-path gate ─────────────────────────────────────────────
-- SECURITY DEFINER because the invoker can do none of what the gate needs (00 §5 definer
-- discipline): event_tickets SELECT is owner-row-only under RLS so the count would see at
-- most one row; FOR UPDATE on events would require an UPDATE policy the caller fails; and
-- the INSERT is denied to authenticated at the GRANT layer on purpose (the webhook and this
-- function are the only writers). The caller is always auth.uid() — never a parameter.
create function public.claim_event_seat(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_capacity integer;
  v_taken bigint;
begin
  if v_uid is null then
    raise exception 'claim_event_seat: not authenticated';
  end if;

  -- The events row is the arbiter: concurrent claims for one event queue here.
  select capacity into v_capacity
  from public.events
  where id = p_event_id and deleted_at is null
  for update;
  if not found then
    return 'not_found';
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
  'Pre-charge seat claim for paid events (#105): locks the events row, counts held seats (paid, checked_in, unexpired pending), writes the caller''s pending claim. DEFINER: the count, the lock and the insert are all denied to the invoker by design. Caller is auth.uid(), never a parameter.';
revoke execute on function public.claim_event_seat(uuid) from public, anon;
grant execute on function public.claim_event_seat(uuid) to authenticated;

-- ── 3. release_event_seat — undo a claim whose Session never minted ──────────────────────
-- Best-effort: the edge function calls it when the Stripe call fails after a successful
-- claim. If the release itself fails, the 35-minute TTL is the backstop. Own pending row
-- only — a paid row can never be released this way.
create function public.release_event_seat(p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.event_tickets
  where event_id = p_event_id
    and user_id = (select auth.uid())
    and status = 'pending';
$$;
comment on function public.release_event_seat(uuid) is
  'Deletes the caller''s own pending seat claim (#105) when checkout could not start. DEFINER because authenticated holds no DELETE on event_tickets by design. Caller is auth.uid(), never a parameter.';
revoke execute on function public.release_event_seat(uuid) from public, anon;
grant execute on function public.release_event_seat(uuid) to authenticated;

-- ── 4. event_seats_taken — the sold-out read for the paid UI ─────────────────────────────
-- Ticket rows are owner-only under RLS, so the screen cannot count them itself. This
-- exposes ONE number — seats held — which is capacity math like the attendee count the
-- event screen already shows (rule #3 allows attendee counts; this is not a reaction/vanity
-- metric and identifies nobody).
create function public.event_seats_taken(p_event_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::integer
  from public.event_tickets
  where event_id = p_event_id
    and (status in ('paid', 'checked_in')
         or (status = 'pending' and expires_at > now()));
$$;
comment on function public.event_seats_taken(uuid) is
  'Seats currently held on the paid path (#105): paid + checked_in + unexpired pending. DEFINER because event_tickets SELECT is owner-row-only; returns a count, never rows. Feeds the sold-out state on the event screen.';
revoke execute on function public.event_seats_taken(uuid) from public, anon;
grant execute on function public.event_seats_taken(uuid) to authenticated;

-- ── 5. RSVP capacity trigger — the free-path gate ────────────────────────────────────────
-- The free path has no privileged chokepoint (clients write rsvps directly under RLS), so
-- the gate lives in a trigger. DEFINER because the invoker cannot FOR UPDATE the events row
-- (no UPDATE policy for non-organizers); the rsvps count itself is member-readable, but the
-- lock is what makes the count honest. Cannot be called directly (returns trigger).
create function public.enforce_rsvp_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_going bigint;
begin
  -- Same arbiter as claim_event_seat: both writers lock the events row first, so the two
  -- paths serialize against each other too, in one consistent order.
  select capacity into v_capacity
  from public.events
  where id = new.event_id
  for update;

  if v_capacity is null then
    return new;
  end if;

  select count(*) into v_going
  from public.rsvps
  where event_id = new.event_id
    and status = 'going'
    and user_id <> new.user_id;  -- an update of the caller's own row replaces it
  if v_going >= v_capacity then
    raise exception 'sold out' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
comment on function public.enforce_rsvp_capacity() is
  'Free-path capacity gate (#105): refuses a going RSVP beyond events.capacity under the same events-row lock claim_event_seat takes. DEFINER for the lock; fires only when NEW.status = going.';

create trigger rsvps_enforce_capacity
  before insert or update on public.rsvps
  for each row
  when (new.status = 'going')
  execute function public.enforce_rsvp_capacity();
