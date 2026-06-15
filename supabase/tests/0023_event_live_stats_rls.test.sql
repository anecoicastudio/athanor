begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

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
  array['event_live_stats_select_all'],
  'exactly the expected (read-only, no client-write) policy');

-- organizer creates an online event; seed a live-stats row as superuser (service-role analog)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
          'Respiro & Strategia','formazione',true,'https://stream.athanor.test/x', now());
reset role;
insert into public.event_live_stats (event_id, listener_count, is_live)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 142, true);

-- authenticated can read the count (public read)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq($$
  select listener_count from public.event_live_stats
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, $$ values (142) $$, 'authenticated can read the listener count');

-- authenticated client INSERT denied (no grant / no policy) → 42501
select throws_ok($$
  insert into public.event_live_stats (event_id, listener_count, is_live)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 999, true)
$$, '42501', null, 'authenticated client cannot insert live stats');

-- authenticated client UPDATE denied (no grant / no policy) → 42501
select throws_ok($$
  update public.event_live_stats set listener_count = 0
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, '42501', null, 'authenticated client cannot update the listener count');

-- authenticated client DELETE denied (no grant / no policy) → 42501
select throws_ok($$
  delete from public.event_live_stats
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, '42501', null, 'authenticated client cannot delete live stats');
reset role;

-- anon can read (public read), still cannot write
set local role anon; set local request.jwt.claims = '';
select results_eq($$
  select count(*)::int from public.event_live_stats
  where event_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, $$ values (1) $$, 'anon can read live stats (public)');

-- table is published for realtime
select ok(
  exists(select 1 from pg_publication_tables
         where pubname='supabase_realtime' and schemaname='public' and tablename='event_live_stats'),
  'event_live_stats is in the supabase_realtime publication');

select * from finish();
rollback;
