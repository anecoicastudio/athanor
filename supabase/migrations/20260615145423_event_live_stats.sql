-- event_live_stats: live-listener counter for online events.
-- Service-role/Realtime maintained; public read for published events; NEVER client-written.
-- Backs the Online panel «{n} in ascolto» live count + the event:{id}:live channel (backend 04 §2.6, 09 C8).

create table public.event_live_stats (
  event_id       uuid primary key references public.events (id) on delete cascade,
  listener_count int not null default 0 check (listener_count >= 0),
  is_live        boolean not null default false,
  updated_at     timestamptz not null default now()
);

comment on table public.event_live_stats is 'Live-listener counter for online events. Service-role/Realtime maintained; public read for published events. Never client-written.';

create trigger event_live_stats_touch_updated_at
  before update on public.event_live_stats
  for each row execute function public.touch_updated_at();

-- public read (mirrors events public read); NO client write — service role only
grant select on table public.event_live_stats to anon, authenticated;
grant all on table public.event_live_stats to service_role;

alter table public.event_live_stats enable row level security;

create policy "event_live_stats_select_all"
  on public.event_live_stats for select
  to anon, authenticated
  using (true);
-- no insert/update/delete policy: written only by service role (Realtime presence rollup / live edge fn)

-- Realtime (backend 09 §8 M4): stream listener_count/is_live + events live-flag flips
alter publication supabase_realtime add table public.event_live_stats;
alter publication supabase_realtime add table public.events;
