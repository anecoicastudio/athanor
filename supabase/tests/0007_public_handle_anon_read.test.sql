begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- Fixtures: A = bio+dream public (+ active dream + tappa); B = all members (default {});
-- C = bio public, dream members (+ active dream). Profiles auto-created by handle_new_user.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'authenticated','authenticated','pub_a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'authenticated','authenticated','mem_b@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'authenticated','authenticated','bio_c@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- handles + visibility (service-level updates before role switch)
update public.profiles set handle = 'pub_a', bio = 'Bio A',
  visibility = '{"bio":"public","dream":"public"}'::jsonb
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profiles set handle = 'mem_b', bio = 'Bio B'
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';            -- visibility {} ⇒ members
update public.profiles set handle = 'bio_c', bio = 'Bio C',
  visibility = '{"bio":"public"}'::jsonb
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';            -- dream stays members

-- A's active dream + tappa (as owner A under RLS)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sogno pubblico di A');
insert into public.dream_milestones (dream_id, body)
  values ((select id from public.dreams
           where profile_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and status = 'active'),
          'Un logo');
-- C's active dream (its profile's dream section is members → must stay hidden from anon)
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sogno privato di C');
reset role;

-- ===== anon read matrix =====
set local role anon;
set local request.jwt.claims = '';

select results_eq(
  $$ select handle from public.profiles order by handle $$,
  $$ values ('bio_c'),('pub_a') $$,
  'anon reads only profiles with at least one public section'
);
select results_eq(
  $$ select text from public.dreams $$,
  $$ values ('Sogno pubblico di A') $$,
  'anon reads only dreams whose owner set dream=public'
);
select results_eq(
  $$ select body from public.dream_milestones $$,
  $$ values ('Un logo') $$,
  'anon reads only tappe of a public dream'
);
select throws_ok(
  $$ insert into public.profiles (id) values (gen_random_uuid()) $$,
  '42501', null, 'anon cannot insert profiles'
);
select throws_ok(
  $$ update public.dreams set text = 'x' $$,
  '42501', null, 'anon cannot update dreams'
);
select throws_ok(
  $$ delete from public.dreams $$,
  '42501', null, 'anon cannot delete dreams'
);
reset role;

-- ===== policies present =====
select policies_are('public', 'profiles',
  array['profiles_select_authenticated','profiles_insert_own','profiles_update_own','profiles_select_anon_public'],
  'profiles gained the anon public-read policy');
select policies_are('public', 'dreams',
  array['dreams_select_authenticated','dreams_insert_own','dreams_update_own','dreams_select_anon_public'],
  'dreams gained the anon public-read policy');
select policies_are('public', 'dream_milestones',
  array['dream_milestones_select_authenticated','dream_milestones_insert_own','dream_milestones_update_own','dream_milestones_select_anon_public'],
  'dream_milestones anon public-read policy re-added');

-- ===== archived public dream is NOT anon-visible =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
update public.dreams set status = 'archived'
  where profile_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
reset role;
set local role anon;
set local request.jwt.claims = '';
select results_eq(
  $$ select count(*)::int from public.dreams $$,
  $$ values (0) $$,
  'anon does not see an archived dream even when dream=public'
);
select results_eq(
  $$ select count(*)::int from public.dream_milestones $$,
  $$ values (0) $$,
  'anon does not see tappe once the parent dream is archived'
);
reset role;

select * from finish();
rollback;
