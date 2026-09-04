begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- three deterministic users (handle_new_user trigger auto-creates their profiles)
--   A = owner (plants a dream + tappe), B = helper (offers), C = non-party third user
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'user_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- schema
select has_type('public', 'help_type', 'help_type enum exists');
select has_type('public', 'help_status', 'help_status enum exists');
select has_table('public', 'milestone_helps', 'milestone_helps table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.milestone_helps'::regclass),
  'RLS enabled on milestone_helps'
);
select policies_are(
  'public', 'milestone_helps',
  array[
    'milestone_helps_select_party',
    'milestone_helps_insert_helper',
    'milestone_helps_update_owner',
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'exactly the expected policies on milestone_helps'
);

-- owner A plants a dream with two tappe to receive offers against
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('11111111-1111-1111-1111-111111111111', 'Aprire uno studio accessibile');
insert into public.dream_milestones (dream_id, body)
  values
    ((select id from public.dreams where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'), 'Un mentor'),
    ((select id from public.dreams where profile_id = '11111111-1111-1111-1111-111111111111' and status = 'active'), 'Un logo');

-- helper B plants their own dream + tappa (to prove a helper cannot offer on their OWN tappa)
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('22222222-2222-2222-2222-222222222222', 'Imparare la ceramica');
insert into public.dream_milestones (dream_id, body)
  values ((select id from public.dreams where profile_id = '22222222-2222-2222-2222-222222222222' and status = 'active'), 'Un forno');

-- helper B offers their skill on A's first tappa (status forced 'offered')
select lives_ok(
  $$ insert into public.milestone_helps (milestone_id, helper_id, type, message)
     values (
       (select m.id from public.dream_milestones m
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor'),
       '22222222-2222-2222-2222-222222222222', 'skill', 'Posso esserti mentor') $$,
  'helper can offer on another''s tappa'
);

-- helper B cannot insert an offer attributed to someone else (with-check helper_id = self → 42501)
select throws_ok(
  $$ insert into public.milestone_helps (milestone_id, helper_id, type)
     values (
       (select m.id from public.dream_milestones m
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un logo'),
       '11111111-1111-1111-1111-111111111111', 'connection') $$,
  '42501', null, 'helper cannot insert an offer attributed to another'
);

-- helper B cannot offer on a tappa they own (with-check not owns_help_milestone → 42501)
select throws_ok(
  $$ insert into public.milestone_helps (milestone_id, helper_id, type)
     values (
       (select m.id from public.dream_milestones m
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '22222222-2222-2222-2222-222222222222' and m.body = 'Un forno'),
       '22222222-2222-2222-2222-222222222222', 'skill') $$,
  '42501', null, 'helper cannot offer on a tappa they own'
);

-- a second offer on the same (milestone_id, helper_id) violates the unique constraint (23505)
select throws_ok(
  $$ insert into public.milestone_helps (milestone_id, helper_id, type)
     values (
       (select m.id from public.dream_milestones m
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor'),
       '22222222-2222-2222-2222-222222222222', 'connection') $$,
  '23505', null, 'duplicate offer on same tappa by same helper rejected'
);

-- helper has no UPDATE policy (no Fase 1 withdraw): self-update of own row affects 0 rows
update public.milestone_helps set message = 'ritiro'
  where helper_id = '22222222-2222-2222-2222-222222222222';
select results_eq(
  $$ select count(*)::int from public.milestone_helps where message = 'ritiro' $$,
  $$ values (0) $$,
  'helper update of own offer affects zero rows (no helper UPDATE policy)'
);

-- helper B also offers on A's second tappa (set up the offered->completed jump test below)
select lives_ok(
  $$ insert into public.milestone_helps (milestone_id, helper_id, type)
     values (
       (select m.id from public.dream_milestones m
          join public.dreams d on d.id = m.dream_id
         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un logo'),
       '22222222-2222-2222-2222-222222222222', 'opportunity') $$,
  'helper can offer on a second tappa of the same dream'
);

-- owner A advances the first offer offered -> accepted (legal edge)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ update public.milestone_helps set status = 'accepted'
     where helper_id = '22222222-2222-2222-2222-222222222222'
       and milestone_id = (select m.id from public.dream_milestones m
                             join public.dreams d on d.id = m.dream_id
                            where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor') $$,
  'owner can transition an offer offered -> accepted'
);

-- owner may change ONLY status: touching message trips the guard (42501)
select throws_ok(
  $$ update public.milestone_helps set message = 'editato dal proprietario'
     where helper_id = '22222222-2222-2222-2222-222222222222'
       and milestone_id = (select m.id from public.dream_milestones m
                             join public.dreams d on d.id = m.dream_id
                            where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor') $$,
  '42501', null, 'owner may change only status (guard rejects message edit)'
);

-- offered -> completed is not a legal edge: jump on the second offer trips the guard (23514)
select throws_ok(
  $$ update public.milestone_helps set status = 'completed'
     where helper_id = '22222222-2222-2222-2222-222222222222'
       and milestone_id = (select m.id from public.dream_milestones m
                             join public.dreams d on d.id = m.dream_id
                            where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un logo') $$,
  '23514', null, 'owner cannot jump offered -> completed'
);

-- accepted -> completed is the legal edge that emits the +40 helper event
select lives_ok(
  $$ update public.milestone_helps set status = 'completed'
     where helper_id = '22222222-2222-2222-2222-222222222222'
       and milestone_id = (select m.id from public.dream_milestones m
                             join public.dreams d on d.id = m.dream_id
                            where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un mentor') $$,
  'owner can transition an offer accepted -> completed'
);

-- non-party third user C sees none of the offers (select policy: helper or dream owner only)
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.milestone_helps $$,
  $$ values (0) $$,
  'non-party user sees zero offers'
);

-- non-party C's UPDATE is blocked by the POLICY, not the guard: target the still-'offered'
-- second offer with a legal offered -> accepted transition. The update_owner USING clause
-- (helper or dream owner only) excludes C, so the guard never fires and 0 rows change.
update public.milestone_helps set status = 'accepted'
  where milestone_id = (select m.id from public.dream_milestones m
                          join public.dreams d on d.id = m.dream_id
                         where d.profile_id = '11111111-1111-1111-1111-111111111111' and m.body = 'Un logo')
    and helper_id = '22222222-2222-2222-2222-222222222222';
select results_eq(
  $$ select count(*)::int from public.milestone_helps where status = 'accepted' $$,
  $$ values (0) $$,
  'non-party update of an offered row affects zero rows (update policy USING denies it, guard never runs)'
);
reset role;

select * from finish();
rollback;
