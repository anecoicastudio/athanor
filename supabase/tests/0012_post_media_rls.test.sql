begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

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

select * from finish();
rollback;
