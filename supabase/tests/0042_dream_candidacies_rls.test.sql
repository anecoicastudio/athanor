begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- two users: A (unverified) + B (identity-verified). The handle_new_user trigger
-- auto-creates their public.profiles rows. We then flip B's identity_verified as the
-- table owner (this seed block runs as the migration/test owner — bypasses RLS + the
-- per-column client grant lockdown, exactly the M9 service-role webhook write path).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'cand_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'cand_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

update public.profiles set identity_verified = true
  where id = '22222222-2222-2222-2222-222222222222';

-- structure + RLS
select has_table('public', 'dream_candidacies', 'dream_candidacies exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.dream_candidacies'::regclass),
  'RLS enabled on dream_candidacies'
);
select policies_are(
  'public', 'dream_candidacies',
  array['dream_candidacies_select_visible','dream_candidacies_insert_own_verified','dream_candidacies_update_own_submitted'],
  'exactly the three candidacy policies'
);

-- seed an edition (service_role — fund_editions is service-role write only)
set local role service_role;
insert into public.fund_editions (id, year, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled)
  values ('00000000-0000-0000-0000-0000000000ed', 2027, now() + interval '30 days', 1000000, 'community', true, false);
reset role;

-- (a) UNVERIFIED user_a cannot insert (identity gate fires in WITH CHECK)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into public.dream_candidacies (edition_id, profile_id, story, goal, impact, video_url, plan)
     values ('00000000-0000-0000-0000-0000000000ed','11111111-1111-1111-1111-111111111111','s','g','i','11111111-1111-1111-1111-111111111111/x.mp4','p') $$,
  '42501', null, 'unverified user blocked by WITH CHECK'
);

-- (b) VERIFIED user_b can insert status='submitted'
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ insert into public.dream_candidacies (id, edition_id, profile_id, story, goal, impact, video_url, plan)
     values ('00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-0000000000ed','22222222-2222-2222-2222-222222222222','s','g','i','22222222-2222-2222-2222-222222222222/x.mp4','p') $$,
  'verified user can submit'
);

-- (c) cannot self-promote on insert (status pinned to 'submitted')
select throws_ok(
  $$ insert into public.dream_candidacies (edition_id, profile_id, story, goal, impact, video_url, plan, status)
     values ('00000000-0000-0000-0000-0000000000ed','22222222-2222-2222-2222-222222222222','s2','g','i','22222222-2222-2222-2222-222222222222/y.mp4','p','winner') $$,
  '42501', null, 'cannot insert status=winner'
);

-- (d) author edits own story while submitted
select lives_ok(
  $$ update public.dream_candidacies set story = 'edited' where id = '00000000-0000-0000-0000-0000000000ca' $$,
  'author edits own submitted candidacy'
);

-- (e) author cannot flip status: WITH CHECK pins 'submitted' → the moved row fails the
-- WITH CHECK and raises 42501 (the update would carry the row out of the policy's scope).
select throws_ok(
  $$ update public.dream_candidacies set status='winner' where id='00000000-0000-0000-0000-0000000000ca' $$,
  '42501', null, 'author cannot flip status to winner (WITH CHECK)'
);

-- (f) non-author user_a cannot edit user_b's candidacy: the USING clause denies it → the
-- statement succeeds against zero matching rows, leaving the story unchanged ('edited' from (d)).
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.dream_candidacies set story='hax' where id='00000000-0000-0000-0000-0000000000ca';
reset role;
select is(
  (select story from public.dream_candidacies where id='00000000-0000-0000-0000-0000000000ca'),
  'edited', 'non-author UPDATE affects zero rows (story unchanged)'
);
set local role authenticated;

-- (g) read visibility: user_a sees user_b's submitted candidacy
select is(
  (select count(*) from public.dream_candidacies where id='00000000-0000-0000-0000-0000000000ca')::bigint,
  1::bigint, 'members see public-status candidacy'
);

-- (h) after service_role sets it 'rejected', user_a sees 0; the author still sees own (asserted via user_a here)
reset role;
update public.dream_candidacies set status='rejected' where id='00000000-0000-0000-0000-0000000000ca';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.dream_candidacies where id='00000000-0000-0000-0000-0000000000ca')::bigint,
  0::bigint, 'rejected candidacy is private to author'
);

-- (i) identity_verified is client-unwritable: user_a tries to self-verify → 42501 (column not granted)
select throws_ok(
  $$ update public.profiles set identity_verified = true where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'client cannot UPDATE identity_verified (column not granted)'
);

-- (j) ZERO Aura: no aura_events row references the candidacy (rule #1 — fund flow emits nothing)
reset role;
select is(
  (select count(*) from public.aura_events
   where ref_id = '00000000-0000-0000-0000-0000000000ca')::bigint,
  0::bigint, 'candidacy flow emits no aura_events'
);

select * from finish();
rollback;
