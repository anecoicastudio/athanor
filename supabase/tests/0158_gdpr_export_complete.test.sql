-- #784 — the complete export and its 7-day retention (20260925154710).
--
-- What SQL owns of the change, asserted here; the archive builder itself is Deno and is pinned by
-- supabase/functions/gdpr-export-job/logic.test.ts:
--   §1 the exports bucket accepts the largest member upload;
--   §2 gdpr_export_media lists the member's own media — six buckets, not exports, not anyone
--      else's — and pages on (bucket_id, name);
--   §3 gdpr_export_reap_candidates lists an archive whose window has closed and never one that is
--      still live or still being built;
--   §4 gdpr_export_reap_jobs deletes the expired rows and nothing else;
--   and the row shape the app reads is unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '26000000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'export_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '26000000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'export_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '26000000-0000-0000-0000-0000000000cc',
   'authenticated', 'authenticated', 'export_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── §1 ─────────────────────────────────────────────────────────────────────────────────────
select is(
  (select file_size_limit from storage.buckets where id = 'exports'),
  209715200::bigint,
  'exports accepts a 200 MiB object — a copied candidacy video fits');

-- ── the three functions: invoker, service_role only ────────────────────────────────────────
select ok(
  (select bool_and(not p.prosecdef)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('gdpr_export_media', 'gdpr_export_reap_candidates', 'gdpr_export_reap_jobs')),
  'all three are SECURITY INVOKER');
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('gdpr_export_media', 'gdpr_export_reap_candidates', 'gdpr_export_reap_jobs')),
  3, 'all three exist');
select ok(not has_function_privilege('anon', 'public.gdpr_export_media(uuid, text, text, int)', 'execute'),
  'anon cannot list anyone''s media');
select ok(not has_function_privilege('authenticated', 'public.gdpr_export_media(uuid, text, text, int)', 'execute'),
  'a member cannot list media through the export function');
select ok(has_function_privilege('service_role', 'public.gdpr_export_media(uuid, text, text, int)', 'execute'),
  'service_role lists media');
select ok(not has_function_privilege('authenticated', 'public.gdpr_export_reap_candidates(integer, interval)', 'execute'),
  'a member cannot enumerate the exports bucket');
select ok(has_function_privilege('service_role', 'public.gdpr_export_reap_candidates(integer, interval)', 'execute'),
  'service_role lists reap candidates');
select ok(not has_function_privilege('authenticated', 'public.gdpr_export_reap_jobs()', 'execute'),
  'a member cannot reap export rows');
select ok(not has_function_privilege('anon', 'public.gdpr_export_reap_jobs()', 'execute'),
  'anon cannot reap export rows');
select ok(has_function_privilege('service_role', 'public.gdpr_export_reap_jobs()', 'execute'),
  'service_role reaps export rows');

-- ── §2 the member's own media ──────────────────────────────────────────────────────────────
insert into storage.objects (bucket_id, name, metadata) values
  ('avatars',          '26000000-0000-0000-0000-0000000000aa/me.jpg', '{"size": 100, "mimetype": "image/jpeg"}'),
  ('post-media',       '26000000-0000-0000-0000-0000000000aa/p1/0.jpg', '{"size": 200, "mimetype": "image/jpeg"}'),
  ('moments',          '26000000-0000-0000-0000-0000000000aa/m1.jpg', null),
  ('story-segments',   '26000000-0000-0000-0000-0000000000aa/s1.mp4', null),
  ('candidacy-videos', '26000000-0000-0000-0000-0000000000aa/c1.mp4', null),
  ('chat-media',       '26000000-0000-0000-0000-0000000000aa/cv1/m1.jpg', null),
  -- not listed: the member's previous archive, and the other member's chat image
  ('exports',          '26000000-0000-0000-0000-0000000000aa/old/archive.json', null),
  ('chat-media',       '26000000-0000-0000-0000-0000000000bb/cv1/m2.jpg', null);

select results_eq(
  $$ select bucket_id, name from public.gdpr_export_media('26000000-0000-0000-0000-0000000000aa') $$,
  $$ values
       ('avatars'::text,          '26000000-0000-0000-0000-0000000000aa/me.jpg'::text),
       ('candidacy-videos',       '26000000-0000-0000-0000-0000000000aa/c1.mp4'),
       ('chat-media',             '26000000-0000-0000-0000-0000000000aa/cv1/m1.jpg'),
       ('moments',                '26000000-0000-0000-0000-0000000000aa/m1.jpg'),
       ('post-media',             '26000000-0000-0000-0000-0000000000aa/p1/0.jpg'),
       ('story-segments',         '26000000-0000-0000-0000-0000000000aa/s1.mp4') $$,
  'one object per media bucket, ordered — never exports, never another member''s upload');
