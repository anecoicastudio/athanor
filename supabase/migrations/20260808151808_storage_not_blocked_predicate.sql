-- Close the M9 deferral on storage.objects.
--
-- 20260614204500_storage_media_buckets.sql and 20260614230533_story_storage_bucket.sql both
-- shipped their SELECT policies as `using (bucket_id = '<bucket>')` and nothing else, with the
-- note "members read (visibility/not_blocked predicates deferred to M9)". M9 landed
-- athanor.not_blocked in 20260619222420 and composed it into the posts / story_segments TABLE
-- policies, but the storage side of that deferral was never closed. Until now a blocked member
-- lost the row and kept the file: any authenticated member could read any object in all three
-- private buckets via a signed URL, including media belonging to someone who had blocked them.
--
-- Owner derivation is the first path segment, the same key the insert/update/delete policies on
-- these buckets already trust:
--   post-media     {uid}/{post_id}/{n}.{ext}
--   moments        {uid}/{moment_id}.{ext}
--   story-segments {uid}/{segment_id}.{ext}
--
-- The uuid-shaped guard runs before the cast so a malformed key can never raise inside a USING
-- clause and abort the caller's query; it simply fails the predicate, which denies. That is the
-- safe direction. athanor.not_blocked is symmetric and true for one's own uid, so an owner keeps
-- access to their own objects.

drop policy if exists "post-media_select_member" on storage.objects;
create policy "post-media_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "moments_select_member" on storage.objects;
create policy "moments_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'moments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "story-segments_select_member" on storage.objects;
create policy "story-segments_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'story-segments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
  );
