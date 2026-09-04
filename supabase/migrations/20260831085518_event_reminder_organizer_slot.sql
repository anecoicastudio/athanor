-- event_reminder_sweep: the organiser gets their own reminder (#522).
--
-- #126 reminds attendees and nobody else. The one person who cannot be late to an event —
-- the person who opens the door or starts the stream — is reminded only if they happened to
-- RSVP to their own event, and on the paid path they cannot: `create-ticket-checkout` 403s the
-- organiser. Marco's ruling on #522 (2026-08-30) is option 3: an independent slot with its own
-- copy, «Il tuo evento comincia tra un'ora».
--
-- Replaced rather than edited: 20260825085916 is applied to staging and migrations are
-- append-only (rule 7). This is `create or replace` on the same signature — the cron entry, the
-- marker table and the retention are untouched.
--
-- ── One slot, at the hour ────────────────────────────────────────────────────────────────────
--
-- `org_t1`, for EVERY published event, online and physical alike. The attendee `t1` is scoped to
-- online events because an hour is useless to somebody who still has to travel; that argument
-- does not transfer. The organiser is not deciding whether to come — they are the event — so an
-- hour out is not a planning prompt but a readiness one, and it is as true of a room as of a
-- stream. The ruled copy says the hour, so the slot is the hour.
--
-- No `org_t24`. The ruling names one slot and one sentence; a second organiser slot would be
-- copy nobody wrote. An organiser who wants the day-out reminder can RSVP to their own free
-- event and receive `t24` as an attendee, which still works — see the exclusion below.
--
-- ── Why `t1` now excludes the organiser ──────────────────────────────────────────────────────
--
-- `RsvpBar` renders for every free event with no `isOrganizer` gate, so an organiser CAN self-
-- RSVP to their own free online event — and such an event 30 minutes out satisfies the attendee
-- `t1` window and the new `org_t1` window on the same tick. The marker PK is
-- (event_id, user_id, slot), so the two slots do not collide there; they collide in the
-- notification tray, as two reminders about the same event seconds apart. That is precisely the
-- «Hai una nuova notifica» noise 20260823110358's guard band exists to prevent, arriving by a
-- different door.
--
-- So the organiser is dropped from the attendee `t1` arm on their OWN event and gets `org_t1`
-- instead: the same moment, the same hour, in the voice that fits. `t24` is untouched — it fires
-- a day earlier, cannot collide, and «{count} partecipano» is genuinely useful to an organiser.
-- The exclusion is written into `applies` rather than the WHERE clause so it reads beside the
-- `is_online` scope it qualifies.
--
-- ── Surfaces that move with this ─────────────────────────────────────────────────────────────
--
-- `notif.tpl.eventReminderOrganizer` joins both i18n catalogs (parity test), `packages/schemas`'
-- NOTIFICATION_TEMPLATE_KEYS — a closed list where an unknown key degrades to
-- `notif.tpl.generic` (#113), so omitting it would render every organiser reminder as «C'è
-- qualcosa di nuovo per te.» — and `supabase/functions/_shared/notif-templates.ts`, the push
-- mirror imported by **push-dispatch**, which this migration therefore obliges a redeploy of.
--
-- The notification TYPE stays `eventReminder`: the glyph, the lead key and the route arm all
-- exist for it, and `notifications.type` / `notification_preferences.type` both carry CHECK
-- constraints, so a new type would cost a migration and a PREF_ROWS entry for no behaviour a
-- member can see. The price is real and worth stating: the organiser reminder rides
-- `notif.prefs.events`, so an organiser who muted event reminders as an attendee mutes their own
-- too. Muting reminders and then expecting one is coherent; two toggles for one glyph is not.
--
-- No aura path (rule 1): reminding somebody is worth zero points, and 0130 (E) asserts it.

alter table athanor.event_reminder_sends
  drop constraint event_reminder_sends_slot_check,
  add constraint event_reminder_sends_slot_check check (slot in ('t24', 't1', 'org_t1'));

create or replace function public.event_reminder_sweep() returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Named once so the windows and the guard band read as one decision.
  c_t24_lead     constant interval := interval '24 hours';
  c_t1_lead      constant interval := interval '1 hour';
  -- t24 floor for ONLINE events: the t1 lead plus a 2h guard band, so the two attendee slots can
  -- never land within two hours of each other for the same attendee.
  c_online_floor constant interval := interval '3 hours';
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
            -- t24: every event. For online events the floor is the guard band, not the t1
            -- lead — see 20260823110358 §1.
            ('t24'::text, c_t24_lead,
             case when e.is_online then c_online_floor else interval '0' end, true),
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
  'Event reminders (#126, slot copy #523, organiser slot #522): enqueues one reminder per going '
  'RSVP — 24h before starts_at for every event (notif.tpl.eventReminder) and 1h before for '
  'online ones (notif.tpl.eventReminderSoon, organiser excluded) — plus one org_t1 for every '
  'event''s organiser 1h out (notif.tpl.eventReminderOrganizer), once per (event, user, slot) '
  'via athanor.event_reminder_sends. Online t24 is floored at 3h so the two attendee slots are '
  '>=2h apart. Cron-only (postgres ctx). Prunes 30-day-old markers on every tick; claims nothing '
  'while fan-out is unconfigured, so no marker is burned undelivered.';
