begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- three deterministic users (handle_new_user trigger auto-creates their profiles)
--   A = helped/target (plants a dream + two open tappe), B = helper/actor, C = non-party third user
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'user_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- schema
select has_table('public', 'favor_offers', 'favor_offers table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.favor_offers'::regclass),
  'RLS enabled on favor_offers'
);
select policies_are(
  'public', 'favor_offers',
  array[
    'favor_offers_select_party',
    'favor_offers_insert_actor',
    'favor_offers_update_actor'
  ],
  'exactly the expected policies on favor_offers'
);

-- target A plants a dream with two OPEN tappe (the needs B can help with)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('11111111-1111-1111-1111-111111111111', 'Aprire uno studio accessibile');
insert into public.dream_milestones (dream_id, body)
  values
    ((select id from public.dreams where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'), 'Un mentor'),
    ((select id from public.dreams where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'), 'Un logo');

-- helper B plants their own dream + open tappa (to prove their own need never shows in favor_needs)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('22222222-2222-2222-2222-222222222222', 'Imparare la ceramica');
insert into public.dream_milestones (dream_id, body)
  values ((select id from public.dreams where profile_id = '22222222-2222-2222-2222-222222222222' and status = 'active'), 'Un forno');

-- helper B passes a favor to A on A's "Un mentor" tappa (actor = self via RLS)
select lives_ok(
  $$ insert into public.favor_offers (actor_id, target_id, need, need_milestone_id)
     values (
       '22222222-2222-2222-2222-222222222222',
       '11111111-1111-1111-1111-111111111111',
       'Un mentor',
       (select m.id from public.dream_milestones m
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor')) $$,
  'actor can pass a favor to another person'
);

-- a second favor on the same (actor, target, need) violates the unique constraint (23505)
select throws_ok(
  $$ insert into public.favor_offers (actor_id, target_id, need)
     values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Un mentor') $$,
  '23505', null, 'duplicate favor on same (actor,target,need) rejected'
);

-- B cannot insert a favor attributed to someone else (with-check actor_id = self → 42501)
select throws_ok(
  $$ insert into public.favor_offers (actor_id, target_id, need)
     values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'qualcosa') $$,
  '42501', null, 'actor cannot insert a favor attributed to another'
);

-- self-favor (actor = target) rejected (table CHECK + the with-check predicate both forbid it)
select throws_ok(
  $$ insert into public.favor_offers (actor_id, target_id, need)
     values ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'me stesso') $$,
  'self-favor (actor_id = target_id) rejected'
);

-- favor_needs (as B): A's still-unfavored "Un logo" shows; the favored "Un mentor" is gone; B's own need never shows
select results_eq(
  $$ select count(*)::int from public.favor_needs
       where target_id = '11111111-1111-1111-1111-111111111111' and need = 'Un logo' $$,
  $$ values (1) $$,
  'favor_needs shows another member''s unfavored open need'
);
select results_eq(
  $$ select count(*)::int from public.favor_needs
       where target_id = '11111111-1111-1111-1111-111111111111' and need = 'Un mentor' $$,
  $$ values (0) $$,
  'favor_needs excludes a need the viewer already favored'
);
select results_eq(
  $$ select count(*)::int from public.favor_needs
       where target_id = '22222222-2222-2222-2222-222222222222' $$,
  $$ values (0) $$,
  'favor_needs excludes the viewer''s own needs'
);

-- actor B reads own outgoing favor
select results_eq(
  $$ select count(*)::int from public.favor_offers $$,
  $$ values (1) $$,
  'actor reads own outgoing favor'
);

-- the withdraw-only guard: actor cannot re-target / edit identity columns of own favor (42501)
select throws_ok(
  $$ update public.favor_offers set target_id = '33333333-3333-3333-3333-333333333333'
       where actor_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null, 'actor cannot re-target own favor (withdraw-only guard)'
);

-- target A reads the incoming favor
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.favor_offers
       where target_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'target reads own incoming favor'
);

-- non-party C sees none of the favor (directed read: actor or target only)
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.favor_offers $$,
  $$ values (0) $$,
  'non-party user sees zero favors'
);

-- non-party C's UPDATE is denied by the policy USING clause → affects zero rows
update public.favor_offers set need = 'hacked'
  where actor_id = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.favor_offers where need = 'hacked' $$,
  $$ values (0) $$,
  'non-party update of a favor affects zero rows (update policy USING denies it)'
);

-- the legitimate path: actor B withdraws (soft-deletes) own favor
select lives_ok(
  $$ update public.favor_offers set deleted_at = now()
       where actor_id = '22222222-2222-2222-2222-222222222222' $$,
  'actor can withdraw (soft-delete) own favor'
);
-- The withdrawn favor is gone for the TARGET (and everyone else). The actor keeps RLS visibility of
-- its OWN soft-deleted row — required so the withdraw UPDATE's new row passes the SELECT policy
-- (PostgreSQL checks the new row against SELECT; see 20260616083015_allow_owner_soft_delete.sql) — and
-- the app filters `deleted_at is null` on every read, so it never surfaces in-app.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.favor_offers
       where target_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (0) $$,
  'withdrawn favor is no longer visible to the target'
);
reset role;

select * from finish();
rollback;
