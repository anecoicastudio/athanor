-- event_attendance — check-in records (backend 04 §2.4). ORGANIZER-ONLY write: the insert WITH CHECK
-- joins events.organizer_id, so only the event's organizer can check people in. Idempotent on ticket_id
-- (re-scan = no-op → frontend «Già registrato»). IMMUTABLE system record (not user content): no
-- updated_at/touch trigger, no deleted_at, no UPDATE/DELETE policy — corrections via service role only
-- (documented rule exemption, mirrors athanor_days_interest). NEVER writes Aura: the +15 attendee /
-- +30 organizer awards are emitted by the M6 score-engine (07), capped server-side — TODO(M6).

create table public.event_attendance (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.event_tickets (id) on delete cascade,
  event_id      uuid not null references public.events (id)        on delete cascade,
  checked_in_at timestamptz not null default now(),
  scanned_by    uuid not null references public.profiles (id),     -- the organizer who scanned
  created_at    timestamptz not null default now(),
  unique (ticket_id)                                                -- idempotent: one check-in per ticket
);

comment on table public.event_attendance is 'Check-in records. Organizer-only write (RLS joins events.organizer_id). Idempotent on ticket_id. Immutable (no update/delete). Score effect (+15/+30) is M6 (07), never written here.';

create index event_attendance_by_event on public.event_attendance (event_id);   -- live counter (09)

-- privileges: members only; the organizer-only constraint is enforced by RLS, not grants.
revoke all on table public.event_attendance from anon;
grant select, insert on table public.event_attendance to authenticated;
grant all on table public.event_attendance to service_role;

alter table public.event_attendance enable row level security;

-- read: the ticket holder (their own check-in) OR the organizer of the event
create policy "event_attendance_select_holder_or_organizer"
  on public.event_attendance for select
  to authenticated
  using (
    (select auth.uid()) = (select organizer_id from public.events where id = event_id)
    or (select auth.uid()) = (select user_id from public.event_tickets where id = ticket_id)
  );

-- write: ONLY the organizer of the event may check people in
create policy "event_attendance_insert_organizer"
  on public.event_attendance for insert
  to authenticated
  with check (
    (select auth.uid()) = scanned_by
    and (select auth.uid()) = (select organizer_id from public.events where id = event_id)
  );

-- no update / no delete policy: a check-in is immutable; corrections via service role.
