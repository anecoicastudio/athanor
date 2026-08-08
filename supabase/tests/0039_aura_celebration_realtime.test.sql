begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Fixtures for the behavioural subscribe assertions (postgres, before any role switch).
-- A is the celebrated member, B is another member. The row is what the engine's emitter
-- writes: a private broadcast on A's own topic.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rt_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'rt_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

insert into realtime.messages (topic, extension, event, payload, private)
values ('aura:11111111-1111-1111-1111-111111111111', 'broadcast', 'aura_celebration',
        '{"stars":["mentor"]}'::jsonb, true);

-- RLS is enabled on realtime.messages (private-channel authz depends on it).
select is(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'realtime' and c.relname = 'messages'),
  true,
  'RLS enabled on realtime.messages');

-- The owner-receive SELECT policy exists, scoped to authenticated, command SELECT.
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'realtime' and tablename = 'messages'
       and policyname = 'rt_aura_owner_receive' and cmd = 'SELECT'),
  1,
  'rt_aura_owner_receive SELECT policy exists');

-- There is NO client INSERT/UPDATE/DELETE policy named for the aura topic (no send path).
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'realtime' and tablename = 'messages'
       and policyname like '%aura%' and cmd <> 'SELECT'),
  0,
  'no client write policy on the aura topic (I3 forge-prevention)');

-- Who actually receives the broadcast. Read realtime.messages under a real JWT rather than
-- re-deriving the predicate in SQL: a hand-written copy of `'aura:' || auth.uid() = topic()`
-- passes even if rt_aura_owner_receive is dropped outright, because it never consults the policy.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select set_config('realtime.topic', 'aura:11111111-1111-1111-1111-111111111111', true);
select is(
  (select count(*)::int from realtime.messages),
  1,
  'owner receives the celebration on their own aura topic');

select set_config('realtime.topic', 'aura:22222222-2222-2222-2222-222222222222', true);
select is(
  (select count(*)::int from realtime.messages),
  0,
  'the owner reaching for another profile''s aura topic receives nothing');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select set_config('realtime.topic', 'aura:11111111-1111-1111-1111-111111111111', true);
select is(
  (select count(*)::int from realtime.messages),
  0,
  'another member subscribing to the owner''s aura topic receives nothing');
reset role;

-- The engine emitter exists.
select has_function('public', 'broadcast_aura_celebration',
  array['uuid', 'text', 'text[]'], 'broadcast_aura_celebration exists');

-- Clients cannot execute it (forge a celebration); the engine (service_role) can.
select is(
  has_function_privilege('authenticated',
    'public.broadcast_aura_celebration(uuid, text, text[])', 'execute'),
  false,
  'authenticated cannot call the celebration emitter (rule #1 / I3)');
select is(
  has_function_privilege('service_role',
    'public.broadcast_aura_celebration(uuid, text, text[])', 'execute'),
  true,
  'service_role (the engine) can call the celebration emitter');

-- rt_aura_owner_receive qual must scope both the owner topic AND the broadcast extension.
select is(
  (select count(*)::int from pg_policies
     where schemaname='realtime' and tablename='messages' and policyname='rt_aura_owner_receive'
       and qual ilike '%extension%' and qual ilike '%broadcast%' and qual ilike '%realtime.topic()%'),
  1,
  'rt_aura_owner_receive qual scopes both the owner topic AND the broadcast extension');

-- All three Aura tables must be in the supabase_realtime publication.
select is((select count(*)::int from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='aura_scores'), 1,
   'aura_scores is in supabase_realtime publication');
select is((select count(*)::int from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='aura_events'), 1,
   'aura_events is in supabase_realtime publication');
select is((select count(*)::int from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='stars'), 1,
   'stars is in supabase_realtime publication');

-- ── unauthorised actors ──────────────────────────────────────────────────────
-- The assertions above cover a *signed-in* client reaching for someone else's topic. The
-- anonymous case was untested: an aura celebration names a member and their new stars, so an
-- anon subscriber must not reach the topic at all.

-- 13. the owner-receive policy is scoped to authenticated only -- never anon, never PUBLIC.
select is(
  (select roles::text from pg_policies
     where schemaname='realtime' and tablename='messages'
       and policyname='rt_aura_owner_receive'),
  '{authenticated}',
  'rt_aura_owner_receive is TO authenticated only (anon can never subscribe)');

-- 14. anon cannot execute the celebration emitter (the forge path, from the other role).
select is(
  has_function_privilege('anon',
    'public.broadcast_aura_celebration(uuid, text, text[])', 'execute'),
  false,
  'anon cannot call the celebration emitter (rule #1 / I3)');

-- An anon session subscribing to a real aura topic receives nothing. rt_aura_owner_receive is
-- TO authenticated, and no anon SELECT policy exists on realtime.messages, so RLS denies by
-- default. Asserted by reading the table, not by re-deriving the predicate: under anon
-- `'aura:' || auth.uid()` is null and any comparison to it is null, so a hand-written copy of
-- the predicate is false for every topic and passes even against `USING (true)`.
set local role anon;
set local request.jwt.claims = '';
select set_config('realtime.topic', 'aura:11111111-1111-1111-1111-111111111111', true);
select is(
  (select count(*)::int from realtime.messages),
  0,
  'an anon session receives nothing on a real aura topic');
reset role;

select * from finish();
rollback;
