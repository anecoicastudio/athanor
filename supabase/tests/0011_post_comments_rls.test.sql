begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

insert into public.posts (id, author_id, category, body)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'human', 'Un passo del percorso');

select has_table('public', 'post_comments', 'post_comments table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.post_comments'::regclass),
  'RLS enabled on post_comments'
);
select policies_are(
  'public', 'post_comments',
  array['post_comments_select_authenticated', 'post_comments_insert_own', 'post_comments_update_own'],
  'exactly the expected policies on post_comments'
);

-- anon denied
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.post_comments $$,
  '42501', null, 'anon cannot read post_comments'
);
reset role;

-- A comments on own post
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.post_comments (id, post_id, author_id, body)
     values ('cccccccc-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', 'Primo commento') $$,
  'author can comment on own post'
);

-- B comments on A's post (members can reply) + a threaded reply (parent_id)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ insert into public.post_comments (post_id, author_id, body)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             '22222222-2222-2222-2222-222222222222', 'Bel passo') $$,
  'member B can comment on A''s post'
);
select lives_ok(
  $$ insert into public.post_comments (post_id, author_id, parent_id, body)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             '22222222-2222-2222-2222-222222222222',
             'cccccccc-0000-0000-0000-000000000001', 'Risposta a un commento') $$,
  'member B can reply (parent_id)'
);

-- B cannot rewrite A's comment (cross-author update → 0 rows)
update public.post_comments set body = 'hacked'
  where id = 'cccccccc-0000-0000-0000-000000000001';
select results_eq(
  $$ select count(*)::int from public.post_comments where body = 'hacked' $$,
  $$ values (0) $$,
  'non-author update affects zero comments'
);

-- B reads the live thread (3 live comments)
select results_eq(
  $$ select count(*)::int from public.post_comments
     where post_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (3) $$,
  'member B reads the live thread'
);

-- A soft-deletes own comment → hidden from B
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.post_comments set deleted_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.post_comments
     where post_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (2) $$,
  'soft-deleted comment is hidden from members'
);
reset role;

select * from finish();
rollback;