select is(
  (select size from public.gdpr_export_media('26000000-0000-0000-0000-0000000000aa')
    where bucket_id = 'post-media'),
  200::bigint, 'size comes from the object metadata');
select is(
  (select size from public.gdpr_export_media('26000000-0000-0000-0000-0000000000aa')
    where bucket_id = 'moments'),
  null::bigint, 'an object with no recorded size reports null, not zero');
select results_eq(
  $$ select name from public.gdpr_export_media('26000000-0000-0000-0000-0000000000aa', null, null, 2) $$,
  $$ values ('26000000-0000-0000-0000-0000000000aa/me.jpg'::text),
            ('26000000-0000-0000-0000-0000000000aa/c1.mp4') $$,
  'p_limit bounds the page');
select results_eq(
  $$ select name from public.gdpr_export_media('26000000-0000-0000-0000-0000000000aa',
       'chat-media', '26000000-0000-0000-0000-0000000000aa/cv1/m1.jpg') $$,
  $$ values ('26000000-0000-0000-0000-0000000000aa/m1.jpg'::text),
            ('26000000-0000-0000-0000-0000000000aa/p1/0.jpg'),
            ('26000000-0000-0000-0000-0000000000aa/s1.mp4') $$,
  'the cursor resumes strictly after (bucket, name)');
select is(
  (select count(*)::int from public.gdpr_export_media('26000000-0000-0000-0000-0000000000aa',
       'story-segments', '26000000-0000-0000-0000-0000000000aa/s1.mp4')),
  0, 'past the last object the page is empty — the job''s stop signal');

-- ── §3 + §4 fixtures: one job per retention case ───────────────────────────────────────────
-- created 8 days ago unless the case needs otherwise; expires_at inside the 30-day cap.
insert into public.gdpr_export_jobs (id, profile_id, status, download_url, expires_at, created_at, updated_at) values
  -- ready, link expired a minute ago → reaped (row + objects)
  ('26100000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000aa', 'ready',
   'https://x', now() - interval '1 minute', now() - interval '8 days', now() - interval '8 days'),
  -- ready, link live for 6 more days → kept
  ('26100000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-0000000000aa', 'ready',
   'https://x', now() + interval '6 days', now() - interval '1 day', now() - interval '1 day'),
  -- processing (a requeued build with media already copied) → kept, however old
  ('26100000-0000-0000-0000-000000000003', '26000000-0000-0000-0000-0000000000aa', 'processing',
   null, null, now() - interval '9 days', now() - interval '9 days'),
  -- failed, untouched for 8 days → reaped
  ('26100000-0000-0000-0000-000000000004', '26000000-0000-0000-0000-0000000000aa', 'failed',
   null, null, now() - interval '9 days', now() - interval '8 days'),
  -- failed yesterday → kept, the member is still reading «we couldn't prepare it»
  ('26100000-0000-0000-0000-000000000005', '26000000-0000-0000-0000-0000000000aa', 'failed',
   null, null, now() - interval '2 days', now() - interval '1 day'),
  -- requested → kept (member b: one open job per member since 20260925161119, and a holds 0003)
  ('26100000-0000-0000-0000-000000000006', '26000000-0000-0000-0000-0000000000bb', 'requested',
   null, null, now() - interval '10 days', now() - interval '10 days'),
  -- a pre-#784 archive: ready, its 72-hour link long dead → reaped
  ('26100000-0000-0000-0000-000000000007', '26000000-0000-0000-0000-0000000000aa', 'ready',
   'https://x', now() - interval '17 days', now() - interval '20 days', now() - interval '20 days');

-- objects, all older than the 1-hour grace except the last
insert into storage.objects (bucket_id, name, created_at, updated_at) values
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-000000000001/archive.json', now() - interval '8 days', now() - interval '8 days'),
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-000000000001/media/post-media/p1/0.jpg', now() - interval '8 days', now() - interval '8 days'),
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-000000000002/archive.json', now() - interval '1 day', now() - interval '1 day'),
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-000000000003/media/avatars/me.jpg', now() - interval '9 days', now() - interval '9 days'),
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-000000000004/media/avatars/me.jpg', now() - interval '8 days', now() - interval '8 days'),
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-000000000006/media/avatars/me.jpg', now() - interval '2 hours', now() - interval '2 hours'),
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-000000000007.json', now() - interval '20 days', now() - interval '20 days'),
  -- an orphan: no job row at all
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-0000000000ff.json', now() - interval '3 days', now() - interval '3 days'),
  -- an orphan uploaded moments ago: inside the grace
  ('exports', '26000000-0000-0000-0000-0000000000aa/26100000-0000-0000-0000-0000000000fe/archive.json', now(), now());

