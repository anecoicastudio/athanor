-- conversation_reads — the read cursor behind the unread pip (#637 item 4, 20260902153057/59/60).
--
-- What this pins, beyond the usual RLS shape: the cursor is SERVER-STAMPED (a caller-supplied
-- last_read_at is discarded), the table is deliberately OUTSIDE #106's restrictive write net, and
-- conversations.last_message_sender_id is actually written by the bump trigger — the column the
-- whole "don't light my own thread" half of unread rests on.
--
-- Privileges are asserted with has_table_privilege, never with a write that RLS could swallow for
-- the wrong reason (rules/supabase-db.md, the #404 class).
begin;
select plan(20);

-- fixtures: alice + bob are the pair; cara is the outsider
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

-- ── shape ────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'conversation_reads', 'conversation_reads exists');
select ok((select relrowsecurity from pg_class where oid = 'public.conversation_reads'::regclass),
  'RLS enabled on conversation_reads');

-- Exactly three, and no active_write_* among them: a read cursor is not a member speaking, so the
-- table stays out of #106's net on purpose (the migration states why). If someone adds the net
-- here later, this list is where they have to argue for it.
select policies_are('public', 'conversation_reads',
  array['conversation_reads_select_own',
        'conversation_reads_insert_own',
        'conversation_reads_update_own'],
  'own-row select/insert/update only — no delete policy, and outside the moderation net');

select has_trigger('public'::name, 'conversation_reads'::name,
  'conversation_reads_touch_updated_at'::name);
select has_trigger('public'::name, 'conversation_reads'::name,
  'conversation_reads_stamp_last_read_at'::name);

-- The stamp function needs no privilege it does not already have (20260902153060).
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'stamp_conversation_read' and p.pronamespace = 'athanor'::regnamespace),
  false, 'stamp_conversation_read is SECURITY INVOKER — it only assigns NEW');

-- ── privileges, asserted directly ────────────────────────────────────────────────────────────
select ok(has_table_privilege('authenticated', 'public.conversation_reads', 'SELECT')
      and has_table_privilege('authenticated', 'public.conversation_reads', 'INSERT')
      and has_table_privilege('authenticated', 'public.conversation_reads', 'UPDATE'),
  'authenticated holds select/insert/update on conversation_reads');
select ok(not has_table_privilege('authenticated', 'public.conversation_reads', 'DELETE'),
  'authenticated holds NO delete — a cursor is never withdrawn by hand');
select ok(not has_table_privilege('anon', 'public.conversation_reads', 'SELECT')
      and not has_table_privilege('anon', 'public.conversation_reads', 'INSERT'),
  'anon holds nothing on conversation_reads');

-- ── the pair ─────────────────────────────────────────────────────────────────────────────────
set local role service_role;
select set_config('test.conv', public.create_conversation_pair(
  '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'direct')::text, true);
-- a second conversation alice is NOT part of
select set_config('test.other', public.create_conversation_pair(
  '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'direct')::text, true);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ insert into public.conversation_reads (conversation_id, profile_id)
     values (current_setting('test.conv')::uuid, '11111111-1111-1111-1111-111111111111') $$,
  'a participant marks their own cursor on their own conversation');

select throws_ok(
  $$ insert into public.conversation_reads (conversation_id, profile_id)
     values (current_setting('test.conv')::uuid, '22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'cannot write a cursor on behalf of the other participant');

select throws_ok(
  $$ insert into public.conversation_reads (conversation_id, profile_id)
     values (current_setting('test.other')::uuid, '11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'cannot open a cursor on a conversation you are not in');

select throws_ok(
  $$ delete from public.conversation_reads
      where conversation_id = current_setting('test.conv')::uuid $$,
  '42501', null, 'client cannot delete a cursor (no grant)');

-- ── the stamp discards the caller's clock ────────────────────────────────────────────────────
select lives_ok(
  $$ update public.conversation_reads set last_read_at = '2000-01-01T00:00:00Z'
      where conversation_id = current_setting('test.conv')::uuid $$,
  'the owner may update their own cursor');
select ok(
  (select last_read_at from public.conversation_reads
     where conversation_id = current_setting('test.conv')::uuid
       and profile_id = '11111111-1111-1111-1111-111111111111') > now() - interval '1 minute',
  'a caller-supplied last_read_at is overwritten with the server clock');

-- ── the cursor is private ────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.conversation_reads
      where conversation_id = current_setting('test.conv')::uuid $$,
  $$ values (0) $$,
  'the other participant cannot read my cursor — it is mine, not a read receipt for them');

-- ── bump writes the sender, which is what keeps my own thread unlit ──────────────────────────
-- `created_at` explicit, and this is the one place the file cannot leave it to the default: a
-- pgTAP file is ONE transaction, so `now()` is frozen for its whole length and the message would
-- carry the very timestamp the stamp trigger just wrote onto alice's cursor. The strict `>` the
-- list query uses would then be false for a reply that plainly came later. The interval is what
-- makes "afterwards" expressible here at all; across two real requests it is free.
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, created_at)
     values (current_setting('test.conv')::uuid,
             '22222222-2222-2222-2222-222222222222', 'user', 'ciao', now() + interval '1 second') $$,
  'bob sends a message');
select is(
  (select last_message_sender_id from public.conversations
     where id = current_setting('test.conv')::uuid),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'bump_conversation_on_message records who sent the message that moved last_message_at');

-- Alice's cursor now predates bob's message: the derived unread the list query computes
-- (last_message_at > last_read_at and last_message_sender_id <> me) is true for her.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select ok(
  (select c.last_message_at > r.last_read_at
     from public.conversations c
     join public.conversation_reads r
       on r.conversation_id = c.id and r.profile_id = '11111111-1111-1111-1111-111111111111'
    where c.id = current_setting('test.conv')::uuid),
  'the reply lands after alice''s cursor — the pip has a source at last');

-- The other half of the derived unread: a conversation the member has never opened has NO cursor
-- row at all, and the list query's left join yields null. Absence must read as unread, or every
-- thread a member has never touched would arrive silently.
select is(
  (select count(*)::int from public.conversation_reads r
    where r.conversation_id = current_setting('test.other')::uuid
      and r.profile_id = '11111111-1111-1111-1111-111111111111'),
  0, 'a never-opened conversation has no cursor row — unread by absence, not by comparison');
reset role;

select * from finish();
rollback;
