-- Event reminders — the producer `notif.tpl.eventReminder` never had (#126).
--
-- Every consumer of this notification has existed since M9: the prefs toggle
-- (apps/native .../notif-prefs.tsx), the glyph and lead key (components/trust/notifTypes.ts),
-- the route arm (lib/notification-route.ts), the IT/EN catalog entries and the fan-out
-- template (supabase/functions/_shared/notif-templates.ts). Only nothing ever enqueued one:
-- 20260701160235_m9_notification_producers.sql:38-41 wrote the reason down at the time —
-- "notif.tpl.eventReminder is a pre-event-start reminder, not an on-create signal; an AFTER
-- INSERT trigger fires the moment an event is authored (often days out) and has no attendee
-- count yet. Needs a scheduled job (pg_cron) reading events.starts_at, not a row trigger."
-- This is that job.
--
-- ── Why a sibling sweep and not an extension of live_window_sweep ─────────────────────────
--
-- 20260813054817's live_window_sweep runs on the same minute cadence and reads the same
-- events.starts_at, so "extend that scan" is the obvious move. It does not fit:
--   * live_window_sweep is scoped `where e.is_online` — a reminder is owed to in-person
--     events too, and widening that predicate would silently start opening live windows on
--     physical events.
--   * it writes one row per EVENT, declaratively, in a single SQL statement.
--     athanor.enqueue_notification's contract is one recipient per call, so a reminder must
--     fan out per RSVP — a different shape, not a bigger WHERE clause.
-- Same cadence, same columns, separate function. The two never touch the same rows.
--
-- ── The two slots ────────────────────────────────────────────────────────────────────────
--
--   t24  every published event, 24h out — the reminder people actually plan around.
--   t1   online events only, 1h out. A physical event needs travel time, so an hour's notice
--        is useless there; a stream is one tap away, so it is exactly right.
--
-- The slots are made NON-OVERLAPPING rather than independent: for an online event t24's
-- window is floored at the t1 lead. Without that floor, someone who RSVPs 30 minutes before
-- an online event satisfies both slots on the same tick and receives two identical
-- notifications one second apart — which is precisely the "Hai una nuova notifica" noise the
-- Athanor voice exists to avoid (PRD §4.14). A late RSVP to an online event therefore gets
-- the t1 reminder only; a late RSVP to a physical event gets t24, whose copy ("è tra poco" /
-- "is coming up") stays true at any distance inside the window.
--
-- ── Idempotency, and why the marker is NOT a column on rsvps ─────────────────────────────
--
-- The obvious marker is `rsvps.reminder_sent_at`. It would be client-forgeable: rsvps carries
-- a table-level UPDATE grant to `authenticated` with no column ACL (supabase/tests/
-- 0121_grant_catalog_sweep.test.sql pins it as 'SELECT,INSERT,UPDATE'), and rsvps_update_own's
-- WITH CHECK predicates on user_id only — RLS filters rows, never columns. A member could
-- PATCH the marker on their own row and suppress or replay their own reminder.
-- 20260819041755_events_column_scoped_client_grants.sql (#446) is the same defect one table
-- over, and its fix was to take client UPDATE off `events` entirely. Rather than re-open that
-- surface, the marker lives off the client grant surface altogether, in `athanor` — the
-- non-exposed schema, following athanor.waitlist_throttle (20260809160525).
--
-- Deduping on public.notifications instead would look safe (clients hold no INSERT there) but
-- races: enqueue_notification POSTs through pg_net and returns immediately, so the row does
-- not exist yet when the next minute's tick reads it. The marker is written in the same
-- statement that selects the work, which is what makes two sweeps enqueue once.
--
-- ── Why the sweep returns early when fan-out is unconfigured ─────────────────────────────
--
-- enqueue_notification is a guarded no-op until the notification_fanout_url/_key secrets
-- resolve (20260810103721, Vault). Claiming markers against that no-op would burn each RSVP's
-- one chance at a reminder and deliver nothing. Returning before the claim means an
-- unconfigured project simply does not remind; when the secrets land, the next tick picks up
-- whatever is still inside its window — and only that, because the window predicate still
-- applies, so there is no backlog to flush.

-- ── the marker ───────────────────────────────────────────────────────────────────────────
-- CONVENTION EXEMPTION (#180): no updated_at and no touch trigger. A send marker is an
-- append-only fact — a row records that one reminder slot was dispatched and is never
-- revised — so updated_at would be a column nothing maintains. The composite
-- (event_id, user_id, slot) PK IS the identity, exactly as in athanor.waitlist_throttle: a
-- surrogate uuid would let two rows claim one slot and double a reminder, which is the single
-- thing this table exists to prevent. sent_at is the created_at.
create table athanor.event_reminder_sends (
  event_id uuid        not null references public.events (id)   on delete cascade,
  user_id  uuid        not null references public.profiles (id) on delete cascade,
  slot     text        not null check (slot in ('t24', 't1')),
  sent_at  timestamptz not null default now(),
  primary key (event_id, user_id, slot)
);

comment on table athanor.event_reminder_sends is
  'CONVENTION EXEMPTION (#180). Idempotency markers for event reminders (#126): one row per '
  '(event, attendee, slot), written by public.event_reminder_sweep() before it enqueues. '
  'Append-only, never revised. Lives in `athanor` — off the client grant surface — because a '
  'marker on rsvps would be owner-writable (rsvps holds table-level UPDATE with no column ACL).';

-- The reaper below filters on sent_at alone, which the PK (event_id first) cannot serve.
create index event_reminder_sends_sent_at on athanor.event_reminder_sends (sent_at);

-- No policies and no grants: `athanor` is not in config.toml's exposed `schemas`, so PostgREST
-- cannot see this table, and RLS with zero policies is deny-all for anyone who reached it
-- anyway. Only the sweep, running as the cron owner, writes it.
alter table athanor.event_reminder_sends enable row level security;
revoke all on table athanor.event_reminder_sends from public, anon, authenticated;
grant all on table athanor.event_reminder_sends to service_role;

-- ── the sweep ────────────────────────────────────────────────────────────────────────────
-- security invoker, like live_window_sweep: cron runs it as postgres, which bypasses RLS by
-- design. Execute is revoked below, so no client role can reach it either way.
create function public.event_reminder_sweep() returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
begin
  -- fan-out unconfigured → remind nobody rather than mark everybody reminded (see header)
  if coalesce(athanor.runtime_setting('notification_fanout_url'), '') = ''
     or coalesce(athanor.runtime_setting('notification_fanout_key'), '') = '' then
    return;
  end if;

  for r in
    with due as (
      select e.id as event_id, r.user_id, s.slot, e.title
        from public.events e
        join public.rsvps r on r.event_id = e.id and r.status = 'going'
        cross join lateral (values
            -- t24: every event. Floored at the t1 lead for online events so the two slots
            -- never fire on the same tick for the same person.
            ('t24'::text, interval '24 hours',
             case when e.is_online then interval '1 hour' else interval '0' end, true),
            -- t1: online only.
            ('t1'::text,  interval '1 hour', interval '0', e.is_online)
          ) as s(slot, lead_hi, lead_lo, applies)
       where e.deleted_at is null
         and s.applies
         and e.starts_at >  now() + s.lead_lo
         and e.starts_at <= now() + s.lead_hi
    ),
    -- Claim and select in one statement: a concurrent tick either inserts the marker or is
    -- skipped by the conflict, and only the winner gets a row back to notify on.
    claimed as (
      insert into athanor.event_reminder_sends (event_id, user_id, slot)
      select event_id, user_id, slot from due
      on conflict (event_id, user_id, slot) do nothing
      returning event_id, user_id, slot
    )
    select c.user_id,
           c.event_id,
           e.title,
           -- the count at SEND time, not at claim time — «N partecipano» has to be current
           (select count(*) from public.rsvps g
             where g.event_id = c.event_id and g.status = 'going') as going_count
      from claimed c
      join public.events e on e.id = c.event_id
  loop
    perform athanor.enqueue_notification(
      r.user_id,
      'eventReminder',
      'notif.tpl.eventReminder',
      jsonb_build_object('title', r.title, 'count', r.going_count),
      jsonb_build_object('kind', 'event', 'id', r.event_id::text)
    );
  end loop;

  -- Retention: a marker is meaningless once its event is long past, and the FK already drops
  -- it when the event is deleted. Pruned here rather than by a second cron, so this table
  -- cannot inherit the "function exists, schedule does not" gap athanor.purge_email_waitlist
  -- has.
  delete from athanor.event_reminder_sends where sent_at < now() - interval '30 days';
end;
$$;

comment on function public.event_reminder_sweep() is
  'Event reminders (#126): enqueues notif.tpl.eventReminder per going RSVP, 24h before '
  'starts_at for every event and 1h before for online ones, once per (event, attendee, slot) '
  'via athanor.event_reminder_sends. Cron-only (postgres ctx). No-ops while fan-out is '
  'unconfigured, so no marker is burned undelivered.';

-- cron-only: not a client API
revoke execute on function public.event_reminder_sweep() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'event-reminder-sweep',
  '* * * * *',
  $$ select public.event_reminder_sweep() $$
);
