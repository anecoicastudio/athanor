-- Post-media bytes reaper (#589): the byte side of the composer's publish path.
--
-- `publish_post` (20260828083140, #588) writes a post and its media set in one transaction and
-- deletes every `post_media` row the new set does not fill, so the ROWS are exactly right. Its
-- header names what it leaves: "The BYTES are not swept." 20260828103400 adds the part that
-- sweeps them. Deletion goes through the Storage API (the edge function), so what SQL owns —
-- and what this file asserts — is the candidate predicate `post_media_reap_candidates`, the
-- pg_net caller, and the new nightly job.
--
-- The predicate is "no `post_media` row references this object, from EITHER column, and it has
-- not been touched for p_grace". Each clause is a fixture row below, and the two that would be
-- silent regressions get named cases of their own:
--
--   * a live video's POSTER is referenced through `thumb_path`, not `storage_path`. A
--     predicate that diffed on `storage_path` alone would list every poster in the bucket and
--     delete it — every feed video back to a bare ▶, the defect #318 closed.
--   * a RETRY re-uploads to the same key, and storage-api overwrites in place without moving
--     `created_at`. The age term therefore reads `greatest(created_at, updated_at)`, so a
--     re-upload resets the clock and a pass running between a retry's upload and its write
--     cannot delete the bytes the row is about to describe.
--
-- §5 drives the REAL write path rather than hand-deleting rows: two calls to `publish_post` as
-- the author, the second with a shorter set, and the objects the sweep orphaned become
-- candidates. That is the link between the two halves — if `publish_post` ever stops sweeping,
-- or sweeps differently, this notices.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ── 1. the candidate enumeration: shape and grants ───────────────────────────
select has_function('public', 'post_media_reap_candidates', array['integer', 'interval'],
  'post_media_reap_candidates(p_limit, p_grace) exists');
select isnt_definer('public', 'post_media_reap_candidates', array['integer', 'interval'],
  'post_media_reap_candidates is security INVOKER — service_role needs no definer rights (the 20260821082216 correction)');
select is(
  (select proconfig from pg_proc
    where oid = 'public.post_media_reap_candidates(integer, interval)'::regprocedure),
  array['search_path=""'], 'post_media_reap_candidates locks search_path to empty');
select volatility_is('public', 'post_media_reap_candidates', array['integer', 'interval'], 'stable',
  'post_media_reap_candidates is STABLE: it lists, the Storage API deletes');
select ok(not has_function_privilege('anon', 'public.post_media_reap_candidates(integer, interval)', 'execute'),
  'anon cannot enumerate reap candidates');
select ok(not has_function_privilege('authenticated', 'public.post_media_reap_candidates(integer, interval)', 'execute'),
  'authenticated cannot enumerate reap candidates');
select ok(not has_function_privilege('public', 'public.post_media_reap_candidates(integer, interval)', 'execute'),
  'public cannot enumerate reap candidates');
select ok(has_function_privilege('service_role', 'public.post_media_reap_candidates(integer, interval)', 'execute'),
  'service_role — the reaper''s client — can');

-- The predicate is an anti-join on two columns; without these it is a seq scan of post_media
-- per candidate object, and neither the PK nor post_media_post_position answers it.
select ok(
  (select indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'post_media'
      and indexname = 'post_media_storage_path_idx') like '%(storage\_path)%',
  'post_media indexes storage_path — the first arm of the anti-join');
-- Partial, and the predicate is asserted rather than just the column: thumb_path is null for
-- every image and audio row, so a full index would be mostly dead entries.
select ok(
  (select indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'post_media'
      and indexname = 'post_media_thumb_path_idx') like '%(thumb\_path) WHERE (thumb\_path IS NOT NULL)',
  'post_media indexes thumb_path, partially — the second arm, which posters are found through');

-- ── 2. the pg_net caller ─────────────────────────────────────────────────────
select has_function('public', 'invoke_post_media_reaper', array[]::text[],
  'invoke_post_media_reaper exists');
select is_definer('public', 'invoke_post_media_reaper', array[]::text[],
  'invoke_post_media_reaper is security definer (posts HTTP only, like every pg_net caller)');
select is(
  (select proconfig from pg_proc where oid = 'public.invoke_post_media_reaper()'::regprocedure),
  array['search_path=""'], 'invoke_post_media_reaper locks search_path to empty');
select ok(not has_function_privilege('anon', 'public.invoke_post_media_reaper()', 'execute'),
  'anon cannot invoke the reaper');
select ok(not has_function_privilege('authenticated', 'public.invoke_post_media_reaper()', 'execute'),
  'authenticated cannot invoke the reaper');
select ok(not has_function_privilege('public', 'public.invoke_post_media_reaper()', 'execute'),
  'public cannot invoke the reaper');
-- resolves config through the resolver, so a Vault rotation is picked up (rule 8) …
select ok(
  (select prosrc from pg_proc where oid = 'public.invoke_post_media_reaper()'::regprocedure)
    like '%runtime_setting%',
  'the caller resolves url/key through athanor.runtime_setting');
-- … and presents it on the apikey header, never a hand-built Authorization bearer.
select ok(
  (select prosrc from pg_proc where oid = 'public.invoke_post_media_reaper()'::regprocedure)
    like '%edge_auth_headers%',
  'the caller builds headers through athanor.edge_auth_headers');

-- ── fixtures (postgres, before any role switch) ──────────────────────────────
-- One author. handle_new_user auto-creates the profile, which #106's active_write_* net needs
-- in §5.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'reaper_pm@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- P1 is a live post whose current set is one image at 0 and one video at 1 (with a poster).
-- P2 is soft-deleted and keeps its row and its bytes, on purpose.
insert into public.posts (id, author_id, category, type, body)
values ('aaaaaaaa-0000-0000-0000-0000000000a1',
        '11111111-1111-1111-1111-111111111111', 'human', 'video', 'Il passo con media');
insert into public.posts (id, author_id, category, type, body, deleted_at)
values ('cccccccc-0000-0000-0000-0000000000c2',
        '11111111-1111-1111-1111-111111111111', 'human', 'image', 'Un passo ritirato',
        now() - interval '10 days');

insert into public.post_media (post_id, kind, storage_path, thumb_path, "position") values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'image',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0.jpg', null, 0),
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'video',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/1.mp4',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/1-thumb.jpg', 1),
  ('cccccccc-0000-0000-0000-0000000000c2', 'image',
   '11111111-1111-1111-1111-111111111111/cccccccc-0000-0000-0000-0000000000c2/0.jpg', null, 0);

-- Objects. SQL cannot upload, so the bucket is populated directly; every row carries an
-- explicit created_at AND updated_at so the age term is under test and never "now()".
insert into storage.objects (bucket_id, name, owner_id, created_at, updated_at) values
  -- R1/R2/R3 — the live set: an image, a video, and the video's POSTER (thumb_path).
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days'),
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/1.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days'),
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/1-thumb.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days'),
  -- O1 — superseded TAIL: position 2 existed in a previous set, the sweep dropped its row.
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/2.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days'),
  -- O2/O3 — superseded KIND CHANGE at position 0: the old mp4 and its poster, left beside the
  -- 0.jpg that replaced them. Two objects for one position, which is why thumb_path matters.
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days'),
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0-thumb.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days'),
  -- O4 — ABANDONED: a draft whose post row never existed. 40 days: the oldest candidate.
  ('post-media', '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-0000000000d4/0.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '40 days', now() - interval '40 days'),
  -- O5 — an upload IN FLIGHT: the composer uploads before it writes, so ten minutes with no
  -- row is a healthy publish, not garbage.
  ('post-media', '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-0000000000d4/1.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '10 minutes', now() - interval '10 minutes'),
  -- O6 — a RETRY: uploaded 30 days ago, re-uploaded to the same key ten minutes ago. upsert
  -- overwrites in place and leaves created_at alone, so only updated_at shows the retry.
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/9.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '10 minutes'),
  -- O7 — neither timestamp: an object whose age cannot be established.
  ('post-media', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/8.jpg',
   '11111111-1111-1111-1111-111111111111', null, null),
  -- S1 — the SOFT-DELETED post's image. Its row survives, so its bytes do too (a deliberate
  -- non-goal: freeing them is irreversible, and refresh-staging.sql revives seeded posts).
  ('post-media', '11111111-1111-1111-1111-111111111111/cccccccc-0000-0000-0000-0000000000c2/0.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days'),
  -- M1 — another bucket entirely, unreferenced and old: not this reaper's business.
  ('moments', '11111111-1111-1111-1111-111111111111/0m0m0m0m-0000-0000-0000-00000000000m.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '30 days');

-- ── 3. the predicate, row by row (default grace = 1 hour) ────────────────────
-- Scoped to the fixture owner folder. On a populated stack the bucket legitimately holds
-- other members' orphans — staging had two the moment this landed, which is the defect itself
-- — so an unscoped set_eq would assert the state of the world rather than the predicate.
create temporary view reap as
  select name from public.post_media_reap_candidates(1000)
   where name like '11111111-1111-1111-1111-111111111111/%';

select is((select count(*)::int from reap where name like '%a1/0.jpg'), 0,
  'R1 referenced by storage_path → not a candidate');
select is((select count(*)::int from reap where name like '%a1/1.mp4'), 0,
  'R2 a live video → not a candidate');
select is((select count(*)::int from reap where name like '%a1/1-thumb.jpg'), 0,
  'R3 a live video''s POSTER, referenced only through thumb_path → never a candidate');
select is((select count(*)::int from reap where name like '%a1/2.jpg'), 1,
  'O1 a superseded tail position → candidate');
select is((select count(*)::int from reap where name like '%a1/0.mp4'), 1,
  'O2 the old key at a position whose kind changed → candidate');
select is((select count(*)::int from reap where name like '%a1/0-thumb.jpg'), 1,
  'O3 the orphaned poster of that former video → candidate');
select is((select count(*)::int from reap where name like '%d4/0.jpg'), 1,
  'O4 an abandoned draft''s bytes, no post row at all → candidate');
select is((select count(*)::int from reap where name like '%d4/1.jpg'), 0,
  'O5 uploaded 10 min ago with no row → not a candidate: the composer uploads before it writes');
select is((select count(*)::int from reap where name like '%a1/9.jpg'), 0,
  'O6 re-uploaded 10 min ago to a 30-day-old key → not a candidate: greatest(created_at, updated_at)');
select is((select count(*)::int from reap where name like '%a1/8.jpg'), 0,
  'O7 neither timestamp → never a candidate: an age that cannot be established is not old');
select is((select count(*)::int from reap where name like '%c2/0.jpg'), 0,
  'S1 a soft-deleted post keeps its row, so it keeps its bytes — a deliberate non-goal');
select is((select count(*)::int from reap where name like '%0m0m0m0m%'), 0,
  'M1 an object in the moments bucket → not this reaper''s');

select set_eq(
  $$ select name from reap $$,
  array[
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/2.jpg',
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0.mp4',
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0-thumb.jpg',
    '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-0000000000d4/0.jpg'
  ]::text[],
  'the candidate set is exactly {O1, O2, O3, O4} and nothing else');

-- limit and order: oldest object first, clamped to at least one.
-- Emission order, read through row_number() rather than through `p_limit = 1`: the function
-- orders the WHOLE bucket, so on a populated stack the single oldest row belongs to whoever
-- has the oldest orphan. What is under test is that the fixtures come out oldest-first.
select is(
  (with c as (select name, row_number() over () as rn
                from public.post_media_reap_candidates(1000))
   select name from c where name like '11111111-1111-1111-1111-111111111111/%' order by rn limit 1),
  '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-0000000000d4/0.jpg',
  'the oldest fixture candidate (40 days) is emitted first — the backlog drains in order');
select is((select count(*)::int from public.post_media_reap_candidates(0)), 1,
  'p_limit = 0 is clamped to 1 — a zero never means "everything"');
select ok((select count(*) from public.post_media_reap_candidates(5000)) <= 1000,
  'p_limit above the Storage API ceiling is clamped to it, not honoured');

-- At grace 0 the in-flight upload and the retry join the set; nothing else moves. That is the
-- grace doing exactly one job — protecting a write that has not landed yet — and not hiding a
-- disagreement about what is referenced.
select set_eq(
  $$ select name from public.post_media_reap_candidates(1000, interval '0')
      where name like '11111111-1111-1111-1111-111111111111/%' $$,
  array[
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/2.jpg',
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0.mp4',
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/0-thumb.jpg',
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-0000000000a1/9.jpg',
    '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-0000000000d4/0.jpg',
    '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-0000000000d4/1.jpg'
  ]::text[],
  'at grace 0 exactly the in-flight upload and the retry join the set — O7 and S1 still do not');

-- ── 4. the caller degrades quietly while unconfigured ────────────────────────
-- No GUC, no Vault row on this stack: runtime_setting returns NULL and the guard must TAKE the
-- no-op branch — `if v_url is null or …` tests NULL explicitly, where a bare `if v_url <> ''`
-- would be NULL → not true → fall THROUGH to http_post.
select lives_ok(
  $$ select public.invoke_post_media_reaper() $$,
  'the caller no-ops with no Vault pair — no error loop on a fresh stack or before the rider');
-- Half-configured is still unconfigured: url present, key absent → same quiet no-op.
select set_config('app.settings.post_media_reaper_url', 'http://localhost:1/x', true);
select lives_ok(
  $$ select public.invoke_post_media_reaper() $$,
  'url set but key absent → still a no-op, never an unauthenticated post');
select set_config('app.settings.post_media_reaper_url', '', true);

-- ── 5. the real write path: publish_post's sweep feeds the reaper ────────────
-- Not a hand-deleted row. The author publishes a two-item set and then a one-item set, and the
-- objects the sweep orphaned must become candidates — the join between #588's row half and
-- this byte half, asserted through the function members actually call.
insert into storage.objects (bucket_id, name, owner_id, created_at, updated_at) values
  ('post-media', '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/0.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '2 days', now() - interval '2 days'),
  ('post-media', '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/1.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '2 days', now() - interval '2 days'),
  ('post-media', '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/1-thumb.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '2 days', now() - interval '2 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.publish_post(
       p_category => 'human',
       p_body     => 'Due media',
       p_id       => 'eeeeeeee-0000-0000-0000-0000000000e3',
       p_type     => 'video',
       p_media    => '[{"kind":"image","storage_path":"11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/0.jpg","position":0},
                       {"kind":"video","storage_path":"11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/1.mp4","thumb_path":"11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/1-thumb.jpg","position":1}]'::jsonb
     ) $$,
  'the author publishes a two-item set through publish_post');
reset role;

select is(
  (select count(*)::int from public.post_media_reap_candidates(1000, interval '0')
    where name like '11111111-1111-1111-1111-111111111111/eeeeeeee-%'),
  0, 'while both positions are referenced, none of the three objects is a candidate');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.publish_post(
       p_category => 'human',
       p_body     => 'Solo la foto',
       p_id       => 'eeeeeeee-0000-0000-0000-0000000000e3',
       p_type     => 'image',
       p_media    => '[{"kind":"image","storage_path":"11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/0.jpg","position":0}]'::jsonb
     ) $$,
  'the author republishes with position 1 removed — publish_post sweeps that row');
reset role;

select is(
  (select count(*)::int from public.post_media where post_id = 'eeeeeeee-0000-0000-0000-0000000000e3'),
  1, 'the row half is exactly right: one media row survives (#588)');
select set_eq(
  $$ select name from public.post_media_reap_candidates(1000, interval '0')
      where name like '11111111-1111-1111-1111-111111111111/eeeeeeee-%' $$,
  array[
    '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/1.mp4',
    '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-0000000000e3/1-thumb.jpg'
  ]::text[],
  'the byte half follows: the swept position''s video AND its poster are now candidates, the surviving image is not');

-- ── 6. the schedule ──────────────────────────────────────────────────────────
select is((select count(*)::int from cron.job where jobname = 'reap-post-media-bytes'), 1,
  'exactly one reap-post-media-bytes job — unschedule-then-schedule, so a replay adds no second');
select is(
  (select schedule from cron.job where jobname = 'reap-post-media-bytes'),
  '29 4 * * *', 'the job runs at 04:29, clear of the 03:11/03:17 cluster and of fund-settle at 04:41');
select ok(
  (select command from cron.job where jobname = 'reap-post-media-bytes')
    like '%invoke_post_media_reaper()%',
  'cron calls the wrapper — never a literal key in cron.job.command');
select ok(
  (select command from cron.job where jobname = 'reap-post-media-bytes')
    not like '%sb\_secret\_%',
  'no secret is baked into the cron command: a rotation must not need an unschedule');

select * from finish();
rollback;
