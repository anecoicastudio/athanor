-- rsvps — free-event attendance intent (PRD §4.6 1-tap RSVP, frontend 04 §3.3,
-- backend 04 §2.2). One row per (user_id, event_id); the unique pair IS the
-- idempotency key. RSVP is INTENT, not user content → no deleted_at: cancelling
-- flips status='cancelled' so the unique row survives (a re-RSVP flips it back).
-- Attending an event is an M6-scored action (+15) — this migration NEVER writes
-- aura (rule #1) and NEVER touches money (event_tickets is the tickets-qr slice).

create table public.rsvps (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  event_id   uuid not null references public.events (id)   on delete cascade,
  status     text not null default 'going' check (status in ('going','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_id)          -- idempotency key: one RSVP per person per event
);

comment on table public.rsvps is 'Free-event attendance intent (PRD §4.6 1-tap RSVP). Idempotent per user+event. No deleted_at: cancel = status flip. Score effect (+15) is M6 (07), never written here.';

create trigger rsvps_touch_updated_at
  before update on public.rsvps
  for each row execute function public.touch_updated_at();

create index rsvps_by_event on public.rsvps (event_id) where status = 'going';   -- attendee count

-- privileges: members only (no anon)
revoke all on table public.rsvps from anon;
grant select, insert, update on table public.rsvps to authenticated;
grant all on table public.rsvps to service_role;

alter table public.rsvps enable row level security;

-- members can read RSVPs (attendee preview/count on event detail is allowed —
-- PRD §4.5 / rule #3 concern reaction counts, not attendance).
create policy "rsvps_select_authenticated"
  on public.rsvps for select
  to authenticated
  using (true);

create policy "rsvps_insert_own"
  on public.rsvps for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "rsvps_update_own"
  on public.rsvps for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);          -- USING + WITH CHECK (rule #2)

-- no delete policy: cancel = update status (keeps the idempotency row)
