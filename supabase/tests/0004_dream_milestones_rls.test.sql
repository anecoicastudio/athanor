begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- two deterministic users (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.auria', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.auria', '{"locale":"en"}'::jsonb, now(), now());

-- schema
select has_type('public', 'milestone_status', 'milestone_status enum exists');
select has_table('public', 'dream_milestones', 'dream_milestones table exists');
select has_column('public', 'dream_milestones', 'body', 'dream_milestones.body exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.dream_milestones'::regclass),
  'RLS enabled on dream_milestones'
);
select policies_are(
  'public', 'dream_milestones',
  array[
    'dream_milestones_select_authenticated',
    'dream_milestones_select_anon_public',
    'dream_milestones_insert_own',
    'dream_milestones_update_own'
  ],
  'exactly the expected policies on dream_milestones'
);

-- user A plants a dream to attach tappe to
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('11111111-1111-1111-1111-111111111111', 'Aprire uno studio accessibile');

-- owner adds a tappa
select lives_ok(
  $$ insert into public.dream_milestones (dream_id, body)
     values ((select id from public.dreams
              where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'),
             'Un mentor') $$,
  'owner can add a tappa to own dream'
);

-- blank body rejected (CHECK 23514)
select throws_ok(
  $$ insert into public.dream_milestones (dream_id, body)
     values ((select id from public.dreams
              where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'),
             '   ') $$,
  '23514', null, 'blank tappa body rejected'
);

-- body over 200 chars rejected (CHECK 23514)
select throws_ok(
  format(
    $$ insert into public.dream_milestones (dream_id, body)
       values ((select id from public.dreams
                where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'),
               %L) $$,
    repeat('x', 201)
  ),
  '23514', null, 'over-200-char tappa body rejected'
);

-- owner marks the tappa done
select lives_ok(
  $$ update public.dream_milestones set status = 'done'
     where dream_id = (select id from public.dreams
                       where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active') $$,
  'owner can mark own tappa done'
);

-- owner re-opens (soft-delete path uses the same UPDATE policy)
select lives_ok(
  $$ update public.dream_milestones set status = 'open', deleted_at = null
     where dream_id = (select id from public.dreams
                       where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active') $$,
  'owner can update own tappa (soft-delete path uses the same UPDATE policy)'
);

-- user B cannot insert a tappa on A's dream (insert_own with check → 42501)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.dream_milestones (dream_id, body)
     values ((select id from public.dreams
              where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'),
             'Tappa altrui') $$,
  '42501', null, 'non-owner cannot add a tappa to another dream'
);

-- user B's update of A's tappa silently affects 0 rows (update_own using → no matching row)
update public.dream_milestones set body = 'hacked'
  where dream_id = (select id from public.dreams
                    where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active');
select results_eq(
  $$ select count(*)::int from public.dream_milestones where body = 'hacked' $$,
  $$ values (0) $$,
  'non-owner update affects zero tappe'
);
reset role;

-- anon: dream is members-default → anon reads 0 tappe (grant + policy → filtered, not 42501)
set local role anon;
set local request.jwt.claims = '';
select results_eq(
  $$ select count(*)::int from public.dream_milestones $$,
  $$ values (0) $$,
  'anon reads no tappe while parent dream is members-default'
);
reset role;

-- owner flips dream section to public → anon now reads the tappa
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.profiles set visibility = '{"dream":"public"}'::jsonb
  where id = '11111111-1111-1111-1111-111111111111';
reset role;

set local role anon;
set local request.jwt.claims = '';
select results_eq(
  $$ select count(*)::int from public.dream_milestones $$,
  $$ values (1) $$,
  'anon reads tappe when parent dream is public'
);
reset role;

select * from finish();
rollback;
