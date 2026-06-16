begin;
select plan(11);

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

select has_table('public', 'conversations', 'conversations exists');
select ok((select relrowsecurity from pg_class where oid = 'public.conversations'::regclass),
  'RLS enabled on conversations');
select policies_are('public', 'conversations',
  array['conversations_select_participant', 'conversations_update_participant'],
  'only select + update policies (no client insert/delete)');

-- server creates a momento pair (canonicalizes order, injects ice-breakers)
set local role service_role;
select public.create_conversation_pair(
  '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'momento') as conv \gset
reset role;

-- participant reads own
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.conversations where id = (select :'conv')::uuid $$,
  $$ values (1) $$, 'participant reads own conversation');

-- non-participant reads 0
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.conversations where id = (select :'conv')::uuid $$,
  $$ values (0) $$, 'non-participant cannot read the conversation');

-- client cannot INSERT (no grant → 42501)
select throws_ok(
  $$ insert into public.conversations (participant_a, participant_b)
     values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'client cannot insert a conversation');

-- create_conversation_pair not executable by authenticated (revoked → 42501)
select throws_ok(
  $$ select public.create_conversation_pair(
       '11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','direct') $$,
  '42501', null, 'create_conversation_pair is internal-only');

-- get_or_create_conversation works for the caller (direct → no ice-breakers)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select isnt(
  (select public.get_or_create_conversation('33333333-3333-3333-3333-333333333333')), null,
  'get_or_create_conversation returns a conversation id');

-- idempotent: the same pair returns the same id
select results_eq(
  $$ select public.get_or_create_conversation('33333333-3333-3333-3333-333333333333')
     = public.get_or_create_conversation('33333333-3333-3333-3333-333333333333') $$,
  $$ values (true) $$, 'get_or_create_conversation is idempotent on the pair');
reset role;

-- ordered-pair CHECK rejects a reversed/self pair (even service role) → 23514
set local role service_role;
select throws_ok(
  $$ insert into public.conversations (participant_a, participant_b)
     values ('33333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333') $$,
  '23514', null, 'self-pair violates conversations_ordered_pair');
reset role;

select * from finish();
rollback;