-- ── §3 which objects ───────────────────────────────────────────────────────────────────────
create temp table reap_listed as
  select name from public.gdpr_export_reap_candidates();

select ok(
  exists (select 1 from reap_listed where name like '%/26100000-0000-0000-0000-000000000001/archive.json')
  and exists (select 1 from reap_listed where name like '%/26100000-0000-0000-0000-000000000001/media/%'),
  'an archive older than its 7-day link is listed — the JSON and its media');
select ok(
  not exists (select 1 from reap_listed where name like '%/26100000-0000-0000-0000-000000000002/%'),
  'a younger archive, its link still live, is NOT listed');
select ok(
  not exists (select 1 from reap_listed
               where name like '%/26100000-0000-0000-0000-000000000003/%'
                  or name like '%/26100000-0000-0000-0000-000000000006/%'),
  'a job still being built (processing or requested) keeps its copies, however old they are');
select ok(
  exists (select 1 from reap_listed where name like '%/26100000-0000-0000-0000-000000000004/%'),
  'a failed job''s leftovers are listed');
select ok(
  exists (select 1 from reap_listed where name like '%/26100000-0000-0000-0000-000000000007.json')
  and exists (select 1 from reap_listed where name like '%/26100000-0000-0000-0000-0000000000ff.json'),
  'a pre-#784 {uid}/{job}.json archive past its link is listed, and so is an object with no row');
select ok(
  not exists (select 1 from reap_listed where name like '%/26100000-0000-0000-0000-0000000000fe/%'),
  'an object inside the grace is not listed, row or no row');

-- ── §4 which rows ──────────────────────────────────────────────────────────────────────────
select is(public.gdpr_export_reap_jobs(), 3,
  'three rows reaped: the expired ready, the pre-#784 ready, the week-old failed');
select results_eq(
  $$ select id::text from public.gdpr_export_jobs
      where profile_id in ('26000000-0000-0000-0000-0000000000aa', '26000000-0000-0000-0000-0000000000bb')
      order by id $$,
  $$ values ('26100000-0000-0000-0000-000000000002'::text),
            ('26100000-0000-0000-0000-000000000003'),
            ('26100000-0000-0000-0000-000000000005'),
            ('26100000-0000-0000-0000-000000000006') $$,
  'a live link, the queue, and a fresh failure survive');

-- ── 20260925161119: one open job per member, and a ready row with no expiry is reaped ──────
-- 0003 (processing) is still open for member a after the reap above.
select throws_ok(
  $$ insert into public.gdpr_export_jobs (profile_id) values ('26000000-0000-0000-0000-0000000000aa') $$,
  '23505', null,
  'a second open export job for the same member is refused (each job copies the whole library)');
update public.gdpr_export_jobs set status = 'failed' where id = '26100000-0000-0000-0000-000000000003';
select lives_ok(
  $$ insert into public.gdpr_export_jobs (profile_id) values ('26000000-0000-0000-0000-0000000000aa') $$,
  'once the open job is terminal, the member can ask again');
select lives_ok(
  $$ insert into public.gdpr_export_jobs (profile_id) values ('26000000-0000-0000-0000-0000000000cc') $$,
  'another member can still open theirs');

insert into public.gdpr_export_jobs (id, profile_id, status, download_url, expires_at, created_at, updated_at) values
  ('26100000-0000-0000-0000-000000000008', '26000000-0000-0000-0000-0000000000bb', 'ready',
   'https://x', null, now() - interval '1 day', now() - interval '1 day');
-- Two statements: a subquery in the same statement as the delete reads the pre-delete snapshot.
select ok(public.gdpr_export_reap_jobs() >= 1, 'the reap runs and deletes');
select ok(
  not exists (select 1 from public.gdpr_export_jobs where id = '26100000-0000-0000-0000-000000000008'),
  'a ready row with no expiry is reaped — the object predicate already treats it as unprotected');

-- ── the app's row shape is unchanged ───────────────────────────────────────────────────────
select columns_are('public', 'gdpr_export_jobs',
  array['id', 'profile_id', 'status', 'download_url', 'expires_at', 'created_at', 'updated_at', 'claimed_at'],
  'gdpr_export_jobs keeps the columns the app and packages/schemas read');

select * from finish();
rollback;
