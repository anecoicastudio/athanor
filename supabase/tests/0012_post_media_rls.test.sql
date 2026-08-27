begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- two deterministic users (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- A authors a post (service-role seed so the test focuses on post_media RLS)
insert into public.posts (id, author_id, category, body)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'human', 'Un passo del percorso');

-- 1. schema: table exists
select has_table('public'::name, 'post_media'::name, 'post_media table exists');

-- 2. schema: RLS enabled
select ok(
  (select relrowsecurity from pg_class where oid = 'public.post_media'::regclass),
  'RLS enabled on post_media'
);

-- 2b. schema: the poster column exists and is nullable — extraction is best-effort (#318),
-- so a video row written without a poster must be insertable.
select col_is_null('public'::name, 'post_media'::name, 'thumb_path'::name,
  'thumb_path exists and is nullable');

-- 3. exactly the four expected policies
select policies_are(
  'public'::name, 'post_media'::name,
  array['post_media_select_authenticated','post_media_insert_post_author',
        'post_media_update_post_author','post_media_delete_post_author',
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'exactly the expected policies on post_media'
);

-- 4. anon is denied entirely (no grant)
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.post_media $$,
  '42501', null, 'anon cannot read post_media'
);
reset role;

-- 5. author A inserts a post_media row on own post → lives_ok
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.post_media (id, post_id, kind, storage_path, position)
     values ('bbbbbbbb-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-000000000001',
             'image', 'post-media/11111111/img1.jpg', 0) $$,
  'author can attach media to own post'
);

-- 6. member B cannot insert post_media on A's post → 42501
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.post_media (post_id, kind, storage_path, position)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'image', 'post-media/22222222/img2.jpg', 1) $$,
  '42501', null, 'non-author cannot attach media to another user''s post'
);

-- 7. member B reads A's media while post is live → 1 row
select results_eq(
  $$ select count(*)::int from public.post_media
     where post_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (1) $$,
  'member B can read media on a live post'
);

-- 8. after A soft-deletes the post, B's SELECT of that media → 0 rows
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.posts set deleted_at = now()
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.post_media
     where post_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (0) $$,
  'media on soft-deleted post is invisible to members'
);
reset role;

-- 9. duplicate (post_id, position) → 23505. RLS is irrelevant here (the unique index fires
-- before any policy); runs at the test-runner role after reset.
select throws_ok(
  $$ insert into public.post_media (post_id, kind, storage_path, position)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'video', 'post-media/11111111/vid1.mp4', 0) $$,
  '23505', null, 'duplicate (post_id, position) is rejected by unique index'
);

-- 10/11. duration_s is capped at 60 seconds (#56). Nothing asserted this bound before —
-- the app enforced 60 on every picker path while the CHECK said 1200, so the gap was
-- reachable only by a client that is not our app, and only a constraint can refuse that.
-- Both arms run at the test-runner role after reset: this is a privilege-independent
-- constraint, and a check violation is 23514 whoever writes the row.
select throws_ok(
  $$ insert into public.post_media (post_id, kind, storage_path, position, duration_s)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'video',
             'post-media/11111111/vid61.mp4', 1, 61) $$,
  '23514', null, 'a clip longer than 60s is rejected by post_media_duration_s_check'
);

select lives_ok(
  $$ insert into public.post_media (post_id, kind, storage_path, position, duration_s)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'video',
             'post-media/11111111/vid60.mp4', 2, 60) $$,
  'a clip of exactly 60s is accepted — the cap is inclusive, as the schema and picker are'
);

-- 12/13. The same cap binds an AUDIO row (#154). `post_media_duration_s_check` carries no
-- `kind` predicate — `duration_s` is one column — so it has always applied to every kind; but
-- until the in-app recorder landed there was no surface that could write an audio row at all,
-- and both arms above name 'video'. A bound asserted for one kind and inherited by another is
-- exactly the shape #56 was: true right up until somebody changes it for the kind that IS
-- named. The recorder makes audio reachable, so audio gets asserted.
--
-- This is also what a kind-conditional CHECK would have had to replace. #154 chose to keep one
-- bound for both (the cap is a property of a post, not of a codec — a post may carry both kinds
-- and derivePostType collapses it to one type), and these two arms are what would go red if a
-- later migration gave audio its own.
select throws_ok(
  $$ insert into public.post_media (post_id, kind, storage_path, position, duration_s)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'audio',
             'post-media/11111111/aud61.m4a', 3, 61) $$,
  '23514', null, 'an audio clip longer than 60s is rejected too — the CHECK has no kind predicate'
);

select lives_ok(
  $$ insert into public.post_media (post_id, kind, storage_path, position, duration_s)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'audio',
             'post-media/11111111/aud60.m4a', 4, 60) $$,
  'an audio clip of exactly 60s is accepted — one clip cap, both kinds'
);

