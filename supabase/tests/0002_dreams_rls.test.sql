begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- schema
select has_column('public', 'profiles', 'identity_tags', 'profiles.identity_tags exists');
select has_column('public', 'profiles', 'seeking', 'profiles.seeking exists');
select has_table('public', 'dreams', 'dreams table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.dreams'::regclass),
  'RLS enabled on dreams'
);
select policies_are(
  'public', 'dreams',
  array['dreams_select_authenticated', 'dreams_insert_own', 'dreams_update_own'],
  'exactly the expected policies on dreams'
);

-- anon: no access at all
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.dreams $$,
  '42501', null, 'anon cannot read dreams'
);
reset role;

-- user A inserts own dream
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.dreams (profile_id, text)
     values ('11111111-1111-1111-1111-111111111111', 'Aprire uno studio accessibile') $$,
  'owner can insert own dream'
);

-- one active dream per profile
select throws_ok(
  $$ insert into public.dreams (profile_id, text)
     values ('11111111-1111-1111-1111-111111111111', 'Secondo sogno attivo') $$,
  '23505', null, 'second active dream rejected'
);

-- cannot insert for someone else
select throws_ok(
  $$ insert into public.dreams (profile_id, text)
     values ('22222222-2222-2222-2222-222222222222', 'Sogno altrui') $$,
  '42501', null, 'cannot insert dream for another profile'
);

-- member-wide read
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.dreams
     where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'members can read dreams'
);

-- cross-user update silently affects 0 rows
update public.dreams set text = 'hacked' where profile_id = '11111111-1111-1111-1111-111111111111';
select results_eq(
  $$ select count(*)::int from public.dreams where text = 'hacked' $$,
  $$ values (0) $$,
  'cross-user update affects zero rows'
);

-- owner can update own
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ update public.dreams set status = 'archived'
     where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  'owner can archive own dream'
);
select results_eq(
  $$ select count(*)::int from public.dreams
     where status = 'archived'
       and profile_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'archive persisted'
);

-- archiving frees the one-active slot
select lives_ok(
  $$ insert into public.dreams (profile_id, text)
     values ('11111111-1111-1111-1111-111111111111', 'Nuovo sogno attivo') $$,
  'new active dream allowed after archive'
);

select throws_ok(
  $$ update public.dreams set text = '   '
     where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active' $$,
  '23514', null, 'blank dream text rejected'
);
reset role;

select * from finish();
rollback;
