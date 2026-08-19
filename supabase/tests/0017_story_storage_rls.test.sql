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

select plan(27);

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

-- Descriptor rows for the objects below. The storage policy joins these, so an object with no
-- row — or with a row that has expired, been unpinned, or been soft-deleted — is unreadable
-- (issue #21). All authored by A.
insert into public.story_segments (id, author_id, kind, storage_path, pinned, expires_at, deleted_at)
values
  -- live, unpinned: the ordinary case the pre-existing assertions below exercise
  ('dddddddd-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   'video', '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.mp4',
   false, now() + interval '12 hours', null),
  -- past its 24h window and NOT pinned: the bug. Row vanishes, file used to stay readable.
  ('eeeeeeee-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
   'video', '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-00000000000e.mp4',
   false, now() - interval '1 hour', null),
  -- past the window but PINNED: «un passo del percorso» is meant to survive (PRD §4.5)
  ('ffffffff-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111',
   'video', '11111111-1111-1111-1111-111111111111/ffffffff-0000-0000-0000-00000000000f.mp4',
   true, now() - interval '1 hour', null),
  -- live but soft-deleted: the author took it down, so the bytes must go with the row
  ('cccccccc-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   'video', '11111111-1111-1111-1111-111111111111/cccccccc-0000-0000-0000-00000000000c.mp4',
   false, now() + interval '12 hours', now());

-- Real upload layout (apps/native/src/lib/media/paths.ts): {uid}/{segment_id}.{ext}.
-- Rows 5-6 are malformed/orphaned keys the guards must reject without raising.
insert into storage.objects (bucket_id, name, owner_id) values
  ('story-segments', '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.mp4',
   '11111111-1111-1111-1111-111111111111'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-00000000000e.mp4',
   '11111111-1111-1111-1111-111111111111'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/ffffffff-0000-0000-0000-00000000000f.mp4',
   '11111111-1111-1111-1111-111111111111'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/cccccccc-0000-0000-0000-00000000000c.mp4',
   '11111111-1111-1111-1111-111111111111'),
  ('story-segments', 'not-a-uuid/seg.mp4', '11111111-1111-1111-1111-111111111111'),
  -- well-formed owner folder, filename that is not a uuid at all: no descriptor can match it,
  -- and the predicate must deny rather than raise
  ('story-segments', '11111111-1111-1111-1111-111111111111/not-a-uuid.mp4',
   '11111111-1111-1111-1111-111111111111'),
  -- both path parts well-formed, but no descriptor row exists: an orphaned upload
  ('story-segments', '11111111-1111-1111-1111-111111111111/0a0a0a0a-0000-0000-0000-00000000000a.mp4',
   '11111111-1111-1111-1111-111111111111'),
  -- A re-uploads bytes under their own folder, naming them after a segment that is still live.
  -- An id-parsing predicate would serve this forever; binding on storage_path denies it.
  ('story-segments', '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.jpg',
   '11111111-1111-1111-1111-111111111111');

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
-- #461 widened this bucket to accept QuickTime: an iPhone records .mov and the client used to
-- mislabel it 'video/mp4' to get past this very list. Pinned as the WHOLE array, the way 0043
-- pins candidacy-videos, so a later sweep cannot drop a type while still "containing" mp4.
select is(
  (select allowed_mime_types from storage.buckets where id = 'story-segments'),
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'],
  'story-segments accepts mp4 + quicktime video and three image types'
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
-- 20260808151808_storage_not_blocked_predicate.sql closed (2).
-- 20260809151111_story_segment_storage_expiry.sql closes (1) — issue #21 — by matching the
-- object to its descriptor row on `storage_path` from inside the USING clause. The decision the
-- earlier version of this comment left open (join-per-read vs. a reaper that deletes the
-- objects) went to the join: a reaper leaves a window between expiry and the sweep, and PRD
-- §4.5's 24h is a promise about the moment, not about a cron's cadence.
--
-- The TABLE policy it mirrors is NOT the text 20260614230531 shipped. After 20260616083015,
-- 20260619222420 and 20260619223725 it now reads:
--
--   (deleted_at is null or author_id = (select auth.uid()))
--   and (expires_at > now() or pinned)
--   and athanor.not_blocked(author_id)
--
-- Note the owner arm on soft-delete — it exists so `update … set deleted_at` does not fail
-- 42501. The storage policy deliberately does NOT carry that arm across: the author needs the
-- ROW back to un-delete, never the bytes. The expiry arm has no owner exemption in either place.
--
-- Because a policy expression runs as the calling role, the subquery is additionally filtered by
-- `story_segments_select_live` itself. The explicit predicate is therefore redundant on expiry
-- and pinned, and kept anyway: storage visibility should not depend on another policy staying
-- correct. All of it is asserted behaviourally at the bottom.
--
-- One half of expiry CANNOT be asserted from here, and it is the half that bounds the damage:
-- an RLS predicate runs when a signed URL is MINTED, not when it is used, so a URL signed just
-- before expiry outlives this policy by its whole TTL. That TTL is capped at 5 minutes for this
-- bucket in `apps/native/src/lib/media/signed-url-policy.ts` and asserted in its unit test.
-- Raising it re-opens the hole and nothing here will notice.
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

-- The read policy must actually consult the descriptor row, not merely mention the table.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'story-segments_select_member'
        and not ( qual like '%story_segments%'
              and qual like '%expires_at%'
              and qual like '%pinned%'
              and qual like '%deleted_at%' ) $$,
  'read policy joins story_segments and carries its expiry / pinned / soft-delete predicate'
);

-- The join must bind the object to ITS OWN descriptor. An id parsed out of the key answers
-- «is SOME live segment called this», and since a member may write anywhere under their own uid
-- folder (20260614230533), `{own_uid}/{someone_elses_live_segment_id}.mp4` would then stay
-- readable — including a re-upload of their own just-expired bytes. Matching the stored key is
-- what closes that, and it removes every cast from the predicate in passing.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'story-segments_select_member'
        and qual not like '%storage_path = %name%' $$,
  'read policy matches the object to its own descriptor by storage_path, not by a parsed id'
);

