begin;
select plan(12);

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

-- seed a momento pair; capture its id in a transaction-local GUC (see 0029): psql :'var'
-- is not interpolated inside $$…$$, so assertions read current_setting('test.conv') instead.
set local role service_role;
select set_config('test.conv', public.create_conversation_pair(
  '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','momento')::text, true);
reset role;

select has_table('public', 'messages', 'messages exists');
select ok((select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
  'RLS enabled on messages');
-- `messages_select_reported` (#574, 20260831153525) is the admin's evidence arm: it admits a
-- message a report NAMES, and nothing else. It is asserted in full — predicate and behaviour,
-- including what it must not reach — in 0141; here it only has to be in the list, because this
-- list is exhaustive and a fourth permissive policy appearing unannounced is the thing it
-- exists to catch.
select policies_are('public', 'messages',
  array['messages_select_participant', 'messages_select_reported', 'messages_insert_own_user',
        'active_write_insert', 'active_write_update', 'active_write_delete'], 'expected policies');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- server injected exactly 1 system + 3 prompt ice-breakers
select results_eq(
  $$ select count(*)::int from public.messages where conversation_id = current_setting('test.conv')::uuid
       and kind in ('system','prompt') $$,
  $$ values (4) $$, 'server injected 1 system + 3 prompt ice-breakers');

-- participant posts a user message
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
     values (current_setting('test.conv')::uuid,'11111111-1111-1111-1111-111111111111','user','Ciao!') $$,
  'participant posts a user message');

-- client cannot insert kind='system' (unforgeable banner) → 42501
select throws_ok(
  $$ insert into public.messages (conversation_id, kind, body)
     values (current_setting('test.conv')::uuid,'system','forged banner') $$,
  '42501', null, 'client cannot insert kind=system');

-- client cannot forge a prompt ice-breaker → 42501
select throws_ok(
  $$ insert into public.messages (conversation_id, kind, prompt_key)
     values (current_setting('test.conv')::uuid,'prompt','chat.prompt.who') $$,
  '42501', null, 'client cannot forge a prompt ice-breaker');

-- client cannot spoof another sender → 42501
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
     values (current_setting('test.conv')::uuid,'22222222-2222-2222-2222-222222222222','user','spoofed') $$,
  '42501', null, 'client cannot send as another user');

-- bump trigger set last_message_at + preview from the user message
select results_eq(
  $$ select last_message_preview from public.conversations where id = current_setting('test.conv')::uuid $$,
  $$ values ('Ciao!'::text) $$, 'bump trigger stored the last_message_preview');

-- non-participant cannot read the thread
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.messages where conversation_id = current_setting('test.conv')::uuid $$,
  $$ values (0) $$, 'non-participant cannot read messages');

-- non-participant cannot post → 42501
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
     values (current_setting('test.conv')::uuid,'33333333-3333-3333-3333-333333333333','user','intruder') $$,
  '42501', null, 'non-participant cannot post');
reset role;

-- CHECK coherence: even service role can't store a user row carrying a prompt_key → 23514
set local role service_role;
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, prompt_key)
     values (current_setting('test.conv')::uuid,'11111111-1111-1111-1111-111111111111','user','hi','chat.prompt.who') $$,
  '23514', null, 'a user message cannot carry a prompt_key (messages_prompt_key_shape)');
reset role;

select * from finish();
rollback;
