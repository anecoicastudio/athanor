begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','user_a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','user_b@test.athanor','{"locale":"en"}'::jsonb, now(), now());

select has_table('public','events','events table exists');
select ok((select relrowsecurity from pg_class where oid='public.events'::regclass), 'RLS enabled on events');
select policies_are('public','events',
  array['events_select_anon','events_select_authenticated','events_insert_own','events_update_own'],
  'exactly the expected policies on events');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at)
  values ('11111111-1111-1111-1111-111111111111','Notte delle Idee','networking',false,'Spazio X',
          extensions.st_point(13.405, 52.52)::extensions.geography, now() + interval '7 days')
$$, 'organizer can create own event');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, venue, geo, starts_at)
  values ('11111111-1111-1111-1111-111111111111','Forgery','business',false,'X',
          extensions.st_point(0,0)::extensions.geography, now() + interval '1 day')
$$, '42501', null, 'cannot create event for another organizer');

update public.events set title = 'hijacked'
  where organizer_id = '11111111-1111-1111-1111-111111111111';
select results_eq($$ select count(*)::int from public.events where title='hijacked' $$,
  $$ values (0) $$, 'cross-user update affects zero rows');
reset role;

set local role anon; set local request.jwt.claims = '';
select results_eq($$ select count(*)::int from public.events where title='Notte delle Idee' $$,
  $$ values (1) $$, 'anon can read published events');
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, geo, starts_at)
  values ('11111111-1111-1111-1111-111111111111','x','arte',false,
          extensions.st_point(0,0)::extensions.geography, now() + interval '1 day')
$$, '42501', null, 'anon cannot insert events');
reset role;

select results_eq(
  $$ select count(*)::int from public.events_nearby(52.52, 13.405, 5000) $$,
  $$ values (1) $$, 'ST_DWithin finds event within 5km');
select results_eq(
  $$ select count(*)::int from public.events_nearby(40.0, -3.7, 5000) $$,
  $$ values (0) $$, 'event outside radius excluded');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$
  insert into public.events (organizer_id, title, category, is_online, starts_at)
  values ('11111111-1111-1111-1111-111111111111','bad online','musica',true, now() + interval '1 day')
$$, '23514', null, 'online event requires stream_url');

select lives_ok($$
  select public.create_event('Tavola dei Fondatori','business',false, now() + interval '10 days',
    'Spazio Y','Berlino', 52.50, 13.40)
$$, 'create_event builds a physical event for the caller');
reset role;

select * from finish();
rollback;
