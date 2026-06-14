-- Storage buckets for community post media + personal moments. Private (no public read);
-- clients render via short-lived signed URLs. Owner-write keyed on the first path segment
-- = caller uid; members read (visibility/not_blocked predicates deferred to M9). EXIF/GPS
-- is stripped CLIENT-SIDE before upload (resilience §7.2); server-side strip = deferred
-- defense-in-depth (TODO before launch). avatars bucket = later slice (no consumer yet).
-- Path conventions: post-media = {uid}/{post_id}/{n}.{ext}; moments = {uid}/{moment_id}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('post-media', 'post-media', false, 52428800,
     array['image/jpeg','image/png','image/webp','video/mp4','audio/mp4','audio/mpeg']),
  ('moments',    'moments',    false, 52428800,
     array['image/jpeg','image/png','image/webp','video/mp4'])
on conflict (id) do nothing;

create policy "post-media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "post-media_update_own" on storage.objects for update to authenticated
  using      (bucket_id = 'post-media' and (select auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'post-media' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "post-media_delete_own" on storage.objects for delete to authenticated
  using      (bucket_id = 'post-media' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "post-media_select_member" on storage.objects for select to authenticated
  using      (bucket_id = 'post-media');

create policy "moments_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'moments' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "moments_update_own" on storage.objects for update to authenticated
  using      (bucket_id = 'moments' and (select auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'moments' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "moments_delete_own" on storage.objects for delete to authenticated
  using      (bucket_id = 'moments' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "moments_select_member" on storage.objects for select to authenticated
  using      (bucket_id = 'moments');
