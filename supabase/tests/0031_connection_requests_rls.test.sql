begin;
select plan(14);

-- fixtures: three profiles (handle_new_user normally seeds profiles; insert directly for the test DB)
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

select has_table('public', 'connection_requests', 'connection_requests exists');
select ok((select relrowsecurity from pg_class where oid = 'public.connection_requests'::regclass),
  'RLS enabled on connection_requests');
-- accept/decline is a SECURITY DEFINER RPC (respond_to_connection), not a client UPDATE,
-- so there is deliberately no update policy here.
select policies_are('public', 'connection_requests', array[
  'connection_requests_select_party',
  'connection_requests_insert_own',
  'connection_requests_delete_own_pending',
        'active_write_insert', 'active_write_update', 'active_write_delete'], 'select / insert / delete client policies only');

-- anon cannot read (no grant → 42501)
set local role anon;
select throws_ok(
  $$ select count(*) from public.connection_requests $$,
  '42501', null, 'anon cannot read connection_requests');
reset role;

-- alice sends a pending request to bob
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.connection_requests (requester_id, addressee_id)
     values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') $$,
  'requester sends a pending connection request');
select set_config('test.req', (select id::text from public.connection_requests
  where requester_id='11111111-1111-1111-1111-111111111111'
    and addressee_id='22222222-2222-2222-2222-222222222222'), true);

-- alice cannot forge a request on someone else's behalf (WITH CHECK → 42501)
select throws_ok(
  $$ insert into public.connection_requests (requester_id, addressee_id)
     values ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333') $$,
  '42501', null, 'requester cannot forge requester_id');

-- alice (the requester) cannot accept her own request: she is not the addressee, so the
-- RPC matches no pending row → P0002 (no_data_found).
select throws_ok(
  $$ select public.respond_to_connection(current_setting('test.req')::uuid, true) $$,
  'P0002', null, 'requester cannot accept her own request');
reset role;

-- bob (the addressee) accepts via the RPC
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select public.respond_to_connection(current_setting('test.req')::uuid, true) $$,
  'addressee accepts via respond_to_connection');
-- a second response fails: the row is no longer pending → P0002
select throws_ok(
  $$ select public.respond_to_connection(current_setting('test.req')::uuid, false) $$,
  'P0002', null, 'cannot respond to an already-accepted request');
-- the accepted request drops out of the addressee's view (pending-only select)
select is(
  (select count(*)::int from public.connection_requests where id = current_setting('test.req')::uuid),
  0, 'accepted request is no longer visible (pending-only)');
reset role;

-- accept projected a connection row + opened a direct conversation (no ice-breakers)
select is(
  (select count(*)::int from public.connections
     where profile_a='11111111-1111-1111-1111-111111111111' and profile_b='22222222-2222-2222-2222-222222222222'),
  1, 'accept created the connection');
select is(
  (select count(*)::int from public.conversations
     where participant_a='11111111-1111-1111-1111-111111111111' and participant_b='22222222-2222-2222-2222-222222222222'
       and created_from='direct'),
  1, 'accept opened a direct conversation');

-- decline does not leak: cara declines a fresh request → the requester sees absence,
-- indistinguishable from a withdrawal (Inv 7).
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.connection_requests (requester_id, addressee_id)
  values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');
select set_config('test.req2', (select id::text from public.connection_requests
  where requester_id='11111111-1111-1111-1111-111111111111'
    and addressee_id='33333333-3333-3333-3333-333333333333'), true);
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.respond_to_connection(current_setting('test.req2')::uuid, false) $$,
  'addressee declines via respond_to_connection');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.connection_requests where id = current_setting('test.req2')::uuid),
  0, 'declined request is invisible to the requester (decline = withdrawal)');
reset role;

select * from finish();
rollback;
