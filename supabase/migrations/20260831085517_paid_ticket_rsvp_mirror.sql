-- A paid ticket now mirrors as a going RSVP, so reminders and «N partecipano» see it (#522).
--
-- Marco's ruling on #522 (2026-08-30) is option 1: `stripe-webhook` writes a `public.rsvps`
-- row when a ticket Checkout settles, and flips it to 'cancelled' when the charge is reversed.
-- Nothing downstream changes — `public.event_reminder_sweep()` (20260825085916) fans out per
-- going RSVP and `getEventAttendees` (packages/api/src/events.ts) counts the same rows — so the
-- audience widens without a second query in either place.
--
-- The rsvps write itself lives in the edge function, not here. What this migration owes it is
-- the one thing the ruling did not account for: the row it writes lands on a trigger.
--
-- ── Why the capacity trigger has to learn about tickets ──────────────────────────────────────
--
-- `rsvps_enforce_capacity` (20260812225214, #105) is `before insert or update ... when
-- (new.status = 'going')` and raises `P0001 'sold out'` past `events.capacity`. Service role
-- bypasses RLS; it does not bypass triggers. So the webhook's INSERT is gated by a count it was
-- never meant to be part of, and the failure direction is the worst one available:
-- `handleWebhook` releases the processing lease and answers 500 on any throw, Stripe retries for
-- three days, and sustained 5xx makes Stripe disable the ENDPOINT — which stops
-- `charge.refunded` and `charge.dispute.created` too, the only two paths that pull money back
-- out of the public Dream Fund ticker (handlers.ts:33-56 spells that consequence out). A
-- capacity refusal after the money moved would therefore not merely lose a reminder; it would
-- silently over-count a number members can see.
--
-- The refusal is reachable. Capacity 2, both seats sold and mirrored; one buyer refunds, so
-- `event_seats_taken` frees a seat and a third member legitimately buys — and at that instant
-- the mirrored RSVP of the refunded buyer is still 'going' unless the refund arm has already
-- run. The count says full, the ticket path says there was room, and the webhook 500s in a loop
-- against a condition no retry clears.
--
-- The fix is not to widen the capacity, and not to make the write swallow its errors: it is that
-- A MIRRORED RSVP IS NOT A SECOND SEAT. The seat was arbitrated once already, by
-- `claim_event_seat`, under the same `FOR UPDATE` lock on the events row and against the same
-- `capacity`. Counting it again on the free path double-books one person against themselves.
-- So the gate returns early for a member who already holds a seat on the paid path.
--
-- ── What deliberately does NOT change ────────────────────────────────────────────────────────
--
-- The count itself still includes mirrored rows. The tempting second half — "exclude
-- ticket-holders from v_going as well, so mirrors never consume free capacity" — was considered
-- and rejected: on a paid event there is no legitimate free RSVP (the seat costs money), so
-- excluding mirrors from the count would let a member who paid nothing PATCH a going RSVP onto a
-- sold-out paid event through PostgREST and appear in «N partecipano» beside people who bought
-- tickets. Keeping them in the count means the free arm refuses exactly that. The exemption is
-- per-holder, never a hole.
--
-- The lock is skipped along with the count on the exempt path. That is deliberate too: there is
-- nothing to arbitrate for a seat that is already held, and the webhook is the one caller that
-- must not queue behind other writers on a busy event's row.

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
  -- #522 — the seat this row mirrors was already counted on the paid path. Same predicate as
  -- claim_event_seat and event_seats_taken (20260812225214): paid, checked_in, or an UNEXPIRED
  -- pending claim. Read before the lock, because an exempt row has nothing to serialize against.
  if exists (
    select 1
      from public.event_tickets t
     where t.event_id = new.event_id
       and t.user_id  = new.user_id
       and (t.status in ('paid', 'checked_in')
            or (t.status = 'pending' and t.expires_at > now()))
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
  'events-row lock claim_event_seat takes. Exempts a member who already holds a seat on the paid '
  'path (#522) — the webhook mirrors a settled ticket as a going RSVP and that row is not a '
  'second seat. DEFINER for the lock; fires only when NEW.status = going.';

-- A trigger function's EXECUTE is a privilege nobody can use and nobody audits, and the
-- pg_default_acl 'f' row hands it to anon and authenticated (#409). `create or replace` keeps
-- the ACL the original CREATE left, so this is a no-op today and the guard against a future
-- `drop`/`create` pair that would re-inherit the default. 0121 asserts the rule over pg_proc.
revoke execute on function public.enforce_rsvp_capacity() from public, anon, authenticated;

-- ── the rows that predate the webhook change ─────────────────────────────────────────────────
-- Every ticket already settled bought a seat that no RSVP records, so without this the fix
-- reaches only tickets sold from the deploy onwards. `on conflict do nothing`, not `do update`:
-- a member who deliberately set their own row to 'cancelled' is making a statement about their
-- attendance, and a backfill is the wrong place to overrule it — the next reversal or re-buy
-- through the webhook will restate it either way. 'refunded' tickets are skipped: no seat, no
-- row. Runs AFTER the exemption above, so no backfilled row can trip the capacity gate.
insert into public.rsvps (user_id, event_id, status)
select t.user_id, t.event_id, 'going'
  from public.event_tickets t
 where t.status in ('paid', 'checked_in')
on conflict (user_id, event_id) do nothing;

-- The table comment predates the webhook writer and said the quiet part as an invariant:
-- «Free-event attendance intent … NEVER touches money». The first half is now the common case
-- rather than the whole story, and the second is about what THIS table writes, which is still
-- nothing. Restated so a reader of the catalog is not told the row can only have come from a tap.
-- (20260615115831's own header keeps the old wording — see supabase/MIGRATIONS-ERRATA.md.)
comment on table public.rsvps is
  'Attendance intent (PRD §4.6 1-tap RSVP). Idempotent per user+event. Written by the member on '
  'the free path, and by stripe-webhook as the service role when a paid ticket settles (#522) — '
  'so reminders and «N partecipano» see ticket holders too. A mirrored row is not a second seat: '
  'enforce_rsvp_capacity exempts a member who already holds one. No deleted_at: cancel = status '
  'flip, and a reversed charge flips the mirror the same way. Score effect (+15) is M6 (07), '
  'never written here.';
