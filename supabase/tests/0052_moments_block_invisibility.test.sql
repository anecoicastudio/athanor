-- 0052_moments_block_invisibility.test.sql
-- Asserts that the moments SELECT policy hides a user's moments from their mutual block partner
-- in both directions, and that the owner can still soft-delete their own moment (regression guard
-- for the deleted_at IS NULL or owner_id = auth.uid() OR-clause that must be preserved).

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- ── seed two users ────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'moment_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dddd0000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'moment_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── seed rows as service_role (bypasses RLS) ─────────────────────────────────
-- profiles are auto-created by the on_auth_user_created trigger (handle_new_user)
-- so we do NOT insert into public.profiles manually — just seed the moments.

set local role service_role;

-- one moment per user
insert into public.moments (id, owner_id, kind, media_path)
values
  ('cccc0001-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-000000000001', 'photo', 'moments/cccc/test.jpg'),
  ('dddd0001-0000-0000-0000-000000000000', 'dddd0000-0000-0000-0000-000000000002', 'photo', 'moments/dddd/test.jpg');

-- user A blocks user B
insert into public.blocks (blocker_id, blocked_id)
values ('cccc0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000002');

reset role;

-- ── as user A (the blocker) — cannot see B's moments ─────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.moments where owner_id = 'dddd0000-0000-0000-0000-000000000002')::int,
  0,
  'blocker (A) cannot see blocked user (B) moments');

-- ── as user B (the blocked) — cannot see A's moments ─────────────────────────
set local request.jwt.claims = '{"sub":"dddd0000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from public.moments where owner_id = 'cccc0000-0000-0000-0000-000000000001')::int,
  0,
  'blocked user (B) cannot see blocker (A) moments');

-- ── regression: A can still see their OWN moment (not filtered by not_blocked) ─
set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.moments where id = 'cccc0001-0000-0000-0000-000000000000')::int,
  1,
  'owner (A) can still see their own moment');

-- ── regression: owner can still soft-delete their own moment ─────────────────
-- (Without the `or owner_id = auth.uid()` OR-clause the UPDATE's NEW row would fail
-- the SELECT policy because deleted_at IS NOT NULL after the set, yielding 42501.)
select lives_ok(
  $$ update public.moments set deleted_at = now() where id = 'cccc0001-0000-0000-0000-000000000000' $$,
  'owner can soft-delete own moment (regression: 42501 without OR-clause)');

-- ── regression: owner sees their own soft-deleted moment (OR-clause active) ───
select is(
  (select count(*) from public.moments where id = 'cccc0001-0000-0000-0000-000000000000')::int,
  1,
  'owner still sees their own soft-deleted moment (OR-clause preserved)');

reset role;

select * from finish();
rollback;
