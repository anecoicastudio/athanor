-- The RSVP capacity exemption is for SETTLED tickets only — a pending claim is not a seat (#522).
--
-- 20260831085517 exempted a member holding «paid, checked_in, or an UNEXPIRED pending claim»
-- from `enforce_rsvp_capacity`, borrowing the predicate wholesale from `claim_event_seat` /
-- `event_seats_taken` (20260812225214) on the reasoning that the two should agree about what
-- holds a seat. They should — on the PAID path. Reused here the pending arm is a hole, and it
-- is the exact hole that migration's header says the design cannot have.
--
-- The claim's lifetime is the problem. `claim_event_seat` writes a 35-minute pending row before
-- any money exists, and an abandoned claim stops holding a seat by predicate — `expires_at` goes
-- into the past and every ticket-side count silently forgets it, with no sweep to run. An RSVP
-- has no such expiry. So a member could open a Checkout Session on a sold-out paid event, never
-- pay, and inside those 35 minutes PATCH a going RSVP onto it through PostgREST: exempt at write
-- time, and then permanently counted, because when the claim lapses the RSVP does not. They
-- would sit in «N partecipano», in the attendee stack and in the reminder fan-out, on an event
-- they never bought a ticket to — which is precisely what 20260831085517's header promises is
-- impossible («The exemption is per-holder, never a hole»).
--
-- The pending arm was never load-bearing either. The webhook mirrors only from
-- `handleTicketPaid`, always downstream of `assertSettled`, and by the time `mirrorRsvp` runs
-- the ticket row is 'paid' on every branch that reaches it: the upsert inserts 'paid', the
-- redelivery branch is entered only for a 'paid'/'checked_in' row, and the repair branch flips
-- the row to 'paid' before mirroring. A pending row is never the state the mirror sees.
--
-- So the exemption narrows to what actually means money arrived. The two predicates now differ
-- deliberately: `event_seats_taken` answers «is this seat unavailable to somebody else», where a
-- live claim must count; this answers «has this member already paid for their place», where it
-- must not. Same fact, two questions, and only one of them is about the future.
--
-- Replaced rather than edited: 20260831085517 was applied to staging before this surfaced
-- (rule 7, append-only). See supabase/MIGRATIONS-ERRATA.md — its header still describes the
-- three-status predicate.

create or replace function public.enforce_rsvp_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_going bigint;
begin
  -- #522 — the seat this row mirrors was already paid for on the ticket path, so counting it
  -- again would double-book one person against themselves. SETTLED statuses only: a pending
  -- claim expires and the RSVP it waved through would not (see header).
  if exists (
    select 1
      from public.event_tickets t
     where t.event_id = new.event_id
       and t.user_id  = new.user_id
       and t.status in ('paid', 'checked_in')
  ) then
    return new;
  end if;

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
  'Free-path capacity gate (#105): refuses a going RSVP beyond events.capacity under the same '
  'events-row lock claim_event_seat takes. Exempts a member whose ticket for that event has '
  'SETTLED — paid or checked_in (#522) — because the webhook mirrors a settled ticket as a going '
  'RSVP and that row is not a second seat. A pending claim does NOT exempt: it expires, and the '
  'RSVP it would have admitted does not. DEFINER for the lock; fires only when NEW.status = going.';

revoke execute on function public.enforce_rsvp_capacity() from public, anon, authenticated;

-- No cleanup statement. The wider predicate was live on staging for minutes, between one
-- `db push` and the next, with no client traffic in between and nothing but the backfill writing
-- rsvps — and it has never been applied to production, because both migrations ship in the same
-- change. A repair UPDATE here would therefore match nothing, and to be written at all it would
-- have to invent a rule for WHICH going rows to retire when a mixed event is over capacity. A
-- statement that cannot fire and could not be trusted if it did is worse than its absence.
