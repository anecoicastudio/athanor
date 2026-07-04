begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'consent_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'consent_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());
select set_config('test.a', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.b', '22222222-2222-2222-2222-222222222222', false);

select has_table('public', 'consent', 'table exists');

-- anon fully denied
set local role anon;
select throws_ok($$ select * from public.consent $$, '42501', null, 'anon denied');

-- owner inserts own
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select lives_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'comms', false, 'settings') $$,
  'owner inserts own consent');

-- cannot forge a consent row for ANOTHER profile (insert_own WITH CHECK)
select throws_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.b')::uuid, 'comms', true, 'settings') $$,
  '42501', null, 'cannot forge consent for another profile');

-- unique (profile_id, kind)
select throws_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'comms', true, 'settings') $$,
  '23505', null, 'duplicate (profile_id,kind) rejected');

-- «never_sold» is constitutional, not a stored kind (check constraint excludes it)
select throws_ok(
  $$ insert into public.consent (profile_id, kind, granted, source)
     values (current_setting('test.a')::uuid, 'never_sold', true, 'settings') $$,
  '23514', null, 'never_sold kind rejected — guarantee, not a toggle');

-- non-owner update affects 0 rows (not an error)
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select is(
  (with upd as (
     update public.consent set granted = true
     where profile_id = current_setting('test.a')::uuid returning 1)
   select count(*)::int from upd),
  0, 'non-owner update affects 0 rows');

-- owner reads own only
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select is(
  (select count(*)::int from public.consent),
  1, 'owner sees only own consent');

-- client DELETE denied (owner CRUD-minus-delete; hosted-revoke lockdown)
select throws_ok(
  $$ delete from public.consent where profile_id = current_setting('test.a')::uuid $$,
  '42501', null, 'client DELETE denied');

-- rule #1: consent writes zero Aura (true global under service_role)
set local role service_role;
select is(
  (select count(*)::int from public.aura_events),
  0, 'consent path writes zero Aura (rule #1)');

select * from finish();
rollback;
