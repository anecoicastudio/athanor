begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- two deterministic users (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- schema
select has_type('public', 'project_category', 'project_category enum exists');
select has_type('public', 'project_status', 'project_status enum exists');
select has_table('public', 'projects', 'projects table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.projects'::regclass),
  'RLS enabled on projects'
);
select policies_are(
  'public', 'projects',
  array['projects_select_authenticated', 'projects_insert_own', 'projects_update_own'],
  'exactly the expected policies on projects'
);
select has_index('public', 'projects', 'projects_board_cat', 'category cursor index exists');

-- user A creates an own project
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.projects (author_id, title, category, description)
     values ('11111111-1111-1111-1111-111111111111', 'Cerco videomaker', 'artistic', 'Per un documentario') $$,
  'author can create own project'
);

-- blank title rejected (CHECK 23514)
select throws_ok(
  $$ insert into public.projects (author_id, title, category)
     values ('11111111-1111-1111-1111-111111111111', '   ', 'startup') $$,
  '23514', null, 'blank project title rejected'
);

-- user B cannot insert as A (insert_own with check → 42501)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.projects (author_id, title, category)
     values ('11111111-1111-1111-1111-111111111111', 'Spacciato per A', 'startup') $$,
  '42501', null, 'cannot insert a project as another author'
);

-- member B reads A's live project (members-wide select)
select results_eq(
  $$ select count(*)::int from public.projects where author_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'member B reads A''s live project'
);

-- B's update of A's project silently affects 0 rows (update_own using → no matching row)
update public.projects set status = 'closed'
  where author_id = '11111111-1111-1111-1111-111111111111';
select results_eq(
  $$ select count(*)::int from public.projects where status = 'closed' $$,
  $$ values (0) $$,
  'non-author update affects zero projects'
);
reset role;

-- anon is denied entirely (no grant) → permission denied on select
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.projects $$,
  '42501', null, 'anon cannot read projects (members-only board)'
);
reset role;

-- owner soft-delete hides the row from members
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.projects set deleted_at = now() where author_id = '11111111-1111-1111-1111-111111111111';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.projects where author_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (0) $$,
  'soft-deleted project is invisible to members'
);
reset role;

select * from finish();
rollback;
