-- messages_user_shape vs sender_id ON DELETE SET NULL (#336, 20260813163902) — asserts:
-- the widened CHECK admits the deleted-member shape (null sender on kind='user') so a
-- profile hard-delete completes instead of aborting with 23514 · the participant cascade
-- still erases the member's conversations+messages (today's end state, policy untouched) ·
-- the CHECK still rejects empty-body user rows and sendered system rows · RLS still forbids
-- a CLIENT from inserting a null-sender user message (the FK action and the service role
-- are the only producers of that shape).
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- fixture: a (deleted below) messages b inside one conversation (a < b for the ordered pair)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'erasure_msg_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'erasure_msg_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select set_config('test.a', 'aaaaaaaa-1111-4111-8111-111111111111', false);
select set_config('test.b', 'bbbbbbbb-2222-4222-8222-222222222222', false);

insert into public.conversations (id, participant_a, participant_b)
values ('cccccccc-3333-4333-8333-333333333333',
        current_setting('test.a')::uuid, current_setting('test.b')::uuid);

insert into public.messages (id, conversation_id, sender_id, kind, body)
values ('dddddddd-4444-4444-8444-444444444444',
        'cccccccc-3333-4333-8333-333333333333',
        current_setting('test.a')::uuid, 'user', 'ciao');

-- (A) a client still cannot forge the deleted-member shape (RLS pins sender = self)
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
       values ('cccccccc-3333-4333-8333-333333333333', null, 'user', 'forged') $$,
  '42501', null, 'client insert of a null-sender user message stays RLS-blocked');
reset role;

-- (B) the CHECK still holds its two real invariants
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
       values ('cccccccc-3333-4333-8333-333333333333',
               current_setting('test.a')::uuid, 'user', '') $$,
  '23514', null, 'user message with an empty body still rejected');
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, prompt_key)
       values ('cccccccc-3333-4333-8333-333333333333',
               current_setting('test.a')::uuid, 'system', 'chat.system.iceBreaker') $$,
  '23514', null, 'system message with a sender still rejected');

-- (C) the deleted-member shape itself now passes — this is the exact write the FK's
--     SET NULL action performs mid-cascade, the one that aborted with 23514 before #336
select lives_ok(
  $$ update public.messages set sender_id = null
      where id = 'dddddddd-4444-4444-8444-444444444444' $$,
  'sender_id SET NULL on a user message passes the widened CHECK');

-- restore the sender so the hard-delete below exercises the full referential race
update public.messages set sender_id = current_setting('test.a')::uuid
 where id = 'dddddddd-4444-4444-8444-444444444444';

-- (D) THE repro: hard-deleting the member completes instead of aborting
select lives_ok(
  $$ delete from auth.users where id = current_setting('test.a')::uuid $$,
  'auth.users hard-delete with an owned user message completes (no 23514)');

-- (E) today's end state: the participant cascade erased the pair's conversation+messages;
--     the counterpart's account is untouched
select is(
  (select count(*)::int from public.conversations
     where id = 'cccccccc-3333-4333-8333-333333333333'),
  0, 'the conversation is gone (participant cascade)');
select is(
  (select count(*)::int from public.messages
     where conversation_id = 'cccccccc-3333-4333-8333-333333333333'),
  0, 'its messages are gone with it');
select is(
  (select count(*)::int from public.profiles
     where id = current_setting('test.b')::uuid),
  1, 'the counterpart profile survives');

select finish();
rollback;
