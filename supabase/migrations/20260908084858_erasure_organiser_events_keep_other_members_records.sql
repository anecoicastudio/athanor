-- #107 review follow-up, same PR. The worst thing this branch would otherwise have shipped.
--
-- `events.organizer_id → profiles (id)` is ON DELETE CASCADE (20260615094844:20), and hanging off
-- `events` are `event_tickets.event_id`, `rsvps.event_id` and `event_attendance.event_id`, all
-- CASCADE too. So the nightly account delete, applied to a member who has ever ORGANISED
-- anything, hard-deletes every ticket every OTHER member bought from them, their check-in
-- records, and their RSVPs.
--
-- It was latent before this PR only because step (4b) was commented out. #107 uncomments it and
-- schedules it at 03:47 every night, so the latent case becomes the ordinary one. 20260908074427
-- does not cover it: that trigger protects rows that are already pseudonymised (`erased_at is not
-- null`), and the tickets destroyed here are LIVE tickets belonging to members who have erased
-- nothing and are owed both their seat and — under the controller's ruling — ten years of the
-- financial record behind it.
--
-- ── The shape, and why it is both halves rather than either ────────────────────────────────
--
-- Two things have to be true at once, and one statement cannot do both:
--
--   1. NOTHING OF ANOTHER MEMBER'S IS DESTROYED. Achieved by reassigning `organizer_id` to the
--      tombstone sentinel before (4b) runs, exactly as `event_attendance.scanned_by` and
--      `audit_log.actor_id` already are. With no row still pointing at the profile, the cascade
--      has nothing to walk. Reassignment rather than `ON DELETE SET NULL` on the FK: it needs no
--      schema change, it matches the two references this function already handles, and
--      `organizer_id` stays NOT NULL so nothing downstream has to learn a new state.
--
--   2. THE ERASED MEMBER'S OWN CONTENT STOPS BEING SERVED. An event's title, description, venue
--      and cover are theirs, and «everything else is deleted on request» is the other half of the
--      ruling. So every one of their events is SOFT-deleted in the same statement.
--
-- `deleted_at` is what makes the two compatible. It is a soft delete: it hides the event, and it
-- takes nothing with it — `event_tickets`, `rsvps` and `event_attendance` rows are all still
-- there, still readable by the members they belong to, still carrying their money. A hard delete
-- is what destroys them, and a hard delete is the thing this migration exists to prevent.
--
-- Deliberately ALL of them, past and future, not just the ones with somebody else's rows on them.
-- A future event whose organiser no longer exists cannot happen and must not stay joinable; a
-- past event is history, and hiding it costs the ticket holder nothing — the ticket row is the
-- record, and it survives.
--
-- Known consequence, stated rather than hidden: a soft-deleted event still resolves for the rows
-- that reference it, so a ticket holder's own history can render an event whose organiser is now
-- the sentinel — a profile with no handle. That is a display question, not a data-loss one, and
-- it is the price of not deleting their ticket.
--
-- No trigger fires on this: `events_enforce_paid_gate` is BEFORE **INSERT** only (verified
-- against the catalog), so reassigning a paid event raises no 55000.

create or replace function public.gdpr_release_profile_references(p_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tombstone uuid := public.gdpr_tombstone_profile_id();
begin
  if p_profile_id = v_tombstone then
    raise exception 'refusing to erase the tombstone sentinel itself';
  end if;

  update public.event_attendance set scanned_by = v_tombstone where scanned_by = p_profile_id;
  update public.audit_log        set actor_id   = v_tombstone where actor_id   = p_profile_id;

  -- The organiser's events: disowned so the cascade cannot reach anybody else's rows, and
  -- hidden so the erased member's own content stops being served. `coalesce` keeps an
  -- already-deleted event's original timestamp, which makes a re-run a no-op.
  update public.events
     set organizer_id = v_tombstone,
         deleted_at   = coalesce(deleted_at, now())
   where organizer_id = p_profile_id;

  -- Both arms: `inviter_id` is the member's own activations, `code` is the column the blocking
  -- FK actually points at.
  delete from public.invites
   where inviter_id = p_profile_id
      or code in (select p.referral_code from public.profiles p
                   where p.id = p_profile_id and p.referral_code is not null);
end;
$$;

comment on function public.gdpr_release_profile_references(uuid) is
  'GDPR erasure, step before the auth.users delete (#107): reassign the references that are other members'' records (event_attendance.scanned_by, audit_log.actor_id) to the tombstone sentinel, disown AND soft-delete the member''s events so the ON DELETE CASCADE from events cannot destroy other members'' tickets, RSVPs and check-ins, and delete the member''s invites by inviter_id and by referral code. Leaves nothing pointing at the profile, so deleting the account raises no 23503 and takes nothing with it. Service-role only; idempotent.';

revoke execute on function public.gdpr_release_profile_references(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_release_profile_references(uuid) to service_role;
