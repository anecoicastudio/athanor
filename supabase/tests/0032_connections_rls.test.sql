begin;
select plan(8);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'c@test.dev')
on conflict do nothing;
insert into public.profiles (id, handle) values
  ('11111111-1111-1111-1111-111111111111', 'alice'),
  ('22222222-2222-2222-2222-222222222222', 'bob'),
  ('33333333-3333-3333-3333-333333333333', 'cara')
on conflict do nothing;

select has_table('public', 'connections', 'connections exists');
select ok((select relrowsecurity from pg_class where oid = 'public.connections'::regclass),
  'RLS enabled on connections');
select policies_are('public', 'connections', array['connections_select_participant'],
  'only a participant-select policy (writes are trigger-only, server-side)');

-- server establishes a connection (canonical order profile_a < profile_b)
set local role service_role;
insert into public.connections (profile_a, profile_b)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
reset role;

-- a participant reads their own connection
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.connections
     where profile_a='11111111-1111-1111-1111-111111111111' and profile_b='22222222-2222-2222-2222-222222222222'),
  1, 'participant reads own connection');

-- a non-participant reads nothing (no public enumeration, rule #3)
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.connections
     where profile_a='11111111-1111-1111-1111-111111111111' and profile_b='22222222-2222-2222-2222-222222222222'),
  0, 'non-participant cannot read the connection');

-- clients can never write connections (no grant → 42501); only the accept trigger writes them
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into public.connections (profile_a, profile_b)
     values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333') $$,
  '42501', null, 'client cannot insert a connection');
select throws_ok(
  $$ update public.connections set created_at = now()
     where profile_a='11111111-1111-1111-1111-111111111111' and profile_b='22222222-2222-2222-2222-222222222222' $$,
  '42501', null, 'client cannot update a connection');
select throws_ok(
  $$ delete from public.connections
     where profile_a='11111111-1111-1111-1111-111111111111' and profile_b='22222222-2222-2222-2222-222222222222' $$,
  '42501', null, 'client cannot delete a connection');
reset role;

select * from finish();
rollback;
