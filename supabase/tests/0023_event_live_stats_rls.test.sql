begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- one organizer; handle_new_user trigger auto-creates the profile
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','organizer@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- schema shape
select has_table('public','event_live_stats','event_live_stats table exists');
select ok((select relrowsecurity from pg_class where oid='public.event_live_stats'::regclass),
  'RLS enabled on event_live_stats');
select policies_are('public','event_live_stats',
  array['event_live_stats_select_published'],
  'exactly the expected (published-only read, no client-write) policy (#137)');

-- organizer's online event; the live-stats row is seeded below as superuser (service-role analog).
-- Seeded as service_role, not as the organiser: since #446 the client's INSERT grant on
-- events is column-scoped to the columns create_event writes, and `id` is not one of them.
-- This fixture wants a deterministic id to reference below, not an ownership check —
-- 0020_events_rls asserts an organiser's own INSERT.
set local role service_role;
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
          'Respiro & Strategia','formazione',true,'https://stream.athanor.test/x', now());
reset role;
insert into public.event_live_stats (event_id, is_live)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);

-- a soft-deleted (unpublished) event with a stats row: its stats must be invisible (#137).
-- The policy's predicate is the assertion target — the original test checked only the
-- policy NAME, which is how a world-readable `using (true)` passed for a year.
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, deleted_at)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd','11111111-1111-1111-1111-111111111111',
          'Cancellato','formazione',true,'https://stream.athanor.test/gone', now(), now());
insert into public.event_live_stats (event_id, is_live)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', true);

-- authenticated can read the live flag (public read; listener_count is presence, not a column — #120)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq($$
  select is_live from public.event_live_stats
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, $$ values (true) $$, 'authenticated can read the live flag');

-- authenticated client INSERT denied (no grant / no policy) → 42501
select throws_ok($$
  insert into public.event_live_stats (event_id, is_live)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true)
$$, '42501', null, 'authenticated client cannot insert live stats');

-- authenticated client UPDATE denied (no grant / no policy) → 42501
select throws_ok($$
  update public.event_live_stats set is_live = false
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, '42501', null, 'authenticated client cannot update the live flag');

-- authenticated client DELETE denied (no grant / no policy) → 42501
select throws_ok($$
  delete from public.event_live_stats
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, '42501', null, 'authenticated client cannot delete live stats');

-- published-only: the soft-deleted event's stats row does not exist for this role
select results_eq($$
  select count(*)::int from public.event_live_stats
  where event_id='dddddddd-dddd-dddd-dddd-dddddddddddd'
$$, $$ values (0) $$, 'authenticated cannot read a soft-deleted event''s live stats (#137)');
reset role;

-- anon can read (public read), still cannot write
set local role anon; set local request.jwt.claims = '';
select results_eq($$
  select count(*)::int from public.event_live_stats
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, $$ values (1) $$, 'anon can read live stats (public)');
select results_eq($$
  select count(*)::int from public.event_live_stats
  where event_id='dddddddd-dddd-dddd-dddd-dddddddddddd'
$$, $$ values (0) $$, 'anon cannot read a soft-deleted event''s live stats (#137)');

-- table is published for realtime
select ok(
  exists(select 1 from pg_publication_tables
         where pubname='supabase_realtime' and schemaname='public' and tablename='event_live_stats'),
  'event_live_stats is in the supabase_realtime publication');

select * from finish();
rollback;
