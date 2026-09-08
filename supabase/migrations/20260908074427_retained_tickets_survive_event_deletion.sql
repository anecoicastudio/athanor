-- #107, found on the way: a pseudonymised ticket had a SECOND parent that could still delete it,
-- and the delete did not have to be its own owner's.
--
--   event_tickets.event_id  → events (id)      ON DELETE CASCADE
--   events.organizer_id     → profiles (id)    ON DELETE CASCADE
--
-- So erasing an ORGANISER deletes their events, and that deletes every ticket every OTHER member
-- ever bought for them — including tickets already pseudonymised and retained under the
-- controller's ten-year ruling. 20260908071656 closed the owner's own cascade by nulling
-- `user_id`; this closes the third party's. One member exercising Article 17 must not destroy
-- another member's financial record, and «we keep payment rows for ten years» has to be true
-- regardless of who else leaves.
--
-- Narrow on purpose. The obvious alternatives both change product behaviour:
--   * `event_id` ON DELETE SET NULL would orphan LIVE tickets too, leaving paid seats pointing at
--     no event instead of vanishing with the cancelled event they were for.
--   * `organizer_id` ON DELETE SET NULL would leave the events themselves standing with no
--     organiser — a listed, joinable, ownerless event.
-- Neither question is #107's to answer, and both deserve their own issue. What #107 owes is the
-- retention invariant, and the invariant is narrower than either: **a ticket that has already
-- been pseudonymised is never deleted by anybody's cascade.** A BEFORE DELETE trigger detaches
-- exactly those rows and leaves every live ticket to cascade exactly as it does today.
--
-- The wider question — that erasing an organiser silently deletes other members' events,
-- tickets and check-in records — is real and is NOT fixed here.

alter table public.event_tickets
  alter column event_id drop not null;

comment on column public.event_tickets.event_id is
  'The event, or NULL on a GDPR-pseudonymised row whose event was later deleted (#107). A live ticket always has one — the detach below only ever fires on a row that already carries erased_at.';

-- BEFORE DELETE, so the detach lands before the FK cascade reads the rows. INVOKER: the only
-- deleter of an events row is the erasure job's service-role client or an admin path, both of
-- which already hold event_tickets.
create function public.detach_retained_tickets_from_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.event_tickets
     set event_id = null
   where event_id = old.id
     and erased_at is not null;
  return old;
end;
$$;

comment on function public.detach_retained_tickets_from_event() is
  'BEFORE DELETE on events (#107): detach already-pseudonymised tickets so the FK cascade cannot delete a financial record the controller''s 2026-09-07 ruling retains for ten years. Live tickets are untouched and still cascade.';

-- Trigger functions are invoked by the trigger and never called by a role, so EXECUTE on one is
-- a privilege nobody can use — 0121 asserts this as a rule and goes red without the revoke.
revoke execute on function public.detach_retained_tickets_from_event()
  from public, anon, authenticated;

create trigger event_tickets_detach_retained_before_event_delete
  before delete on public.events
  for each row execute function public.detach_retained_tickets_from_event();
