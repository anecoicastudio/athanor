-- 0066_connections_block_invisibility.test.sql
-- P2.3 — asserts athanor.not_blocked() is wired into the three connection policies the
-- M9 blocks migration deferred (TODO(M9) in 20260616153035): a block hides pending
-- connection_requests and established connections in BOTH directions, and blocks new
-- request INSERTs from either side (42501). Mirrors 0052's two-user structure.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ── seed two users (profiles auto-created by handle_new_user trigger) ─────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-000000000011',
   'authenticated', 'authenticated', 'conn_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dddd0000-0000-0000-0000-000000000012',
   'authenticated', 'authenticated', 'conn_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── seed a pending request A→B and an established connection as service_role ──
set local role service_role;

insert into public.connection_requests (id, requester_id, addressee_id, status)
values ('cccc0002-0000-0000-0000-000000000000',
        'cccc0000-0000-0000-0000-000000000011', 'dddd0000-0000-0000-0000-000000000012', 'pending');

-- connections_ordered_pair requires profile_a < profile_b (cccc… < dddd…)
insert into public.connections (profile_a, profile_b)
values ('cccc0000-0000-0000-0000-000000000011', 'dddd0000-0000-0000-0000-000000000012');

reset role;

-- ── baseline (no block yet): both surfaces visible to A ───────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-000000000011","role":"authenticated"}';

select is(
  (select count(*) from public.connection_requests where id = 'cccc0002-0000-0000-0000-000000000000')::int,
  1, 'pre-block: requester (A) sees own pending request');

select is(
  (select count(*) from public.connections)::int,
  1, 'pre-block: participant (A) sees the connection');

-- ── A blocks B ────────────────────────────────────────────────────────────────
set local role service_role;
insert into public.blocks (blocker_id, blocked_id)
values ('cccc0000-0000-0000-0000-000000000011', 'dddd0000-0000-0000-0000-000000000012');
reset role;

-- ── blocker (A) side: request + connection both invisible ─────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-000000000011","role":"authenticated"}';

select is(
  (select count(*) from public.connection_requests)::int,
  0, 'post-block: blocker (A) cannot see the pending request');

select is(
  (select count(*) from public.connections)::int,
  0, 'post-block: blocker (A) cannot see the connection');

-- ── blocked (B) side: request + connection both invisible ─────────────────────
set local request.jwt.claims = '{"sub":"dddd0000-0000-0000-0000-000000000012","role":"authenticated"}';

select is(
  (select count(*) from public.connection_requests)::int,
  0, 'post-block: blocked user (B) cannot see the pending request');

select is(
  (select count(*) from public.connections)::int,
  0, 'post-block: blocked user (B) cannot see the connection');

-- ── respond_to_connection DEFINER RPC: blocked addressee cannot accept a cached
--    pending request id (raises the same no_data_found = P0002 as a missing request,
--    so block state stays unobservable — Inv 7). Request cccc0002 still exists here. ──
select throws_ok(
  $$ select public.respond_to_connection('cccc0002-0000-0000-0000-000000000000', true) $$,
  'P0002',
  null,
  'blocked addressee (B) cannot accept a cached pending request via RPC');

-- ── new request INSERT rejected from both sides (WITH CHECK → 42501) ──────────
-- remove the seeded pending request first so the RLS failure is unambiguous
-- (not the crossed-pending unique index).
set local role service_role;
delete from public.connection_requests where id = 'cccc0002-0000-0000-0000-000000000000';
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddd0000-0000-0000-0000-000000000012","role":"authenticated"}';

select throws_ok(
  $$ insert into public.connection_requests (requester_id, addressee_id)
     values ('dddd0000-0000-0000-0000-000000000012', 'cccc0000-0000-0000-0000-000000000011') $$,
  '42501',
  null,
  'blocked user (B) cannot send a request to blocker (A)');

set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-000000000011","role":"authenticated"}';

select throws_ok(
  $$ insert into public.connection_requests (requester_id, addressee_id)
     values ('cccc0000-0000-0000-0000-000000000011', 'dddd0000-0000-0000-0000-000000000012') $$,
  '42501',
  null,
  'blocker (A) cannot send a request to blocked user (B)');

reset role;

select * from finish();
rollback;
