-- event_reminder_sweep: the t1 slot gets its own copy (#523).
--
-- #126 sends two reminders — t24 for every event, t1 for online ones — and both rendered
-- `notif.tpl.eventReminder`: «"{title}" è tra poco. {count} partecipano.» That sentence is
-- true an hour out and false a day out, so the t24 reminder announced «è tra poco» a full
-- day early, and then the online t1 said the same words again an hour before the start.
-- 20260823110358's guard band keeps the two from landing within two hours of each other; it
-- was never going to make them say different things.
--
-- Replaced rather than edited: 20260823110358 is applied to staging and migrations are
-- append-only (rule 7). This is `create or replace` on the same signature — the cron entry,
-- the marker table and the retention are all untouched.
--
-- ── What changes ───────────────────────────────────────────────────────────────────────────
--
-- The `claimed` CTE already returned `slot`; the outer select dropped it. It now projects
-- `c.slot`, and the loop picks the template key from it:
--
--   t24 → notif.tpl.eventReminder      «è tra poco»          (unchanged, and still the default)
--   t1  → notif.tpl.eventReminderSoon  «comincia tra un'ora»
--
-- ── Why the slot is NOT written into params ────────────────────────────────────────────────
--
-- #523's scope offered a `slot` param alongside the second key. The template key already
-- carries the slot — it IS the per-slot fact, and it is the field every renderer reads — so a
-- param would be a second copy of the same state with no reader, which is the defect #534 is
-- open about one table over. If something later needs the slot as data rather than as copy,
-- it can be added then, with the reader that wants it.
--
-- ── Surfaces that had to move with this ────────────────────────────────────────────────────
--
-- `notif.tpl.eventReminderSoon` is now in both i18n catalogs (parity test), in
-- `packages/schemas`' NOTIFICATION_TEMPLATE_KEYS — a closed list where an unknown key degrades
-- to `notif.tpl.generic` (#113), so omitting it would have rendered every t1 row as «C'è
-- qualcosa di nuovo per te.», worse than the bug being fixed — and in
-- `supabase/functions/_shared/notif-templates.ts`, the push mirror. That mirror is imported by
-- **push-dispatch**, not by notification-fan-out (which treats template_key as an opaque
-- string), so push-dispatch is the function this migration obliges a redeploy of.
--
-- No aura path (rule 1): reminding somebody is worth zero points, and 0130 (E) asserts it.

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
      select e.id as event_id, rs.user_id, s.slot, e.title
        from public.events e
        join public.rsvps rs on rs.event_id = e.id and rs.status = 'going'
        cross join lateral (values
            -- t24: every event. For online events the floor is the guard band, not the t1
            -- lead — see 20260823110358 §1.
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
           c.slot,
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
      -- The only slot-dependent thing in the payload. Written as an explicit t1 test rather
      -- than a case over both slots so a third slot, if one ever lands, gets the neutral copy
      -- by default instead of silently rendering «comincia tra un'ora».
      case when v_due.slot = 't1'
           then 'notif.tpl.eventReminderSoon'
           else 'notif.tpl.eventReminder' end,
      jsonb_build_object('title', v_due.title, 'count', v_due.going_count),
      jsonb_build_object('kind', 'event', 'id', v_due.event_id::text)
    );
  end loop;
end;
$$;

comment on function public.event_reminder_sweep() is
  'Event reminders (#126, slot copy #523): enqueues one reminder per going RSVP, 24h before '
  'starts_at for every event (notif.tpl.eventReminder) and 1h before for online ones '
  '(notif.tpl.eventReminderSoon), once per (event, attendee, slot) via '
  'athanor.event_reminder_sends. Online t24 is floored at 3h so the two slots are >=2h apart. '
  'Cron-only (postgres ctx). Prunes 30-day-old markers on every tick; claims nothing while '
  'fan-out is unconfigured, so no marker is burned undelivered.';
