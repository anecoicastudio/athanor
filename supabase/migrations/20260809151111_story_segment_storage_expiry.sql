-- Close the expiry half of the story-segment storage gap (issue #21).
--
-- 20260808151808_storage_not_blocked_predicate.sql closed the BLOCKED-USER half of the M9
-- deferral on storage.objects: a blocked member lost the row and kept the file. It did not
-- close the EXPIRY half, which was recorded in the same deferral and is still open.
--
-- The table policy hides an expired segment. Its CURRENT text, after three amendments
-- (20260616083015 owner soft-delete, 20260619222420 blocks, 20260619223725 restore-owner) is:
--
--   (deleted_at is null or author_id = (select auth.uid()))
--   and (expires_at > now() or pinned)
--   and athanor.not_blocked(author_id)
--
-- The storage-object policy had no expiry predicate at all, so at 24h the row disappeared and
-- the file did not. Any authenticated member holding the object path — or a signed URL minted
-- before expiry — kept reading it. PRD §4.5 treats the 24h window as a promise, and `pinned` is
-- precisely the opt-in for the segments meant to outlive it, so an unpinned segment surviving
-- is that promise being broken silently.
--
-- ── Why `s.storage_path = name` and not a segment id parsed out of the key ──────────────────
--
-- The obvious predicate parses the id from the filename and casts it. Two reasons not to:
--
--   1. `storage.foldername()` returns the path parts EXCLUDING the file name — that is why
--      `storage.filename()` exists beside it. For this bucket's `{uid}/{segment_id}.{ext}` keys
--      the array has ONE element, so `[2]` is NULL, `split_part(NULL, …)` is NULL, and a
--      predicate built on it denies every object in the bucket. The existing policies only ever
--      index `[1]`, where both readings agree, so they prove nothing about `[2]`.
--   2. An id parsed from the key answers «is SOME live segment called this», not «is THIS
--      object's descriptor live». A member may write anywhere under their own uid folder
--      (20260614230533), so `{own_uid}/{someone_elses_live_segment_id}.mp4` would have stayed
--      readable for as long as that unrelated segment lived — including a re-upload of their
--      own just-expired bytes, which is exactly the promise this migration exists to keep.
--
-- Matching the column the row already stores answers the right question, binds the object to
-- ITS descriptor, and removes both casts — so no malformed key can raise 22P02 from inside a
-- USING clause and abort the caller's whole query. There is nothing left to guard.
--
-- The owner-folder guard and `athanor.not_blocked` are carried over verbatim from
-- 20260808151808 so this migration cannot regress it.
--
-- ── Redundancy, deliberately ────────────────────────────────────────────────────────────────
--
-- A policy expression runs as the calling role and referenced tables' own policies apply, so
-- the subquery is ALREADY filtered by `story_segments_select_live`. The explicit predicate is
-- therefore redundant on expiry and on pinned — kept anyway, because storage visibility should
-- not depend on another policy staying correct, and because it differs on one arm on purpose:
-- the table policy exempts the AUTHOR from `deleted_at` (they need the row back to un-delete),
-- and this one does not. A segment the author took down loses its bytes for the author too.
--
-- ── The half no SQL can enforce ─────────────────────────────────────────────────────────────
--
-- An RLS predicate is evaluated when a signed URL is MINTED, not when it is used. A URL signed
-- one minute before expiry outlives this policy by its whole TTL. `signMediaUrls` therefore
-- caps `story-segments` at 5 minutes (`packages/api/src/storage.ts`, `BUCKET_URL_TTL`), so the
-- residual window is ~5 min rather than the 1h default. That number and this predicate are two
-- halves of one guarantee: raising the TTL re-opens the hole, and nothing here will notice.
--
-- ── Still open, deliberately ────────────────────────────────────────────────────────────────
--
-- This hides the bytes; it does not delete them. 20260614230935_prune_expired_stories.sql
-- soft-deletes rows only, and no object reaper exists — so an expired segment's media stays in
-- the bucket, invisible to clients but real for storage cost and for retention accounting.
-- Tracked separately; do not read issue #21 as covering deletion.

-- The join is by key, so it needs its own index; the PK does not serve it.
create unique index if not exists story_segments_storage_path
  on public.story_segments (storage_path);

drop policy if exists "story-segments_select_member" on storage.objects;
create policy "story-segments_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'story-segments'
    -- owner uid — the folder, unchanged from 20260808151808
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    -- this object's own descriptor row, still readable
    and exists (
      select 1 from public.story_segments s
      where s.storage_path = name
        and s.deleted_at is null
        and (s.expires_at > now() or s.pinned)
    )
  );

-- NO `comment on policy … on storage.objects` here, and the omission is the point: COMMENT
-- requires ownership of the relation, and `storage.objects` is owned by supabase_storage_admin,
-- not by the postgres role migrations run as. CREATE/DROP POLICY on it is granted; COMMENT is
-- not, and the statement fails the whole migration with
--
--   ERROR: must be owner of relation objects (SQLSTATE 42501)
--
-- which is exactly what it did in CI. No other storage migration in this repo comments a
-- policy, so there was no precedent to copy. The prose it would have carried is the header
-- above; keep the two in step by editing that.
