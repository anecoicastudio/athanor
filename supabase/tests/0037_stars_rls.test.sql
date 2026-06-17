begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- two users: A (owner), B (unrelated member)
-- handle_new_user trigger auto-creates their public.profiles rows
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'stars_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'stars_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- schema + RLS shape
select has_table('public', 'stars', 'stars exists');
select policies_are('public', 'stars',
  array['stars_select_own', 'stars_select_earned', 'stars_select_earned_anon'],
  'owner-full + earned-only policies');

-- seed: user_a has an EARNED star (mentor) + an UNEARNED tracked star (creatore)
set local role service_role;
insert into public.stars (profile_id, star_id, granted_at, progress) values
  ('11111111-1111-1111-1111-111111111111', 'mentor',   now(),  '{"done":3,"total":3,"unit":"aiuti"}'),
  ('11111111-1111-1111-1111-111111111111', 'creatore', null,   '{"done":1,"total":2,"unit":"tappe"}');
reset role;

-- OWNER (user_a) sees BOTH rows (own policy matches regardless of granted_at)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.stars where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (2) $$,
  'owner sees earned + unearned');

-- OTHER (user_b) sees ONLY the earned star (stars_select_earned applies; unearned not visible)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.stars where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'others see only EARNED stars (no unearned progress leak)');
select results_eq(
  $$ select count(*)::int from public.stars
     where profile_id = '11111111-1111-1111-1111-111111111111' and granted_at is null $$,
  $$ values (0) $$,
  'others cannot read an unearned star row');

-- client cannot grant / light a star (no INSERT/UPDATE grant → 42501 at privilege layer)
select throws_ok(
  $$ insert into public.stars (profile_id, star_id, granted_at)
     values ('22222222-2222-2222-2222-222222222222', 'mentor', now()) $$,
  '42501', null, 'client cannot grant a star');
select throws_ok(
  $$ update public.stars set granted_at = now() $$,
  '42501', null, 'client cannot light a star');
reset role;

-- anon sees only earned (SELECT grant exists; earned-anon policy applies)
set local role anon;
select results_eq(
  $$ select count(*)::int from public.stars where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'anon (web @handle) sees only earned stars');
reset role;

select * from finish();
rollback;
