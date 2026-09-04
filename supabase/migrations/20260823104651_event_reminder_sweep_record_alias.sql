-- Fix event_reminder_sweep: the loop variable shadowed the rsvps alias (#126).
--
-- 20260823103624 shipped the sweep with `declare r record` and a query that also aliased
-- `public.rsvps r`. Inside a PL/pgSQL query, a qualified reference resolves against the
-- DECLARED VARIABLES before the FROM list, so `r.user_id` was read as a field of the
-- not-yet-assigned record rather than as the RSVP's column, and every run of the sweep died
-- with:
--
--   ERROR 55000: record "r" is not assigned yet
--   DETAIL: The tuple structure of a not-yet-assigned record is indeterminate.
--
-- Note what this is NOT: plpgsql.variable_conflict does not catch it. That setting governs
-- UNQUALIFIED column references; a qualified `r.user_id` is unambiguous to the parser — it
-- simply resolves to the wrong `r` — so the default `error` mode reports nothing at compile
-- time and the failure only appears when the function first runs against matching rows.
--
-- The design is unchanged and 20260823103624's header still describes it accurately; only
-- the two names move. `r` becomes `v_due` (the loop variable) and the RSVP alias becomes
-- `rs`, so no alias in the statement can ever collide with a declared name again.
--
-- Fixed by replacement rather than by editing 20260823103624, which was already applied to
-- staging when this surfaced (rule 7: migrations are append-only once applied).

create or replace function public.event_reminder_sweep() returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_due record;
begin
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
      v_due.user_id,
      'eventReminder',
      'notif.tpl.eventReminder',
      jsonb_build_object('title', v_due.title, 'count', v_due.going_count),
      jsonb_build_object('kind', 'event', 'id', v_due.event_id::text)
    );
  end loop;

  -- Retention: a marker is meaningless once its event is long past, and the FK already drops
  -- it when the event is deleted.
  delete from athanor.event_reminder_sends where sent_at < now() - interval '30 days';
end;
$$;
