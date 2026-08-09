-- Storage RLS for the post-media and moments buckets.
--
-- SPEC-FIRST. The previous version of this file asserted only that a policy with a given NAME
-- existed on storage.objects. A policy rewritten to `USING (true)` keeps its name and passed
-- all eight of those assertions while opening every private bucket to every member. Nothing
-- here asserts a name any more: every check reads pg_policies.qual / pg_policies.with_check and
-- asserts what rule 2 requires of the predicate.
--
-- Rule 2 (CLAUDE.md): RLS on every table, deny-by-default; policies use the wrapped form
-- `(select auth.uid())`, always `TO authenticated`/`TO anon` + an OWNERSHIP PREDICATE.
-- `TO authenticated` on its own is authentication without authorization.
--
-- Predicate text alone is still too weak for the read policies: a predicate rewritten to
-- `athanor.not_blocked((select auth.uid()))` is always true (nobody blocks themself, enforced by
-- blocks_no_self) and restores the leak in full, yet it still contains both `auth.uid()` and
-- `not_blocked`. So the read policies are asserted BEHAVIOURALLY at the bottom of this file:
-- rows are inserted into storage.objects as postgres and read back under three different JWTs.
-- The Storage HTTP API is not involved — the signed-URL path resolves to exactly this SELECT.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- ── fixtures for the behavioural read assertions (postgres, before any role switch) ───
-- A owns the media, B is an ordinary member, C is blocked by A.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'storage_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'storage_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'storage_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

insert into public.blocks (blocker_id, blocked_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

-- Keys use the real upload layout (apps/native/src/lib/media/paths.ts):
-- post-media {uid}/{post_id}/{n}.{ext}, moments {uid}/{moment_id}.{ext}.
-- The third row is a malformed key that the uuid-shaped guard must reject without raising.
insert into storage.objects (bucket_id, name, owner_id) values
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-00000000000a/1.jpg',
   '11111111-1111-1111-1111-111111111111'),
  ('moments', '11111111-1111-1111-1111-111111111111/bbbbbbbb-0000-0000-0000-00000000000b.jpg',
   '11111111-1111-1111-1111-111111111111'),
  ('post-media', 'not-a-uuid/1.jpg', '11111111-1111-1111-1111-111111111111');

-- ── bucket metadata ──────────────────────────────────────────────────────────────────
select is(
  (select public from storage.buckets where id = 'post-media'),
  false,
  'post-media bucket is private'
);
select is(
  (select public from storage.buckets where id = 'moments'),
  false,
  'moments bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'post-media'),
  52428800::bigint,
  'post-media file_size_limit = 52428800'
);
select ok(
  (select 'video/mp4' = any(allowed_mime_types) from storage.buckets where id = 'moments'),
  'moments allowed_mime_types contains video/mp4'
);
select is(
  (select file_size_limit from storage.buckets where id = 'moments'),
  52428800::bigint,
  'moments file_size_limit = 52428800'
);
select ok(
  (select 'audio/mpeg' = any(allowed_mime_types) from storage.buckets where id = 'post-media'),
  'post-media allowed_mime_types contains audio/mpeg'
);

-- ── RLS is on at all ─────────────────────────────────────────────────────────────────
select is(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage' and c.relname = 'objects'),
  true,
  'RLS enabled on storage.objects'
);

-- ── the policy set is exactly the eight we own ───────────────────────────────────────
select set_eq(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (policyname like 'post-media\_%' or policyname like 'moments\_%') $$,
  $$ values ('post-media_insert_own'), ('post-media_update_own'), ('post-media_delete_own'),
            ('post-media_select_member'),
            ('moments_insert_own'), ('moments_update_own'), ('moments_delete_own'),
            ('moments_select_member') $$,
  'exactly the eight post-media / moments policies exist on storage.objects'
);

-- ── every one of them is scoped to authenticated, never PUBLIC (rule 2) ──────────────
select is_empty(
  $$ select policyname::text || ' -> ' || roles::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (policyname like 'post-media\_%' or policyname like 'moments\_%')
        and roles <> '{authenticated}'::name[] $$,
  'every post-media / moments policy is TO authenticated only (never PUBLIC)'
);

