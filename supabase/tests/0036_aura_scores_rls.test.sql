begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

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

-- The score is public; the rest of the row is for members (#782, 20260919174008). Asserted as
-- PRIVILEGES first (supabase-db.md): a read that happens to fail proves nothing about the grant.
select ok(has_column_privilege('anon', 'public.aura_scores', 'score', 'SELECT'),
  'anon holds SELECT on score — the public number');
select ok(has_column_privilege('anon', 'public.aura_scores', 'profile_id', 'SELECT'),
  'and on profile_id: PostgREST can only filter on a column the role may read');
select ok(not has_column_privilege('anon', 'public.aura_scores', 'breakdown', 'SELECT'),
  'anon holds no SELECT on breakdown');
select ok(not has_column_privilege('anon', 'public.aura_scores', 'peak_score', 'SELECT'),
  'nor on peak_score');
select ok(not has_column_privilege('anon', 'public.aura_scores', 'last_qualifying_action_at', 'SELECT'),
  'nor on last_qualifying_action_at');
select ok(not has_column_privilege('anon', 'public.aura_scores', 'computed_at', 'SELECT'),
  'nor on computed_at');
select ok(has_table_privilege('authenticated', 'public.aura_scores', 'SELECT'),
  'members keep the whole row — the owner''s breakdown screen reads it');

-- anon CAN read the score, CANNOT read the rest, CANNOT write
set local role anon;
select lives_ok($$ select count(*) from public.aura_scores $$, 'anon CAN read aura_scores (score is public)');
select lives_ok(
  $$ select profile_id, score from public.aura_scores
      where profile_id = '11111111-1111-1111-1111-111111111111' $$,
  'anon reads one member''s score by id — the only shape a signed-out read takes');
select throws_ok(
  $$ select breakdown from public.aura_scores $$,
  '42501', null, 'anon cannot read the breakdown');
select throws_ok(
  $$ select * from public.aura_scores $$,
  '42501', null, 'anon cannot read the whole row');
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
select throws_ok($$ delete from public.aura_scores $$, '42501', null, 'client cannot delete a score');
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
