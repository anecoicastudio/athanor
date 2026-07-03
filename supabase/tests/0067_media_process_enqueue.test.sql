-- 0067_media_process_enqueue.test.sql
-- P2.2 — the media-process storage enqueue must exist, be locked down, and be a guarded
-- NO-OP while the app.settings.media_process_* GUCs are unset (pre-P1.1-deploy): a user
-- upload must never fail because of the strip backstop.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_function('public', 'enqueue_media_process', 'enqueue_media_process exists');

select is_definer('public', 'enqueue_media_process', 'enqueue fn is SECURITY DEFINER');

select ok(
  not has_function_privilege('authenticated', 'public.enqueue_media_process()', 'execute'),
  'authenticated cannot execute enqueue_media_process directly');

select has_trigger('storage', 'objects', 'media_process_enqueue',
  'media_process_enqueue trigger exists on storage.objects');

-- guarded no-op: with the GUCs unset (test-DB default) an INSERT into a covered bucket
-- succeeds — the trigger never blocks an upload pre-deploy.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('post-media', '00000000-0000-0000-0000-000000000001/p/0.jpg') $$,
  'upload into a covered bucket succeeds with GUCs unset (trigger no-ops)');

-- WHEN clause: non-listed buckets bypass the trigger entirely.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('exports', '00000000-0000-0000-0000-000000000001/export.zip') $$,
  'upload into a non-covered bucket unaffected (WHEN clause filters)');

select * from finish();
rollback;
