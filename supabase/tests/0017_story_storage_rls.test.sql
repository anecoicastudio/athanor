-- Structural assertions for the story-segments Storage bucket + its RLS policies.
-- (Full upload-path role simulation needs the Storage sidecar — out of scope; assert metadata + policies.)

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select is(
  (select public from storage.buckets where id = 'story-segments'),
  false, 'story-segments bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'story-segments'),
  52428800::bigint, 'story-segments file_size_limit = 52428800'
);
select ok(
  'video/mp4' = any((select allowed_mime_types from storage.buckets where id = 'story-segments')),
  'story-segments allowed_mime_types contains video/mp4'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'story-segments_insert_own'),
  'policy story-segments_insert_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'story-segments_update_own'),
  'policy story-segments_update_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'story-segments_delete_own'),
  'policy story-segments_delete_own present'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'story-segments_select_member'),
  'policy story-segments_select_member present'
);

select * from finish();
rollback;
