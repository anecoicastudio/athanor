-- 0143_list_blocked_rpc.test.sql
-- #663 — the blocker's own ledger can name the people it holds.
--
-- athanor.not_blocked is symmetric, so profiles_select_authenticated hides the blocked row from
-- the BLOCKER too, and the blocked-profiles list rendered «—» for everyone in it. The fix is a
-- DEFINER channel, public.list_blocked, scoped to blocker_id = auth.uid(), plus a one-directional
-- escape on avatars_select_member. Four things have to hold at once, and they pull in opposite
-- directions, so each gets its own assertion beside its denominator:
--
--   1. The blocker resolves the blocked person's identity AND still cannot read the profiles row
--      directly (0050:43-45 is untouched — the policy was not widened).
--   2. The blocked party gets nothing from the same function and still cannot see the blocker.
--   3. The avatar escape opens exactly one direction (0086:385-390 restated as the pair).
--   4. A banned blocked person lists as the #314 tombstone, never by name, and their face does
--      not sign.
--
-- CI-only (hosted lacks pgtap); smoked on staging via `db query --linked` before the push.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
-- A blocks B, D and E. B and E carry a name and a face; E is then banned.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1430000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'lb_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1430000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'lb_b@test.athanor',
   '{"locale":"it","display_name":"Bea Bloccata"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1430000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'lb_d@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1430000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'lb_e@test.athanor',
   '{"locale":"it","display_name":"Enzo Espulso"}'::jsonb, now(), now());

set local role service_role;
update public.profiles set handle = 'lb_alice' where id = 'a1430000-0000-4000-8000-000000000001';
update public.profiles
   set handle = 'lb_bea',
       avatar_path = 'b1430000-0000-4000-8000-000000000002/b1430000-0000-4000-8000-000000000002.jpg'
 where id = 'b1430000-0000-4000-8000-000000000002';
update public.profiles set handle = 'lb_dino' where id = 'd1430000-0000-4000-8000-000000000004';
update public.profiles
   set handle = 'lb_enzo',
       avatar_path = 'e1430000-0000-4000-8000-000000000005/e1430000-0000-4000-8000-000000000005.jpg'
 where id = 'e1430000-0000-4000-8000-000000000005';

-- Real upload layout: avatars = {uid}/{uid}.{ext}. A has a face too, for the reverse read.
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', 'a1430000-0000-4000-8000-000000000001/a1430000-0000-4000-8000-000000000001.jpg',
   'a1430000-0000-4000-8000-000000000001'),
  ('avatars', 'b1430000-0000-4000-8000-000000000002/b1430000-0000-4000-8000-000000000002.jpg',
   'b1430000-0000-4000-8000-000000000002'),
  ('avatars', 'e1430000-0000-4000-8000-000000000005/e1430000-0000-4000-8000-000000000005.jpg',
   'e1430000-0000-4000-8000-000000000005');

-- Distinct created_at so the keyset has an order to walk: B oldest, D middle, E newest.
insert into public.blocks (id, blocker_id, blocked_id, created_at) values
  ('11430000-0000-4000-8000-00000000000b', 'a1430000-0000-4000-8000-000000000001',
   'b1430000-0000-4000-8000-000000000002', '2026-09-01T10:00:00Z'),
  ('11430000-0000-4000-8000-00000000000d', 'a1430000-0000-4000-8000-000000000001',
   'd1430000-0000-4000-8000-000000000004', '2026-09-02T10:00:00Z'),
  ('11430000-0000-4000-8000-00000000000e', 'a1430000-0000-4000-8000-000000000001',
   'e1430000-0000-4000-8000-000000000005', '2026-09-03T10:00:00Z');

update public.profiles set banned_at = now() where id = 'e1430000-0000-4000-8000-000000000005';
reset role;

-- ── 1. shape and posture ──────────────────────────────────────────────────────────────────
select has_function('public', 'list_blocked', array['integer', 'timestamptz', 'uuid'],
  'S1 public.list_blocked(integer, timestamptz, uuid) exists');
select is_definer('public', 'list_blocked', array['integer', 'timestamptz', 'uuid'],
  'S2 list_blocked is SECURITY DEFINER — it reads through the symmetric profiles policy');
select ok(
  pg_get_function_result('public.list_blocked(integer, timestamptz, uuid)'::regprocedure) like '%removed boolean%',
  'S3 list_blocked projects the #314 removed flag');
select ok(not has_function_privilege('anon', 'public.list_blocked(integer, timestamptz, uuid)', 'execute'),
  'S4 anon cannot execute list_blocked');
select ok(not has_function_privilege('public', 'public.list_blocked(integer, timestamptz, uuid)', 'execute'),
  'S5 PUBLIC cannot execute list_blocked (0121 pins that surface by name)');
select ok(has_function_privilege('authenticated', 'public.list_blocked(integer, timestamptz, uuid)', 'execute'),
  'S6 authenticated can execute list_blocked');