-- 14. exactly ONE duration CHECK on the column. The narrowing migration (#56) drops the
-- constraint and re-adds it under the same auto-generated name; `drop constraint if exists`
-- means a name that did not match would make the drop a no-op and leave BOTH the old bound
-- and the new one in the catalog. The effective bound would still be 60, so nothing visible
-- would break — and the 1200 constraint would be unremovable, since the migration that
-- would have dropped it is already applied and migrations are append-only. supabase-db.md
-- is explicit that hosted catalogs drift wider than the migrations declaring them and that a
-- from-zero replay cannot see it, so the count is asserted rather than assumed.
select results_eq(
  $$ select count(*)::int from pg_constraint
      where conrelid = 'public.post_media'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%duration_s%' $$,
  $$ values (1) $$,
  'post_media carries exactly one duration_s CHECK — the narrowing replaced it, not doubled it'
);

-- Replacing a media SET (#586). `replacePostMedia` converges a post's media by upserting on
-- (post_id, position) and then deleting the positions the new set no longer fills, so the
-- author needs UPDATE and DELETE and no one else may have either. The `policies_are` arm above
-- asserts those two policies EXIST and `0121_grant_catalog_sweep` pins the privilege; what
-- neither can say is what the predicates DO, and a predicate is only checked by writing
-- through it.
--
-- The arms below are referred to by what they do rather than by number: this file gained an
-- arm at `2b`, so its prose numbering and its assertion ordinals have not agreed since.
--
-- A second, LIVE post: the soft-delete arm above killed the first, which hides its media from
-- the SELECT policy and would make every count below read 0 for the wrong reason.
insert into public.posts (id, author_id, category, body)
values ('aaaaaaaa-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'human', 'Un secondo passo');

insert into public.post_media (post_id, kind, storage_path, position) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'image', 'post-media/11111111/s0.jpg', 0),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'image', 'post-media/11111111/s1.jpg', 1),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'image', 'post-media/11111111/s2.jpg', 2);

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- A denial on UPDATE or DELETE is NOT a raised code, unlike the INSERT arm above:
-- `authenticated` holds both grants, so RLS filters the rows out of the statement rather than
-- refusing it. Both run clean; the `results_eq` after them is what says they did nothing.
select lives_ok(
  $$ update public.post_media set storage_path = 'post-media/22222222/hijack.jpg'
      where post_id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  'a non-author UPDATE of another member''s media raises nothing — it matches no row'
);

select lives_ok(
  $$ delete from public.post_media
      where post_id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  'a non-author DELETE of another member''s media raises nothing — it matches no row'
);

-- B can still READ the set (the post is live), and it is exactly as its author left it.
select results_eq(
  $$ select storage_path from public.post_media
      where post_id = 'aaaaaaaa-0000-0000-0000-000000000002' order by position $$,
  $$ values ('post-media/11111111/s0.jpg'::text),
            ('post-media/11111111/s1.jpg'::text),
            ('post-media/11111111/s2.jpg'::text) $$,
  'a non-author changed and removed nothing — the set is as its author left it'
);

-- The statement the CLIENT actually sends, from a non-author. `.upsert(rows, { onConflict:
-- 'post_id,position' })` is `INSERT … ON CONFLICT … DO UPDATE`, and that path evaluates
-- `post_media_insert_post_author`'s WITH CHECK on every row — which the two bare statements
-- above never touch. Here it raises, where the bare UPDATE only matched nothing: a WITH CHECK
-- refuses a row rather than filtering it away.
select throws_ok(
  $$ insert into public.post_media (post_id, kind, storage_path, position)
     values ('aaaaaaaa-0000-0000-0000-000000000002', 'video', 'post-media/22222222/hijack.mp4', 0)
     on conflict (post_id, position) do update set storage_path = excluded.storage_path $$,
  '42501', null, 'a non-author cannot converge another member''s media set — the upsert is refused'
);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- The author's two halves of a set replace: converge the position that survives (kind and path
-- both change — a retry whose attachment at that slot became a video), then sweep the positions
-- the new, shorter set no longer fills. The first is written as the composite statement the
-- client sends rather than as a bare UPDATE, so the INSERT and UPDATE policies are both on the
-- path, as they are in production.
select lives_ok(
  $$ insert into public.post_media
       (post_id, kind, storage_path, position, thumb_path, duration_s, width, height)
     values ('aaaaaaaa-0000-0000-0000-000000000002', 'video',
             'post-media/11111111/s0.mp4', 0, 'post-media/11111111/s0-thumb.jpg', 12, 720, 1280)
     on conflict (post_id, position) do update set
       kind = excluded.kind, storage_path = excluded.storage_path,
       thumb_path = excluded.thumb_path, duration_s = excluded.duration_s,
       width = excluded.width, height = excluded.height $$,
  'the author can converge a media row in place — the UPSERT half of a set replace'
);

select lives_ok(
  $$ delete from public.post_media
      where post_id = 'aaaaaaaa-0000-0000-0000-000000000002' and position not in (0) $$,
  'the author can sweep the positions a new set no longer fills — the DELETE half'
);

-- The converged row carries the SECOND attempt's poster and dimensions, not the first's. That
-- is the defect stated exactly: what survived before was a row describing one file over a key
-- holding another.
select results_eq(
  $$ select position, kind::text, storage_path, thumb_path, width from public.post_media
      where post_id = 'aaaaaaaa-0000-0000-0000-000000000002' order by position $$,
  $$ values (0::int, 'video'::text, 'post-media/11111111/s0.mp4'::text,
             'post-media/11111111/s0-thumb.jpg'::text, 720::int) $$,
  'the set is exactly what the second attempt describes — converged, and with no tail left'
);

reset role;

select * from finish();
rollback;
