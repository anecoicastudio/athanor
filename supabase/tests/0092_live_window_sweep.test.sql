-- live_window_sweep (#120) — the writer the Live tab was missing. Asserts the sweep
-- opens the window at starts_at, closes it at ends_at / the 4h fallback / soft-delete,
-- mirrors event_live_stats.is_live, fills nulls only (idempotent), and stays cron-only.
begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- one organizer; handle_new_user trigger auto-creates the profile
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','organizer@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- the function exists, and clients cannot call it (cron-only, postgres ctx)
select has_function('public', 'live_window_sweep', array[]::text[], 'live_window_sweep() exists');
select ok(not has_function_privilege('anon', 'public.live_window_sweep()', 'execute'),
  'anon cannot execute the sweep');
select ok(not has_function_privilege('authenticated', 'public.live_window_sweep()', 'execute'),
  'authenticated cannot execute the sweep');

-- listener_count is gone — the count is Realtime presence, not a column (#120)
select hasnt_column('public', 'event_live_stats', 'listener_count',
  'listener_count dropped: counted via presence client-side, never persisted');

-- the sweep is scheduled every minute
select results_eq(
  $$ select schedule from cron.job where jobname = 'live-window-sweep' $$,
  $$ values ('* * * * *') $$,
  'live-window-sweep runs every minute');

-- fixtures (superuser: events writes are organizer-scoped, live_* presets are the
-- sweep's own past output; stats rows are service-role territory)
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, ends_at) values
  -- in window: started 10 min ago, ends in 1h → sweep must open it
  ('e0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'In finestra','formazione',true,'https://stream.athanor.test/1', now() - interval '10 minutes', now() + interval '1 hour'),
  -- open-ended and past the 4h fallback cap → sweep must NOT open it
  ('e0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'Cappello 4h','formazione',true,'https://stream.athanor.test/2', now() - interval '5 hours', null);

insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, ends_at, live_started_at) values
  -- live but past ends_at → sweep must close it
  ('e0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'Da chiudere','formazione',true,'https://stream.athanor.test/3', now() - interval '2 hours', now() - interval '10 minutes', now() - interval '2 hours');

insert into public.events (id, organizer_id, title, category, is_online, venue, city, geo, starts_at) values
  -- physical event inside its hour → never swept live (online-only feature)
  ('e0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
   'Dal vivo','musica',false,'Teatro','Milano', extensions.st_point(9.19, 45.46)::extensions.geography, now() - interval '10 minutes');

insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, ends_at, live_started_at, deleted_at) values
  -- soft-deleted mid-live → sweep must close it even though ends_at is future
  ('e0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
   'Cancellato in diretta','formazione',true,'https://stream.athanor.test/5', now() - interval '1 hour', now() + interval '1 hour', now() - interval '1 hour', now());

insert into public.event_live_stats (event_id, is_live) values
  ('e0000000-0000-0000-0000-000000000003', true),
  ('e0000000-0000-0000-0000-000000000005', true);

select public.live_window_sweep();

-- in-window event opened, and its stats row was created live
select ok((select live_started_at is not null and live_ended_at is null
           from public.events where id = 'e0000000-0000-0000-0000-000000000001'),
  'in-window online event went live');
select results_eq(
  $$ select is_live from public.event_live_stats where event_id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values (true) $$,
  'sweep created the stats row live');

-- open-ended event past the 4h cap never opened
select ok((select live_started_at is null
           from public.events where id = 'e0000000-0000-0000-0000-000000000002'),
  'open-ended event past the 4h fallback cap stays not-live');

-- past-ends_at live event closed, stats mirrored
select ok((select live_ended_at is not null
           from public.events where id = 'e0000000-0000-0000-0000-000000000003'),
  'live event past ends_at was closed');
select results_eq(
  $$ select is_live from public.event_live_stats where event_id = 'e0000000-0000-0000-0000-000000000003' $$,
  $$ values (false) $$,
  'closing the window flips the stats row off');

-- physical event untouched
select ok((select live_started_at is null
           from public.events where id = 'e0000000-0000-0000-0000-000000000004'),
  'physical event is never swept live');

-- soft-deleted mid-live closed, stats mirrored
select ok((select live_ended_at is not null
           from public.events where id = 'e0000000-0000-0000-0000-000000000005'),
  'soft-deleted mid-live event was closed');
select results_eq(
  $$ select is_live from public.event_live_stats where event_id = 'e0000000-0000-0000-0000-000000000005' $$,
  $$ values (false) $$,
  'soft-delete mid-live flips the stats row off');

-- idempotent: a second run fills nothing twice (live_started_at is not overwritten)
create temp table _first_open as
  select live_started_at from public.events where id = 'e0000000-0000-0000-0000-000000000001';
select public.live_window_sweep();
select is(
  (select live_started_at from public.events where id = 'e0000000-0000-0000-0000-000000000001'),
  (select live_started_at from _first_open),
  'second sweep leaves an opened window untouched');

select * from finish();
rollback;
