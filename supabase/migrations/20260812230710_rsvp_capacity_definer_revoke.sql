-- DEFINER hygiene for enforce_rsvp_capacity() (#105 follow-up, review finding).
--
-- 20260812225214 created the trigger function without revoking EXECUTE, unlike every other
-- SECURITY DEFINER function in the repo (and in that same migration). "A direct call would
-- fail anyway (returns trigger)" is not the bar — the revoke is what keeps the 0080
-- DEFINER sweep honest, exactly as 20260809160525 put it for waitlist_throttle_check.
-- The prior migration is applied on staging, so the fix is appended here (rule 7).
revoke execute on function public.enforce_rsvp_capacity() from public, anon, authenticated;

-- Also recording a deliberate asymmetry the review surfaced: unlike claim_event_seat, the
-- trigger's events lock carries NO `deleted_at is null` filter — on purpose. The trigger's
-- only job is the capacity count; filtering deleted events would make a soft-deleted
-- event's row "not found", read as capacity NULL, and wave every RSVP through — the
-- fail-open direction. Whether a deleted event accepts RSVPs at all is the write policy's
-- question, not this gate's.
comment on function public.enforce_rsvp_capacity() is
  'Free-path capacity gate (#105): refuses a going RSVP beyond events.capacity under the same events-row lock claim_event_seat takes. DEFINER for the lock; fires only when NEW.status = going. No deleted_at filter on the lock — deliberate: a not-found row would read as unlimited capacity (fail-open); deleted-event writes are the policies'' concern.';
