begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','user_a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','user_b@test.athanor','{"locale":"en"}'::jsonb, now(), now());

select has_table('public','athanor_days_interest','table exists');
select ok((select relrowsecurity from pg_class where oid='public.athanor_days_interest'::regclass), 'RLS enabled');
select policies_are('public','athanor_days_interest',
  array['athanor_days_interest_select_own','athanor_days_interest_insert_own'],
  'exactly the expected policies');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  insert into public.athanor_days_interest (user_id, edition) values ('11111111-1111-1111-1111-111111111111', null)
$$, 'owner can register interest');

select throws_ok($$
  insert into public.athanor_days_interest (user_id, edition) values ('11111111-1111-1111-1111-111111111111', null)
$$, '23505', null, 'duplicate general interest rejected (idempotent)');

select throws_ok($$
  insert into public.athanor_days_interest (user_id, edition) values ('22222222-2222-2222-2222-222222222222', null)
$$, '42501', null, 'cannot register interest for another user');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.athanor_days_interest
  where user_id='11111111-1111-1111-1111-111111111111' $$, $$ values (0) $$, 'cannot read another user''s interest');
reset role;

select * from finish();
rollback;
