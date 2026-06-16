begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- A = dream owner, B = helper, C = unrelated third user (profiles auto-created by handle_new_user)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'user_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select has_function(
  'public', 'confirm_milestone_help', array['uuid'],
  'confirm_milestone_help(uuid) exists'
);

-- owner A plants a dream with three tappe
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('11111111-1111-1111-1111-111111111111', 'Aprire uno studio accessibile');
insert into public.dream_milestones (dream_id, body)
  values
    ((select id from public.dreams where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'), 'Un mentor'),
    ((select id from public.dreams where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'), 'Un logo'),
    ((select id from public.dreams where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'), 'Un sito');

-- helper B offers on all three tappe
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.milestone_helps (milestone_id, helper_id, type)
  values
    ((select m.id from public.dream_milestones m join public.dreams d on d.id = m.dream_id
        where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor'),
     '22222222-2222-2222-2222-222222222222', 'skill'),
    ((select m.id from public.dream_milestones m join public.dreams d on d.id = m.dream_id
        where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un logo'),
     '22222222-2222-2222-2222-222222222222', 'connection'),
    ((select m.id from public.dream_milestones m join public.dreams d on d.id = m.dream_id
        where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un sito'),
     '22222222-2222-2222-2222-222222222222', 'opportunity');

-- owner A accepts the 'Un mentor' and 'Un sito' offers (leaves 'Un logo' offered)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.milestone_helps set status = 'accepted'
  where helper_id = '22222222-2222-2222-2222-222222222222'
    and milestone_id in (
      select m.id from public.dream_milestones m join public.dreams d on d.id = m.dream_id
        where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body in ('Un mentor', 'Un sito'));

-- HAPPY PATH: owner confirms the accepted 'Un mentor' help — both writes land atomically
select lives_ok(
  $$ select public.confirm_milestone_help(
       (select mh.id from public.milestone_helps mh
          join public.dream_milestones m on m.id = mh.milestone_id
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor')) $$,
  'owner confirms an accepted help'
);
select results_eq(
  $$ select mh.status::text from public.milestone_helps mh
       join public.dream_milestones m on m.id = mh.milestone_id
       join public.dreams d on d.id = m.dream_id
      where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor' $$,
  $$ values ('completed') $$,
  'confirm sets the help status to completed'
);
select results_eq(
  $$ select m.status::text from public.dream_milestones m
       join public.dreams d on d.id = m.dream_id
      where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor' $$,
  $$ values ('done') $$,
  'confirm marks the parent tappa done (same transaction)'
);

-- ALL-OR-NOTHING: confirming the still-'offered' 'Un logo' help trips the guard (23514) and
-- leaves the tappa untouched — the function does not mark a tappa done on an illegal edge.
select throws_ok(
  $$ select public.confirm_milestone_help(
       (select mh.id from public.milestone_helps mh
          join public.dream_milestones m on m.id = mh.milestone_id
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un logo')) $$,
  '23514', null, 'confirming an offered (not accepted) help is rejected (illegal edge)'
);
select results_eq(
  $$ select status::text from public.dream_milestones m
       join public.dreams d on d.id = m.dream_id
      where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un logo' $$,
  $$ values ('open') $$,
  'a rejected confirm leaves the tappa open (atomic — no partial write)'
);

-- HELPER CANNOT SELF-COMPLETE: B can read the accepted 'Un sito' help, but the owner-only
-- UPDATE policies make both writes no-ops — the call succeeds yet changes nothing.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select public.confirm_milestone_help(
       (select mh.id from public.milestone_helps mh where mh.helper_id = '22222222-2222-2222-2222-222222222222'
          and mh.status = 'accepted'
          and mh.milestone_id = (select m.id from public.dream_milestones m join public.dreams d on d.id = m.dream_id
            where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un sito'))) $$,
  'helper calling confirm does not error'
);
select results_eq(
  $$ select status::text from public.milestone_helps mh
       join public.dream_milestones m on m.id = mh.milestone_id
       join public.dreams d on d.id = m.dream_id
      where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un sito' $$,
  $$ values ('accepted') $$,
  'helper cannot self-complete: the help stays accepted (owner-only write)'
);

reset role;

select * from finish();
rollback;
