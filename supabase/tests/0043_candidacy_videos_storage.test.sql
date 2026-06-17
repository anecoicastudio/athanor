-- Structural assertions for the candidacy-videos Storage bucket + its RLS policies.
-- Full upload-path role simulation (inserting into storage.objects as an authenticated user
-- with a real JWT and verifying path-segment ownership) needs the Storage sidecar; out of
-- scope here. What we assert deterministically: bucket metadata, pg_policies rows, and the
-- fund_edition_open() read-gate helper (exists + anon cannot execute it).

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok((select not public from storage.buckets where id='candidacy-videos'), 'bucket is private');
select is((select file_size_limit from storage.buckets where id='candidacy-videos'), 209715200::bigint, '200MB limit');
select is((select allowed_mime_types from storage.buckets where id='candidacy-videos'), array['video/mp4'], 'mp4 only');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='candidacy_videos_insert_own'), 'insert-own policy');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='candidacy_videos_update_own'), 'update-own policy (upsert)');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='candidacy_videos_select_members'), 'member-read policy');
select has_function('public', 'fund_edition_open', 'fund_edition_open helper exists');

-- the read gate is members-only: anon must NOT hold execute on it
select ok(
  not has_function_privilege('anon', 'public.fund_edition_open()', 'execute'),
  'anon cannot execute fund_edition_open (read gate is members-only)'
);

select * from finish();
rollback;
