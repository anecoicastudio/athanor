-- Structural assertions for the candidacy-videos Storage bucket + its RLS policies.
-- Full upload-path role simulation (inserting into storage.objects as an authenticated user
-- with a real JWT and verifying path-segment ownership) needs the Storage sidecar; out of
-- scope here. What we assert deterministically: bucket metadata, pg_policies rows, and the
-- fund_edition_open() read-gate helper (exists + anon cannot execute it).

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok((select not public from storage.buckets where id='candidacy-videos'), 'bucket is private');
select is((select file_size_limit from storage.buckets where id='candidacy-videos'), 209715200::bigint, '200MB limit');
select is((select allowed_mime_types from storage.buckets where id='candidacy-videos'), array['video/mp4','image/jpeg'], 'mp4 video + jpeg poster');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='candidacy_videos_insert_own'), 'insert-own policy');

-- The insert gate must match the candidacy precondition (no orphan blobs): the video write
-- requires identity_verified AND an open edition window, exactly like the row INSERT.
select ok(
  (select with_check from pg_policies
     where schemaname='storage' and tablename='objects'
       and policyname='candidacy_videos_insert_own')
   like '%is_identity_verified%',
  'candidacy video insert gated on identity_verified'
);
select ok(
  (select with_check from pg_policies
     where schemaname='storage' and tablename='objects'
       and policyname='candidacy_videos_insert_own')
   like '%fund_edition_open%',
  'candidacy video insert gated on open window'
);
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='candidacy_videos_update_own'), 'update-own policy (upsert)');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='candidacy_videos_select_members'), 'member-read policy');
select has_function('public', 'fund_edition_open', 'fund_edition_open helper exists');

-- the read gate is members-only: anon must NOT hold execute on it
select ok(
  not has_function_privilege('anon', 'public.fund_edition_open()', 'execute'),
  'anon cannot execute fund_edition_open (read gate is members-only)'
);
select ok(
  has_function_privilege('authenticated', 'public.fund_edition_open()', 'execute'),
  'authenticated can execute fund_edition_open'
);

-- #145 re-audit: DEFINER was never required — fund_editions is world-readable
-- (using (true) + select granted to anon/authenticated since 20260617212319), so
-- 20260813170840 reverted the helper to invoker. Pin it so it cannot silently regress.
select ok(
  (select not p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fund_edition_open'),
  'fund_edition_open is SECURITY INVOKER (#145 — definer rights added nothing)'
);

select * from finish();
rollback;
