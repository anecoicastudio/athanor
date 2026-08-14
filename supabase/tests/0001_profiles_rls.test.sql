begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- deterministic test users (auth trigger fires on insert)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- schema
select has_table('public', 'profiles', 'profiles table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS enabled on profiles'
);
select policies_are(
  'public',
  'profiles',
  array['profiles_select_authenticated', 'profiles_insert_own', 'profiles_update_own', 'profiles_select_anon_public',
        'active_write_update'],
  'exactly the expected policies exist'
);

-- signup trigger
select is(
  (select count(*) from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2::bigint,
  'handle_new_user trigger auto-created both profiles'
);
select is(
  (select locale from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'en',
  'locale propagated from signup metadata'
);

-- anon: since 20260814151601 (#251) the visibility DEFAULT carries identity:'public', so a
-- plain handle_new_user signup is anon-reachable — the default public shell. Both fixtures
-- inherit it. Inserts still denied. The full shell matrix (explicit opt-out, column reach,
-- storage) lives in 0101_public_handle_shell.
set local role anon;
set local request.jwt.claims = '';
select results_eq(
  $$ select count(*)::int from public.profiles $$,
  $$ values (2) $$,
  'anon reads default-signup profiles (identity facet defaults to public — #251 shell)'
);
select throws_ok(
  $$ insert into public.profiles (id) values (gen_random_uuid()) $$,
  '42501',
  'permission denied for table profiles',
  'anon cannot insert profiles'
);
reset role;

-- authenticated as user_a: reads all, updates only own row
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*) from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2::bigint,
  'authenticated member reads profile rows (granted columns)'
);

-- M10 visibility enforcement: bio is no longer directly selectable — own reads
-- go through get_own_profile() (0072 covers the full matrix).
update public.profiles set bio = 'il mio sogno'
  where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select bio from public.get_own_profile()),
  'il mio sogno',
  'member updates own profile (read back via get_own_profile)'
);

update public.profiles set bio = 'hacked'
  where id = '22222222-2222-2222-2222-222222222222';
select is(
  (select bio from public.get_person_profile('22222222-2222-2222-2222-222222222222')),
  null,
  'member cannot update another profile (peer bio unchanged/null via accessor)'
);

reset role;

select * from finish();

rollback;
