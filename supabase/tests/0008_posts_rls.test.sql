begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- two deterministic users (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- schema
select has_type('public', 'post_category', 'post_category enum exists');
select has_type('public', 'post_type', 'post_type enum exists');
select has_table('public', 'posts', 'posts table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.posts'::regclass),
  'RLS enabled on posts'
);
select policies_are(
  'public', 'posts',
  array[
    'posts_select_authenticated',
    'posts_insert_own',
    'posts_update_own'
  ],
  'exactly the expected policies on posts'
);

-- user A authors a post
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.posts (author_id, category, body)
     values ('11111111-1111-1111-1111-111111111111', 'human', 'Primo passo del percorso') $$,
  'author can create own post'
);

-- user B cannot author a post as A (insert_own with check → 42501)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.posts (author_id, category, body)
     values ('11111111-1111-1111-1111-111111111111', 'human', 'Spacciato per A') $$,
  '42501', null, 'cannot insert a post as another author'
);

-- member B reads A's live post (members-wide select)
select results_eq(
  $$ select count(*)::int from public.posts where author_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'member B reads A''s live post'
);

-- B's update of A's post silently affects 0 rows (update_own using → no matching row)
update public.posts set body = 'hacked'
  where author_id = '11111111-1111-1111-1111-111111111111';
select results_eq(
  $$ select count(*)::int from public.posts where body = 'hacked' $$,
  $$ values (0) $$,
  'non-author update affects zero posts'
);
reset role;

-- anon is denied entirely (no grant) → permission denied on select
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.posts $$,
  '42501', null, 'anon cannot read posts (members-only feed)'
);
reset role;

-- owner soft-delete hides the row from members
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.posts set deleted_at = now() where author_id = '11111111-1111-1111-1111-111111111111';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.posts where author_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (0) $$,
  'soft-deleted post is invisible to members'
);
reset role;

select * from finish();
rollback;