-- ── BEHAVIOUR: who can actually read the bytes ───────────────────────────────────────
set local role authenticated;

-- Seven objects sit under A's prefix: live-unpinned (d.mp4), expired-unpinned (e), expired-
-- pinned (f), soft-deleted (c), a malformed filename, an orphan, and d.jpg — bytes named after
-- a live segment but described by no row. Only (d.mp4) and (f) are ever readable, so the
-- owner-prefix count is 2 for anyone not blocked. Before this change it was 7.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.mp4'),
  1, 'owner reads their own live story segment'
);
-- Expiry binds the AUTHOR too. The table policy's owner exemption covers `deleted_at` only —
-- there is none on the expiry arm, and one here would mean the author still sees a story
-- everyone else was told had gone.
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-00000000000e.mp4'),
  0, 'the author cannot read their OWN expired unpinned segment either'
);

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments' and name like '11111111-%'),
  2, 'an unblocked member reads exactly the live and the pinned segment, and nothing else'
);
-- THE BUG (issue #21): the row disappeared at 24h and the file did not.
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-00000000000e.mp4'),
  0, 'an expired unpinned segment''s FILE is unreadable, not just its row'
);
-- The other direction, which the fix must not break: pinned survives on purpose (PRD §4.5).
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/ffffffff-0000-0000-0000-00000000000f.mp4'),
  1, 'a PINNED segment stays readable past expires_at'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/cccccccc-0000-0000-0000-00000000000c.mp4'),
  0, 'a soft-deleted segment''s file is unreadable while still inside its window'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments' and name = 'not-a-uuid/seg.mp4'),
  0, 'a segment whose first path segment is not a uuid is unreadable'
);
-- Denies rather than raising. The predicate no longer casts the filename at all — it matches
-- the stored key — so 22P02 is structurally impossible rather than merely guarded against; this
-- keeps a witness that a garbage key is answered with a denial, not an aborted query.
select lives_ok(
  $$ select count(*) from storage.objects
      where bucket_id = 'story-segments'
        and name = '11111111-1111-1111-1111-111111111111/not-a-uuid.mp4' $$,
  'a malformed FILENAME denies instead of raising inside USING'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/not-a-uuid.mp4'),
  0, 'a segment whose filename is not a uuid is unreadable'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/0a0a0a0a-0000-0000-0000-00000000000a.mp4'),
  0, 'an orphaned object with no descriptor row is unreadable'
);
-- The unbound-descriptor hole, in one assertion. `.jpg` beside the live segment's `.mp4`: the
-- id in the key names a live segment, but no descriptor points at THIS object.
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'story-segments'
       and name = '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.jpg'),
  0, 'an object named after a LIVE segment but owned by no descriptor row is unreadable'
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