-- ── no predicate is permissive-open ──────────────────────────────────────────────────
-- This is the assertion the old name-only test could not make: `USING (true)` is now caught.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (policyname like 'post-media\_%' or policyname like 'moments\_%')
        and ( btrim(coalesce(qual, ''))       in ('true', '(true)')
           or btrim(coalesce(with_check, '')) in ('true', '(true)') ) $$,
  'no post-media / moments policy has a bare `true` predicate'
);

-- ── every predicate binds its own bucket (no cross-bucket reach) ─────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (policyname like 'post-media\_%' or policyname like 'moments\_%')
        and coalesce(qual, '') || ' ' || coalesce(with_check, '')
            not like '%bucket_id = ''' || split_part(policyname, '_', 1) || '''%' $$,
  'every post-media / moments policy pins bucket_id to its own bucket'
);

-- ── owner-write policies bind the caller uid to the first path segment ───────────────
-- Path convention: post-media = {uid}/{post_id}/{n}.{ext}; moments = {uid}/{moment_id}.{ext}
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('post-media_insert_own', 'post-media_update_own',
                           'post-media_delete_own', 'moments_insert_own',
                           'moments_update_own', 'moments_delete_own')
        and not ( coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%auth.uid()%'
              and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%storage.foldername%' ) $$,
  'every owner-write policy binds auth.uid() to the first path segment'
);

-- ── the wrapped `(select auth.uid())` form, never bare (rule 2) ──────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (policyname like 'post-media\_%' or policyname like 'moments\_%')
        and replace(replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                            '( SELECT auth.uid() AS uid)', 'WRAPPED'),
                    '(select auth.uid())', 'WRAPPED') like '%auth.uid()%' $$,
  'auth.uid() is always the wrapped (select auth.uid()) form'
);

-- ── UPDATE needs BOTH using and with check (rule 2) ──────────────────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (policyname like 'post-media\_%' or policyname like 'moments\_%')
        and cmd = 'UPDATE'
        and (qual is null or with_check is null) $$,
  'every UPDATE policy carries both USING and WITH CHECK'
);

-- ── READ POLICIES CARRY AN OWNERSHIP / VISIBILITY PREDICATE ──────────────────────────
-- Both buckets shipped as `using (bucket_id = '<bucket>')` and nothing else, with the note
-- "members read (visibility/not_blocked predicates deferred to M9)"
-- (20260614204500_storage_media_buckets.sql:2-3). M9 landed athanor.not_blocked in
-- 20260619222420 and composed it into the posts / story_segments TABLE policies; the storage
-- side stayed open until 20260808151808_storage_not_blocked_predicate.sql closed it.
-- Rule 2 requires "TO authenticated + ownership predicate" -- a bucket name is not one.
--
-- The argument matters, not just the call: not_blocked applied to the CALLER's own uid is a
-- tautology. Assert it is applied to the object's owner, derived from the first path segment.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('post-media_select_member', 'moments_select_member')
        and qual not like '%not_blocked(((storage.foldername(name))[1])::uuid)%' $$,
  'read policies gate on not_blocked(owner-from-path), not on the caller''s own uid'
);

-- The guard runs before the cast, so a malformed key fails the predicate instead of raising
-- inside a USING clause and aborting the caller's query.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('post-media_select_member', 'moments_select_member')
        and qual not like '%[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}%' $$,
  'read policies uuid-shape-guard the path segment before casting it'
);

-- ── BEHAVIOUR: who can actually read the bytes ───────────────────────────────────────
-- Predicate text cannot distinguish the real predicate from
-- `athanor.not_blocked((select auth.uid()))`, which is always true. These do.
set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'post-media' and name like '11111111-%'),
  1, 'owner reads their own post-media object'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'moments'),
  1, 'owner reads their own moments object'
);

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'post-media' and name like '11111111-%'),
  1, 'a member who has not been blocked reads another member''s post-media object'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'moments'),
  1, 'a member who has not been blocked reads another member''s moments object'
);
select lives_ok(
  $$ select count(*) from storage.objects where bucket_id = 'post-media' $$,
  'a malformed (non-uuid) first path segment does not raise inside the USING clause'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'post-media' and name = 'not-a-uuid/1.jpg'),
  0, 'an object whose first path segment is not a uuid is unreadable'
);

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'post-media' and name like '11111111-%'),
  0, 'a blocked member cannot read the blocker''s post-media object'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'moments'),
  0, 'a blocked member cannot read the blocker''s moments object'
);

reset role;

select * from finish();
rollback;
