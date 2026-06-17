begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

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

-- Owner-topic predicate logic: under jwt sub = A, topic aura:A matches, aura:B does not.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select set_config('realtime.topic', 'aura:11111111-1111-1111-1111-111111111111', true);
select is(
  ('aura:' || (select auth.uid())::text = (select realtime.topic())),
  true,
  'owner receives on their own aura topic');
select set_config('realtime.topic', 'aura:22222222-2222-2222-2222-222222222222', true);
select is(
  ('aura:' || (select auth.uid())::text = (select realtime.topic())),
  false,
  'a client cannot receive on another profile''s aura topic');
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

select * from finish();
rollback;
