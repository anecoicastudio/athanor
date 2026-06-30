begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- one admin, one normal member
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','admin@test.athanor','{}'::jsonb,'{"role":"admin"}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','member@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now());

-- the DEFINER read functions exist
select has_function('public', 'admin_waitlist_count', 'admin_waitlist_count() exists');
select has_function('public', 'admin_list_waitlist', array['integer'], 'admin_list_waitlist(int) exists');

-- seed two signups (anon insert is allowed); explicit created_at for deterministic order
set local role anon;
set local request.jwt.claims = '';
insert into public.email_waitlist (email, locale, source, created_at)
  values ('a@test.athanor', 'it', 'landing-hero', now() - interval '1 hour');
insert into public.email_waitlist (email, locale, source, created_at)
  values ('b@test.athanor', 'en', 'landing-footer', now());
-- anon has no execute grant on the admin read fns → permission denied
select throws_ok(
  $$ select public.admin_waitlist_count() $$,
  '42501', null, 'anon cannot count the waitlist');
reset role;

-- non-admin member: both functions raise 42501 (is_admin gate)
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_waitlist_count() $$,
  '42501', null, 'member cannot count the waitlist');
select throws_ok(
  $$ select public.admin_list_waitlist() $$,
  '42501', null, 'member cannot list the waitlist');
reset role;

-- admin: count = 2, list returns both rows newest-first
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
select is(public.admin_waitlist_count(), 2, 'admin counts all signups');
select is((select count(*) from public.admin_list_waitlist())::int, 2, 'admin lists all signups');
select is(
  (select email from public.admin_list_waitlist() limit 1),
  'b@test.athanor', 'list is newest-first');
reset role;

select * from finish();
rollback;
