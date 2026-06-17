begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- schema + RLS shape
select has_table('public', 'push_tokens', 'push_tokens table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.push_tokens'::regclass),
  'RLS enabled on push_tokens'
);
select policies_are(
  'public', 'push_tokens',
  array['push_tokens_select_own', 'push_tokens_insert_own', 'push_tokens_update_own', 'push_tokens_delete_own'],
  'exactly the expected policies on push_tokens'
);

-- anon: no access at all (privileges revoked, not just RLS-filtered)
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.push_tokens $$,
  '42501', 'permission denied for table push_tokens', 'anon cannot read push_tokens'
);
select throws_ok(
  $$ insert into public.push_tokens (profile_id, token, platform)
     values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[x]', 'ios') $$,
  '42501', 'permission denied for table push_tokens', 'anon cannot insert push_tokens'
);
reset role;

-- user_a: registers own token
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.push_tokens (profile_id, token, platform)
     values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[aaa]', 'ios') $$,
  'member registers own push token'
);
select throws_ok(
  $$ insert into public.push_tokens (profile_id, token, platform)
     values ('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[bbb]', 'ios') $$,
  '42501', null, 'member cannot register a token for another profile'
);

-- seed a token owned by user_b (service role bypasses RLS), confirm user_a cannot see it
reset role;
insert into public.push_tokens (profile_id, token, platform)
  values ('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[ccc]', 'android');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.push_tokens),
  1::bigint,
  'member reads only own push tokens (not user_b''s)'
);

-- cross-user UPDATE affects 0 rows (USING filters user_b's row out of scope)
update public.push_tokens set device_id = 'hijack' where profile_id = '22222222-2222-2222-2222-222222222222';
reset role;
select is(
  (select count(*) from public.push_tokens where device_id = 'hijack'),
  0::bigint,
  'member cannot update another member''s token (0 rows affected)'
);

-- cross-user delete affects 0 rows
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.push_tokens where profile_id = '22222222-2222-2222-2222-222222222222';
reset role;
select is(
  (select count(*) from public.push_tokens where profile_id = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'member cannot delete another member''s token (0 rows affected)'
);

-- owner deletes own
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.push_tokens where profile_id = '11111111-1111-1111-1111-111111111111';
select is(
  (select count(*) from public.push_tokens where profile_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'member deletes own token'
);
reset role;

select * from finish();
rollback;
