-- Storage bucket for story segments. Private (no public read); clients render via short-lived
-- signed URLs. Owner-write keyed on the first path segment = caller uid; members read
-- (visibility/not_blocked predicates deferred to M9). EXIF/GPS is stripped CLIENT-SIDE before
-- upload (resilience §7.2); server-side strip = deferred defense-in-depth (launch-blocker TODO).
-- Path convention: story-segments = {uid}/{segment_id}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('story-segments', 'story-segments', false, 52428800,
     array['image/jpeg','image/png','image/webp','video/mp4'])
on conflict (id) do nothing;

create policy "story-segments_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'story-segments' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "story-segments_update_own" on storage.objects for update to authenticated
  using      (bucket_id = 'story-segments' and (select auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'story-segments' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "story-segments_delete_own" on storage.objects for delete to authenticated
  using      (bucket_id = 'story-segments' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "story-segments_select_member" on storage.objects for select to authenticated
  using      (bucket_id = 'story-segments');
