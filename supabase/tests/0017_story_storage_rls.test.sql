-- Storage RLS for the story-segments bucket.
--
-- SPEC-FIRST. The previous version asserted only that four policy NAMES existed on
-- storage.objects; a policy rewritten to `USING (true)` keeps its name and passed all four.
-- Every check below reads pg_policies.qual / pg_policies.with_check instead.
--
-- Rule 2 (CLAUDE.md): deny-by-default; wrapped `(select auth.uid())`,
-- `TO authenticated`/`TO anon` + an OWNERSHIP PREDICATE. The role clause alone is not
-- authorization.
--
-- Predicate text is still too weak for the read policy on its own: rewriting it to
-- `athanor.not_blocked((select auth.uid()))` is always true (blocks_no_self forbids self-blocks)
-- and reopens the leak while still mentioning both auth.uid() and not_blocked. The read policy is
-- therefore asserted BEHAVIOURALLY at the bottom of this file, under three real JWTs.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- ── fixtures for the behavioural read assertions (postgres, before any role switch) ───
-- A owns the segment, B is an ordinary member, C is blocked by A.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'story_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'story_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'story_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

insert into public.blocks (blocker_id, blocked_id)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

-- Real upload layout (apps/native/src/lib/media/paths.ts): {uid}/{segment_id}.{ext}.
-- The second row is a malformed key the uuid-shaped guard must reject without raising.
insert into storage.objects (bucket_id, name, owner_id) values
  ('story-segments', '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.mp4',
   '11111111-1111-1111-1111-111111111111'),
  ('story-segments', 'not-a-uuid/seg.mp4', '11111111-1111-1111-1111-111111111111');

-- ── bucket metadata ──────────────────────────────────────────────────────────────────
select is(
  (select public from storage.buckets where id = 'story-segments'),
  false, 'story-segments bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'story-segments'),
  52428800::bigint, 'story-segments file_size_limit = 52428800'
);
select ok(
  (select 'video/mp4' = any(allowed_mime_types) from storage.buckets where id = 'story-segments'),
  'story-segments allowed_mime_types contains video/mp4'
);

-- ── the policy set is exactly the four we own ────────────────────────────────────────
select set_eq(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'story-segments\_%' $$,
  $$ values ('story-segments_insert_own'), ('story-segments_update_own'),
            ('story-segments_delete_own'), ('story-segments_select_member') $$,
  'exactly the four story-segments policies exist on storage.objects'
);

-- ── scoped to authenticated, never PUBLIC (rule 2) ───────────────────────────────────
select is_empty(
  $$ select policyname::text || ' -> ' || roles::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'story-segments\_%'
        and roles <> '{authenticated}'::name[] $$,
  'every story-segments policy is TO authenticated only (never PUBLIC)'
);

-- ── no predicate is permissive-open ──────────────────────────────────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'story-segments\_%'
        and ( btrim(coalesce(qual, ''))       in ('true', '(true)')
           or btrim(coalesce(with_check, '')) in ('true', '(true)') ) $$,
  'no story-segments policy has a bare `true` predicate'
);

-- ── every predicate pins the bucket ──────────────────────────────────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'story-segments\_%'
        and coalesce(qual, '') || ' ' || coalesce(with_check, '')
            not like '%bucket_id = ''story-segments''%' $$,
  'every story-segments policy pins bucket_id = story-segments'
);

-- ── owner-write policies bind the caller uid to the first path segment ───────────────
-- Path convention: story-segments = {uid}/{segment_id}.{ext}
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('story-segments_insert_own', 'story-segments_update_own',
                           'story-segments_delete_own')
        and not ( coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%auth.uid()%'
              and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%storage.foldername%' ) $$,
  'every owner-write policy binds auth.uid() to the first path segment'
);

-- ── the wrapped `(select auth.uid())` form, never bare (rule 2) ──────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'story-segments\_%'
        and replace(replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                            '( SELECT auth.uid() AS uid)', 'WRAPPED'),
                    '(select auth.uid())', 'WRAPPED') like '%auth.uid()%' $$,
  'auth.uid() is always the wrapped (select auth.uid()) form'
);

-- ── UPDATE needs BOTH using and with check (rule 2) ──────────────────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'story-segments\_%'
        and cmd = 'UPDATE'
        and (qual is null or with_check is null) $$,
  'every UPDATE policy carries both USING and WITH CHECK'
);

-- ── THE READ POLICY CARRIES AN OWNERSHIP / VISIBILITY PREDICATE ──────────────────────
-- `story-segments_select_member` shipped as `using (bucket_id = 'story-segments')` and nothing
-- else (20260614230533_story_storage_bucket.sql:2-3, "visibility/not_blocked deferred to M9").
-- That deferral named two consequences:
--
--   1. Stories expire. `story_segments.expires_at` gates the TABLE policy; the storage row has
--      no expiry predicate, so an expired segment's FILE stays readable via a signed URL.
--   2. `athanor.not_blocked` gates the TABLE policy and appeared nowhere on storage.objects, so
--      a blocked member lost the row and kept the file.
--
-- 20260808151808_storage_not_blocked_predicate.sql closes (2) only. (1) IS STILL OPEN and is
-- deliberately not asserted here in either direction: gating storage on expiry means joining
-- story_segments from inside a USING clause on every object read, and whether that cost is
-- acceptable -- or whether expiry should be enforced by a reaper that deletes the objects -- is
-- an open decision, not something a test should freeze. Do not read the assertions below as
-- covering expiry.
--
-- The argument matters, not just the call: not_blocked applied to the CALLER's own uid is a
-- tautology. Assert it is applied to the object's owner, derived from the first path segment.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'story-segments_select_member'
        and qual not like '%not_blocked(((storage.foldername(name))[1])::uuid)%' $$,
  'read policy gates on not_blocked(owner-from-path), not on the caller''s own uid'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'story-segments_select_member'
        and qual not like '%[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}%' $$,
  'read policy uuid-shape-guards the path segment before casting it'
);

-- ── BEHAVIOUR: who can actually read the bytes ───────────────────────────────────────
set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments' and name like '11111111-%'),
  1, 'owner reads their own story segment'
);

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments' and name like '11111111-%'),
  1, 'a member who has not been blocked reads another member''s story segment'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments' and name = 'not-a-uuid/seg.mp4'),
  0, 'a segment whose first path segment is not a uuid is unreadable'
);

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments' and name like '11111111-%'),
  0, 'a blocked member cannot read the blocker''s story segment'
);

reset role;

select * from finish();
rollback;
