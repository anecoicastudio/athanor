begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- seed: one user; handle_new_user trigger auto-creates the public.profiles row
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'aura_scores_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- schema + RLS shape
select has_table('public', 'aura_scores', 'aura_scores exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.aura_scores'::regclass),
  'RLS enabled on aura_scores'
);
select policies_are(
  'public', 'aura_scores',
  array['aura_scores_select_anon', 'aura_scores_select_authenticated'],
  'two SELECT policies (anon + authenticated); no client write path'
);

-- world-readable: anon CAN read, CANNOT write
set local role anon;
select lives_ok($$ select count(*) from public.aura_scores $$, 'anon CAN read aura_scores (score is public)');
select throws_ok(
  $$ insert into public.aura_scores (profile_id, score) values (gen_random_uuid(), 500) $$,
  '42501', null, 'anon cannot write aura_scores');
reset role;

-- authenticated client cannot write (engine-only)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into public.aura_scores (profile_id, score) values ('11111111-1111-1111-1111-111111111111', 999) $$,
  '42501', null, 'client cannot insert a score');
select throws_ok($$ update public.aura_scores set score = 1000 $$, '42501', null, 'client cannot update a score');
reset role;

-- CHECK holds against the engine too; engine can upsert a clamped score
set local role service_role;
select throws_ok(
  $$ insert into public.aura_scores (profile_id, score) values ('11111111-1111-1111-1111-111111111111', 1500) $$,
  '23514', null, 'score > 1000 rejected by CHECK even for engine');
select lives_ok(
  $$ insert into public.aura_scores (profile_id, score, peak_score) values ('11111111-1111-1111-1111-111111111111', 412, 412) $$,
  'engine can upsert a clamped score');
reset role;

select * from finish();
rollback;
