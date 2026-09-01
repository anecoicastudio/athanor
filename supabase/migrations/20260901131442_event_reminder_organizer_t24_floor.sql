-- event_reminder_sweep: the organiser's t24 is floored at the guard band too (#617).
--
-- 20260831085518 gave the organiser their own slot, org_t1, and dropped them from the attendee
-- `t1` arm so the two could not land on the same tick. Its header then said «`t24` is untouched —
-- it fires a day earlier, cannot collide». That is true of an ONLINE event and false of a room.
--
-- `t24`'s floor is `case when e.is_online then c_online_floor else interval '0' end`. For a
-- physical event the floor is zero, so the t24 window runs the whole way down to `starts_at`
-- rather than stopping 3h out — a physical event 40 minutes away still satisfies it. And `t24`
-- joins `rsvps`, which does not care who the row belongs to: an organiser who self-RSVP'd to
-- their own free event is an ordinary going row. `RsvpBar` renders with no `isOrganizer` gate
-- (apps/native/src/app/(modal)/event/[id]/index.tsx), so that gesture is one tap away.
--
-- The two windows therefore overlap for exactly one shape — physical event, organiser holding a
-- going RSVP, inside the hour — and the sweep claims both markers on one tick. The PK is
-- (event_id, user_id, slot) so they are two legitimate rows, and `athanor.enqueue_notification`
-- mints a fresh dedupe_key per call, so nothing downstream collapses them: the organiser gets
-- «Apertura bottega è tra poco. 3 partecipano.» and «Il tuo evento «Apertura bottega» comincia
-- tra un'ora.» seconds apart. Two pushes about one event is the «Hai una nuova notifica» noise
-- the guard band exists to prevent, arriving through the door #522 had just opened.
--
-- ── The floor was never about being online ──────────────────────────────────────────────────
--
-- 20260823110358 introduced it as the ONLINE floor because, then, `t1` was the only second slot
-- and `t1` was online-only — so "is this event online?" and "does this member have a second slot
-- inside the day?" were the same question. `org_t1` split them, and the name kept answering the
-- old one. The floor is renamed `c_guard_floor` here and keyed on the question it was always
-- asking:
--
--   e.is_online or rs.user_id = e.organizer_id
--
-- An online attendee has `t1` at 1h; an organiser has `org_t1` at 1h, room or stream. Both are
-- floored at 3h so the pair stays >=2h apart. A physical event's ordinary attendee has no second
-- slot at all and keeps the zero floor — their `t24` may fire ten minutes before the doors, which
-- is the whole point of reminding somebody who has to travel.
--
-- Both columns are `not null` (20260615094844_events.sql), so the OR is two-valued and no row
-- falls through a NULL.
--
-- ── The price, stated ───────────────────────────────────────────────────────────────────────
--
-- An organiser who self-RSVPs to their own physical event inside 3h now gets org_t1 alone, and
-- `notif.tpl.eventReminderOrganizer` carries no head-count (_shared/notif-templates.test.ts
-- asserts it carries none), so they lose «N partecipano» in that window. #522 kept `t24` for the
-- organiser precisely because that count is useful to them. The trade is deliberate: it is the
-- same trade already made for the organiser of an online event, one reminder is worth more than
-- a head-count delivered twice, and outside 3h — where an organiser actually plans — the count
-- still arrives. Making it not a trade would need a fourth slot and copy nobody has written.
--
-- ── Scope ───────────────────────────────────────────────────────────────────────────────────
--
-- `create or replace` on the same signature, never drop + create: 20260823103624 revoked EXECUTE
-- from public/anon/authenticated and a drop/create pair would re-inherit the pg_default_acl 'f'
-- row, reddening 0130's tests 2-3 and 0121's «anon executes only events_nearby + the three
-- search/ballot helpers». The cron entry, the marker table, the slot CHECK, the templates and
-- every i18n key are untouched; no edge function changes, so nothing is redeployed. 0130 gains
-- the fixture that reproduces this (E7's organiser, going, 40m out) plus the rule it should have
-- been asserting all along — that no (event, member) claims two slots on one tick.

create or replace function public.event_reminder_sweep() returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Named once so the windows and the guard band read as one decision.
  c_t24_lead    constant interval := interval '24 hours';
  c_t1_lead     constant interval := interval '1 hour';
  -- t24 floor for anyone who ALSO has an hour-out slot — an online attendee (t1) or an organiser
  -- (org_t1). The t1 lead plus a 2h guard band, so no member's two slots for one event can land
  -- within two hours of each other. Was `c_online_floor` until #617: online was a proxy for
  -- "has a second slot", and org_t1 broke the proxy.
  c_guard_floor constant interval := interval '3 hours';
  v_due record;
begin
  -- Retention first and unconditionally — a marker is meaningless once its event is long past,
  -- and the FK already drops it when the event is deleted (20260823110358 §2).
  delete from athanor.event_reminder_sends where sent_at < now() - interval '30 days';

  -- fan-out unconfigured → remind nobody rather than mark everybody reminded
  if coalesce(athanor.runtime_setting('notification_fanout_url'), '') = ''
     or coalesce(athanor.runtime_setting('notification_fanout_key'), '') = '' then
    return;
  end if;

  for v_due in
    with due as (
      select e.id as event_id, rs.user_id, s.slot
        from public.events e
        join public.rsvps rs on rs.event_id = e.id and rs.status = 'going'
        cross join lateral (values
            -- t24: every event. Floored at the guard band for members who also have an hour-out
            -- slot — online attendees (t1, 20260823110358 §1) and organisers (org_t1, #617).
            -- A physical event's ordinary attendee has no second slot and keeps the zero floor.
            ('t24'::text, c_t24_lead,
             case when e.is_online or rs.user_id = e.organizer_id
                  then c_guard_floor else interval '0' end, true),
            -- t1: online only, and never the organiser — they get org_t1 at the same hour.
            ('t1'::text,  c_t1_lead, interval '0', e.is_online and rs.user_id <> e.organizer_id)
          ) as s(slot, lead_hi, lead_lo, applies)
       where e.deleted_at is null
         and s.applies
         and e.starts_at >  now() + s.lead_lo
         and e.starts_at <= now() + s.lead_hi
    ),
    -- org_t1: the organiser of every live event an hour out, RSVP or no RSVP (#522). No join to
    -- rsvps — an event with nobody going still has to be opened.
    due_org as (
      select e.id as event_id, e.organizer_id as user_id, 'org_t1'::text as slot
        from public.events e
       where e.deleted_at is null
         and e.starts_at >  now()
         and e.starts_at <= now() + c_t1_lead
    ),
    due_all as (
      select event_id, user_id, slot from due
      union all
      select event_id, user_id, slot from due_org
    ),
    -- Claim and select in one statement: a concurrent tick either inserts the marker or is
    -- skipped by the conflict, and only the winner gets a row back to notify on.
    claimed as (
      insert into athanor.event_reminder_sends (event_id, user_id, slot)
      select event_id, user_id, slot from due_all
      on conflict (event_id, user_id, slot) do nothing
      returning event_id, user_id, slot
    )
    select c.user_id,
           c.event_id,
           c.slot,
           e.title,
           -- the count at SEND time, not at claim time — «N partecipano» has to be current, and
           -- since #522 these rows include the event's paid ticket holders.
           (select count(*) from public.rsvps g
             where g.event_id = c.event_id and g.status = 'going') as going_count
      from claimed c
      join public.events e on e.id = c.event_id
  loop
    perform athanor.enqueue_notification(
      v_due.user_id,
      'eventReminder',
      -- Written as explicit slot tests with a neutral ELSE (20260825085916): a fourth slot, if
      -- one ever lands, gets «è tra poco» by default rather than silently claiming to be an
      -- hour away or addressing an attendee as the organiser.
      case v_due.slot
        when 't1'     then 'notif.tpl.eventReminderSoon'
        when 'org_t1' then 'notif.tpl.eventReminderOrganizer'
        else 'notif.tpl.eventReminder'
      end,
      jsonb_build_object('title', v_due.title, 'count', v_due.going_count),
      jsonb_build_object('kind', 'event', 'id', v_due.event_id::text)
    );
  end loop;
end;
$$;

comment on function public.event_reminder_sweep() is
  'Event reminders (#126, slot copy #523, organiser slot #522, organiser floor #617): enqueues '
  'one reminder per going RSVP — 24h before starts_at for every event (notif.tpl.eventReminder) '
  'and 1h before for online ones (notif.tpl.eventReminderSoon, organiser excluded) — plus one '
  'org_t1 for every event''s organiser 1h out (notif.tpl.eventReminderOrganizer), once per '
  '(event, user, slot) via athanor.event_reminder_sends. t24 is floored at 3h for anyone who '
  'also has an hour-out slot — online attendees and organisers, room or stream — so no member''s '
  'two slots for one event land within 2h of each other; a physical event''s ordinary attendee '
  'has no second slot and is reminded right down to starts_at. Cron-only (postgres ctx). Prunes '
  '30-day-old markers on every tick; claims nothing while fan-out is unconfigured, so no marker '
  'is burned undelivered.';
