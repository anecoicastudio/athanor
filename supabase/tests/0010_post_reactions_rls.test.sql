begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- three deterministic users (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'user_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- A authors a post (service-role seed so the test focuses on reactions RLS)
insert into public.posts (id, author_id, category, body)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'human', 'Un passo del percorso');

-- schema
select has_table('public', 'post_reactions', 'post_reactions table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.post_reactions'::regclass),
  'RLS enabled on post_reactions'
);
select policies_are(
  'public', 'post_reactions',
  array['post_reactions_select_own', 'post_reactions_insert_own', 'post_reactions_delete_own',
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'exactly the expected policies on post_reactions'
);

-- anon is denied entirely (no grant)
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.post_reactions $$,
  '42501', null, 'anon cannot read post_reactions'
);
reset role;

-- B and C each ✦ A's post (insert own — lives_ok)
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ insert into public.post_reactions (post_id, person_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  'B can light a star on A''s post'
);
-- B ✦'ing twice → unique violation
select throws_ok(
  $$ insert into public.post_reactions (post_id, person_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  '23505', null, 'one ✦ per (post, person)'
);
-- C also reacts
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ insert into public.post_reactions (post_id, person_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333') $$,
  'C can light a star on A''s post'
);
-- B (non-author) reads reaction rows for A's post → sees only B's own (count = 1, not 2)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.post_reactions
     where post_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (1) $$,
  'non-author B sees only their own reaction row'
);
-- B (non-author) post_reaction_count → 0 (anti-vanity)
select results_eq(
  $$ select public.post_reaction_count('aaaaaaaa-0000-0000-0000-000000000001') $$,
  $$ values (0) $$,
  'non-author count is 0 (aggregate not exposed)'
);

-- A (author) sees the true total (2)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select public.post_reaction_count('aaaaaaaa-0000-0000-0000-000000000001') $$,
  $$ values (2) $$,
  'author sees the true reaction total'
);
-- A cannot ✦ their own post (no self-✦ — WITH CHECK denies)
select throws_ok(
  $$ insert into public.post_reactions (post_id, person_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'author cannot light a star on their own post'
);

-- B cannot delete C's ✦ (affects 0 rows; under B's RLS C's row is invisible anyway)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.post_reactions where person_id = '33333333-3333-3333-3333-333333333333';
reset role;
-- re-read as author to prove C's reaction survived B's delete attempt
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select public.post_reaction_count('aaaaaaaa-0000-0000-0000-000000000001') $$,
  $$ values (2) $$,
  'non-author delete removed no other person reaction (author total still 2)'
);
reset role;

-- function execute grants: authenticated yes, anon no
select ok(
  has_function_privilege('authenticated', 'public.post_reaction_count(uuid)', 'execute'),
  'authenticated may execute post_reaction_count'
);
select ok(
  not has_function_privilege('anon', 'public.post_reaction_count(uuid)', 'execute'),
  'anon may not execute post_reaction_count'
);

select * from finish();
rollback;
