-- Live window sweep — the missing writer for Athanor Live's live state (#120).
--
-- Until now NOTHING wrote events.live_started_at / live_ended_at or
-- event_live_stats.is_live: the Live tab's «Online» panel filtered on columns that
-- only ever held their defaults, so no event could ever appear live. This migration
-- makes live-ness schedule-derived: a pg_cron sweep (every minute, postgres ctx —
-- cron bypasses RLS by design, same as prune-expired-story-segments) opens the live
-- window when a published online event reaches starts_at and closes it at ends_at
-- (or a fallback cap for open-ended events, or on soft-delete mid-live).
--
-- listener_count is DROPPED, not written: the count moved to Supabase Realtime
-- presence on the shared `event:{id}:presence` channel, counted client-side
-- (packages/api subscribeEventPresence). Presence needs no polling, no writer and
-- no table — persisting it here would have meant a heartbeat edge function writing
-- every few seconds per listener. The table keeps is_live as the realtime-streamed
-- signal (`event:{id}:live` postgres_changes reads stay unchanged).
--
-- The sweep only ever FILLS null live_* columns — a manually set window (organiser
-- tooling, later milestone) is respected, never overwritten.

-- Open-ended events (ends_at is null) stay live at most this long after starts_at.
-- Mirrors the create-form's guidance that ends_at is optional; without a cap an
-- open-ended event would be "live" forever.
create function public.live_window_sweep() returns void
language sql
security invoker
set search_path = ''
as $$
  with started as (
    update public.events e
       set live_started_at = now()
     where e.is_online
       and e.deleted_at is null
       and e.live_started_at is null
       and e.starts_at <= now()
       and coalesce(e.ends_at, e.starts_at + interval '4 hours') > now()
    returning e.id
  ),
  stats_up as (
    insert into public.event_live_stats (event_id, is_live)
    select id, true from started
    on conflict (event_id) do update set is_live = true
  ),
  ended as (
    update public.events e
       set live_ended_at = now()
     where e.live_started_at is not null
       and e.live_ended_at is null
       and (
         coalesce(e.ends_at, e.starts_at + interval '4 hours') <= now()
         or e.deleted_at is not null
       )
    returning e.id
  )
  update public.event_live_stats s
     set is_live = false
    from ended
   where s.event_id = ended.id;
$$;

comment on function public.live_window_sweep() is
  'Schedule-derived live window (#120): opens/closes events.live_started_at/live_ended_at and mirrors event_live_stats.is_live. Cron-only (postgres ctx); fills nulls, never overwrites. 4h fallback cap when ends_at is null.';

-- cron-only: not a client API
revoke execute on function public.live_window_sweep() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'live-window-sweep',
  '* * * * *',
  $$ select public.live_window_sweep() $$
);

-- listener_count: superseded by client-side Realtime presence (see header).
-- The 0-forever column the Live tab used to render (#120).
alter table public.event_live_stats drop column listener_count;

comment on table public.event_live_stats is
  'Live flag for online events, mirrored from events.live_* by live_window_sweep() (cron). Public read; never client-written. Listener count is Realtime presence, not a column.';
