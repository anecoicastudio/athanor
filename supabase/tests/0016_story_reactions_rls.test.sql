begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'user_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- A authors a live segment (service-role seed so the test focuses on reactions RLS)
insert into public.story_segments (id, author_id, kind, storage_path)
values ('dddddddd-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'photo', '11111111/seg1.jpg');

-- schema
select has_table('public', 'story_reactions', 'story_reactions table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.story_reactions'::regclass),
  'RLS enabled on story_reactions'
);
select policies_are(
  'public', 'story_reactions',
  array['story_reactions_select_own', 'story_reactions_insert_own', 'story_reactions_delete_own',
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'exactly the expected policies on story_reactions'
);

-- anon denied
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.story_reactions $$,
  '42501', null, 'anon cannot read story_reactions'
);
reset role;

-- B and C each ✦ A's segment
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ insert into public.story_reactions (segment_id, person_id)
     values ('dddddddd-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  'B can celebrate A''s step'
);
select throws_ok(
  $$ insert into public.story_reactions (segment_id, person_id)
     values ('dddddddd-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  '23505', null, 'one ✦ per (segment, person)'
);
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ insert into public.story_reactions (segment_id, person_id)
     values ('dddddddd-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333') $$,
  'C can celebrate A''s step'
);

-- B (non-owner) reads reaction rows → sees only own (count = 1, not 2)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.story_reactions
     where segment_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  $$ values (1) $$,
  'non-owner B sees only their own reaction row'
);
-- B (non-owner) story_reaction_count → 0 (anti-vanity)
select results_eq(
  $$ select public.story_reaction_count('dddddddd-0000-0000-0000-000000000001') $$,
  $$ values (0) $$,
  'non-owner count is 0 (aggregate not exposed)'
);

-- A (owner) sees the true total (2)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select public.story_reaction_count('dddddddd-0000-0000-0000-000000000001') $$,
  $$ values (2) $$,
  'owner sees the true celebration total'
);

-- function execute grants: authenticated yes, anon no
select ok(
  has_function_privilege('authenticated', 'public.story_reaction_count(uuid)', 'execute'),
  'authenticated may execute story_reaction_count'
);
select ok(
  not has_function_privilege('anon', 'public.story_reaction_count(uuid)', 'execute'),
  'anon may not execute story_reaction_count'
);

select * from finish();
rollback;
