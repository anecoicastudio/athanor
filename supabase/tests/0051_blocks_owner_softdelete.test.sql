-- 0051_blocks_owner_softdelete.test.sql
-- Regression: prove that the owner soft-delete OR-clause (`deleted_at is null or author_id = auth.uid()`)
-- was correctly restored on posts / post_comments / story_segments by the
-- 20260619223725_m9_blocks_restore_owner_softdelete migration.
-- Without the fix, `update set deleted_at = now()` from the owner fails 42501 because
-- PostgreSQL checks the UPDATE's NEW row against the SELECT policy.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── seed two users ────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'softdel_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb0000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'softdel_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── seed rows as service_role (bypasses RLS) ─────────────────────────────────
set local role service_role;

-- post owned by user A
insert into public.posts (id, author_id, category, body)
values ('aaaa0001-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001', 'human', 'test post by a');

-- post_comment owned by user A on A's post
insert into public.post_comments (id, post_id, author_id, body)
values ('aaaa0002-0000-0000-0000-000000000000', 'aaaa0001-0000-0000-0000-000000000000',
        'aaaa0000-0000-0000-0000-000000000001', 'test comment by a');

-- story_segment owned by user A (expires in the future so it is live)
insert into public.story_segments (id, author_id, kind, storage_path, expires_at)
values ('aaaa0003-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001',
        'photo', 'story-segments/aaaa/test.jpg', now() + interval '24 hours');

reset role;

-- ── tests as user A (the owner) ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}';

-- REGRESSION: owner must be able to soft-delete their own post
select lives_ok(
  $$ update public.posts set deleted_at = now() where id = 'aaaa0001-0000-0000-0000-000000000000' $$,
  'owner soft-deletes own post (regression: 42501 without the OR-clause fix)');

-- REGRESSION: owner must be able to soft-delete their own post_comment
select lives_ok(
  $$ update public.post_comments set deleted_at = now() where id = 'aaaa0002-0000-0000-0000-000000000000' $$,
  'owner soft-deletes own post_comment (regression: 42501 without the OR-clause fix)');

-- REGRESSION: owner must be able to soft-delete their own story_segment
select lives_ok(
  $$ update public.story_segments set deleted_at = now() where id = 'aaaa0003-0000-0000-0000-000000000000' $$,
  'owner soft-deletes own story_segment (regression: 42501 without the OR-clause fix)');

-- ── tests as user B (a non-owner) ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-000000000002","role":"authenticated"}';

-- non-owner must NOT see the soft-deleted post
select is(
  (select count(*) from public.posts where id = 'aaaa0001-0000-0000-0000-000000000000')::int,
  0, 'non-owner cannot see soft-deleted post');

-- non-owner must NOT see the soft-deleted post_comment
select is(
  (select count(*) from public.post_comments where id = 'aaaa0002-0000-0000-0000-000000000000')::int,
  0, 'non-owner cannot see soft-deleted post_comment');

-- non-owner must NOT see the soft-deleted story_segment
select is(
  (select count(*) from public.story_segments where id = 'aaaa0003-0000-0000-0000-000000000000')::int,
  0, 'non-owner cannot see soft-deleted story_segment');

reset role;

select * from finish();
rollback;
