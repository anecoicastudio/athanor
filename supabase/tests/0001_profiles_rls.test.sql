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
  array['profiles_select_authenticated', 'profiles_insert_own', 'profiles_update_own'],
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

-- anon: no table access at all (privileges revoked, not just RLS-filtered)
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501',
  'permission denied for table profiles',
  'anon cannot read profiles'
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
  'authenticated member reads profiles'
);

update public.profiles set bio = 'il mio sogno'
  where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select bio from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'il mio sogno',
  'member updates own profile'
);

update public.profiles set bio = 'hacked'
  where id = '22222222-2222-2222-2222-222222222222';
select is(
  (select bio from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'member cannot update another profile (0 rows affected)'
);

reset role;

select * from finish();

rollback;
