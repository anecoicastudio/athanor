-- Structural assertions for post-media and moments Storage buckets + their RLS policies.
-- Full upload-path role simulation (i.e. actually inserting into storage.objects as an
-- authenticated user with a real JWT and verifying path-segment ownership) is out of scope
-- for this structural test — it requires the GoTrue+Storage sidecar to be running with a
-- real bucket. What we CAN assert deterministically: bucket metadata and pg_policies rows.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- 1. post-media bucket exists and is private
select is(
  (select public from storage.buckets where id = 'post-media'),
  false,
  'post-media bucket is private'
);

-- 2. moments bucket exists and is private
select is(
  (select public from storage.buckets where id = 'moments'),
  false,
  'moments bucket is private'
);

-- 3. post-media file_size_limit = 50 MB
select is(
  (select file_size_limit from storage.buckets where id = 'post-media'),
  52428800::bigint,
  'post-media file_size_limit = 52428800'
);

-- 4. moments allowed_mime_types contains video/mp4
select ok(
  'video/mp4' = any((select allowed_mime_types from storage.buckets where id = 'moments')),
  'moments allowed_mime_types contains video/mp4'
);

-- 4b. moments file_size_limit = 50 MB (symmetry with post-media)
select is(
  (select file_size_limit from storage.buckets where id = 'moments'),
  52428800::bigint,
  'moments file_size_limit = 52428800'
);

-- 4c. post-media accepts audio (the only bucket that does)
select ok(
  'audio/mpeg' = any((select allowed_mime_types from storage.buckets where id = 'post-media')),
  'post-media allowed_mime_types contains audio/mpeg'
);

-- 5–12. Each of the 8 storage RLS policies exists on storage.objects
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post-media_insert_own'),
  'policy post-media_insert_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post-media_update_own'),
  'policy post-media_update_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post-media_delete_own'),
  'policy post-media_delete_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post-media_select_member'),
  'policy post-media_select_member present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'moments_insert_own'),
  'policy moments_insert_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'moments_update_own'),
  'policy moments_update_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'moments_delete_own'),
  'policy moments_delete_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'moments_select_member'),
  'policy moments_select_member present'
);

select * from finish();
rollback;