-- The avatar escape must name the BLOCKER side of blocks, and keep not_blocked on the owner.
select ok(
  (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_select_member')
  like '%blocker_id%',
  'S7 avatars_select_member carries the one-directional blocker escape');
select ok(
  (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_select_member')
  like '%not_blocked(((storage.foldername(name))[1])::uuid)%',
  'S8 avatars_select_member still gates on not_blocked(owner-from-path) — 0086''s spelling');

set local role anon;
select throws_ok(
  $$ select * from public.list_blocked() $$,
  '42501',
  null,
  'S9 anon calling list_blocked is denied, not empty');
reset role;

-- ── 2. the blocker resolves the identity, and still cannot read the row ───────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1430000-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.list_blocked()), 3,
  'B1 the blocker lists every person they blocked');
select is(
  (select handle from public.list_blocked() where blocked_id = 'b1430000-0000-4000-8000-000000000002'),
  'lb_bea',
  'B2 the blocked person''s handle resolves for the blocker (#663)');
select is(
  (select display_name from public.list_blocked() where blocked_id = 'b1430000-0000-4000-8000-000000000002'),
  'Bea Bloccata',
  'B3 the blocked person''s display_name resolves for the blocker');
select is(
  (select avatar_path from public.list_blocked() where blocked_id = 'b1430000-0000-4000-8000-000000000002'),
  'b1430000-0000-4000-8000-000000000002/b1430000-0000-4000-8000-000000000002.jpg',
  'B4 the blocked person''s avatar_path resolves for the blocker');
select is(
  (select removed from public.list_blocked() where blocked_id = 'b1430000-0000-4000-8000-000000000002'),
  false,
  'B5 a live blocked person is not a tombstone');

-- The denominator: the policy was NOT widened. 0050:43-45, restated beside the channel.
select is((select count(*)::int from public.profiles where id = 'b1430000-0000-4000-8000-000000000002'), 0,
  'B6 the blocker still cannot read the blocked profiles row directly (0050 holds)');

-- ── 3. keyset ─────────────────────────────────────────────────────────────────────────────
select is(
  (select id from public.list_blocked(1)),
  '11430000-0000-4000-8000-00000000000e',
  'K1 page one is the newest block (created_at desc, id desc)');
select is(
  (select id from public.list_blocked(1, '2026-09-03T10:00:00Z', '11430000-0000-4000-8000-00000000000e')),
  '11430000-0000-4000-8000-00000000000d',
  'K2 the cursor walks to the next-older block');
select throws_ok(
  $$ select * from public.list_blocked(1, now(), null) $$,
  '22023',
  null,
  'K3 a half cursor is a caller bug (22023), not a silent page one');

-- ── 4. the tombstone ──────────────────────────────────────────────────────────────────────
select is(
  (select removed from public.list_blocked() where blocked_id = 'e1430000-0000-4000-8000-000000000005'),
  true,
  'T1 a banned blocked person still lists, flagged removed (#314)');
select is(
  (select handle from public.list_blocked() where blocked_id = 'e1430000-0000-4000-8000-000000000005'),
  null,
  'T2 a banned blocked person''s handle is NULL — no query shape names a banned member');
select is(
  (select display_name from public.list_blocked() where blocked_id = 'e1430000-0000-4000-8000-000000000005'),
  null,
  'T3 a banned blocked person''s display_name is NULL');
select is(
  (select avatar_path from public.list_blocked() where blocked_id = 'e1430000-0000-4000-8000-000000000005'),
  null,
  'T4 a banned blocked person''s avatar_path is NULL');

-- ── 5. the avatar escape, one direction only ──────────────────────────────────────────────
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars' and name like 'b1430000-%'),
  1,
  'V1 the blocker can sign the face of the person they blocked');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars' and name like 'e1430000-%'),
  0,
  'V2 the blocker cannot sign a banned blocked person''s face — not_banned stays outside the or');

-- ── 6. the blocked party ──────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"b1430000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.list_blocked()), 0,
  'X1 the blocked party''s own ledger is empty — the other direction never joins');
select is((select count(*)::int from public.profiles where id = 'a1430000-0000-4000-8000-000000000001'), 0,
  'X2 the blocked party still cannot see the blocker (0050, other direction)');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars' and name like 'a1430000-%'),
  0,
  'X3 the blocked party still cannot sign the blocker''s face (0086:385-390)');
reset role;

-- ── 7. rule #1 ────────────────────────────────────────────────────────────────────────────
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('a1430000-0000-4000-8000-000000000001', 'b1430000-0000-4000-8000-000000000002',
                         'd1430000-0000-4000-8000-000000000004', 'e1430000-0000-4000-8000-000000000005')),
  0,
  'R1 listing or holding blocks writes zero aura_events (rule #1)');
reset role;

select * from finish();
rollback;
