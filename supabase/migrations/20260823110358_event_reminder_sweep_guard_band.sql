-- event_reminder_sweep: a guard band between the two slots, and retention that never stops (#126).
--
-- Two findings from the PR review of 20260823103624 / 20260823104651, fixed by replacement
-- because both earlier migrations are already applied to staging (rule 7, append-only).
--
-- ── 1. The t24 floor was one tick wide ─────────────────────────────────────────────────────
--
-- For an online event the t24 window was floored at exactly the t1 lead (1h), so the two slots
-- were disjoint PER TICK and no more: an online event 1h+30s out claimed t24 on one tick and
-- t1 on the very next minute, and the attendee received two byte-identical reminders sixty
-- seconds apart — precisely the noise the floor was written to prevent, one tick later.
--
-- The floor for online events is now a GUARD BAND above the t1 lead: t24 applies only when the
-- event is more than 3h out. An online RSVP between 1h and 3h out therefore gets no t24 and
-- waits for its t1, which is the reminder that is actually designed to fire at that distance;
-- an RSVP further out gets both, at least 2h apart. Why these numbers and not a marker lookup
-- ("skip t1 if t24 was sent recently"): window arithmetic keeps the disjointness structural —
-- the pgTAP file can assert it from the event's starts_at alone, with no ordering dependency
-- between slots and nothing extra to read per row.
--
-- Both slots still render the one notif.tpl.eventReminder template, which carries no slot
-- parameter; giving t1 its own copy («comincia tra un'ora») is a fan-out template + catalog
-- change and stays outside this migration.
--
-- ── 2. Retention ran only when fan-out was configured ──────────────────────────────────────
--
-- The 30-day reaper sat below the "fan-out unconfigured → return" guard, and that reaper is the
-- ONLY thing that prunes athanor.event_reminder_sends (20260823103624 chose in-sweep pruning
-- over a second cron on purpose). On a project without the Vault pair, or during a rotation
-- window where one half is momentarily empty, the table stopped being claimed AND stopped
-- being pruned, so an existing backlog never aged out. The delete now runs first,
-- unconditionally: retention is a property of the table, not of whether the current tick can
-- deliver anything.

create or replace function public.event_reminder_sweep() returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Named once so the two windows and the guard band read as one decision.
  c_t24_lead     constant interval := interval '24 hours';
  c_t1_lead      constant interval := interval '1 hour';
  -- t24 floor for ONLINE events: the t1 lead plus a 2h guard band, so the two slots can never
  -- land within two hours of each other for the same attendee.
  c_online_floor constant interval := interval '3 hours';
  v_due record;
begin
  -- Retention first and unconditionally — see header §2. A marker is meaningless once its event
  -- is long past, and the FK already drops it when the event is deleted.
  delete from athanor.event_reminder_sends where sent_at < now() - interval '30 days';

  -- fan-out unconfigured → remind nobody rather than mark everybody reminded
  if coalesce(athanor.runtime_setting('notification_fanout_url'), '') = ''
     or coalesce(athanor.runtime_setting('notification_fanout_key'), '') = '' then
    return;
  end if;

  for v_due in
    with due as (
      select e.id as event_id, rs.user_id, s.slot, e.title
        from public.events e
        join public.rsvps rs on rs.event_id = e.id and rs.status = 'going'
        cross join lateral (values
            -- t24: every event. For online events the floor is the guard band, not the t1
            -- lead — see header §1.
            ('t24'::text, c_t24_lead,
             case when e.is_online then c_online_floor else interval '0' end, true),
            -- t1: online only.
            ('t1'::text,  c_t1_lead, interval '0', e.is_online)
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
      v_due.user_id,
      'eventReminder',
      'notif.tpl.eventReminder',
      jsonb_build_object('title', v_due.title, 'count', v_due.going_count),
      jsonb_build_object('kind', 'event', 'id', v_due.event_id::text)
    );
  end loop;
end;
$$;

comment on function public.event_reminder_sweep() is
  'Event reminders (#126): enqueues notif.tpl.eventReminder per going RSVP, 24h before '
  'starts_at for every event and 1h before for online ones, once per (event, attendee, slot) '
  'via athanor.event_reminder_sends. Online t24 is floored at 3h so the two slots are ≥2h '
  'apart. Cron-only (postgres ctx). Prunes 30-day-old markers on every tick; claims nothing '
  'while fan-out is unconfigured, so no marker is burned undelivered.';
