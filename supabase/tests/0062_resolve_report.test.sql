begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- one admin, one normal member, one target
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','admin@test.athanor','{}'::jsonb,'{"role":"admin"}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','member@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','target@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now());

-- a seeded open report (member reports target)
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
insert into public.reports (id, target_type, target_id, category)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd','person','cccccccc-cccc-cccc-cccc-cccccccccccc','spam');
reset role;

-- is_admin: false for member, true for admin
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select is(athanor.is_admin(), false, 'member is not admin');
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
select is(athanor.is_admin(), true, 'admin app_metadata recognized');

-- reports_select_admin: admin sees the member's report
set local role authenticated;
select is((select count(*) from public.reports where id='dddddddd-dddd-dddd-dddd-dddddddddddd')::int, 1, 'admin reads any report');
reset role;

-- non-admin resolve_report → 42501
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select throws_ok(
  $$ select public.resolve_report('dddddddd-dddd-dddd-dddd-dddddddddddd','dismissed','x','dismiss') $$,
  '42501', null, 'non-admin cannot resolve');
reset role;

-- admin upholds with penalty
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
select lives_ok(
  $$ select public.resolve_report('dddddddd-dddd-dddd-dddd-dddddddddddd','upheld','breaks the rules','penalty','high',-200) $$,
  'admin upholds with penalty');
select is((select status from public.reports where id='dddddddd-dddd-dddd-dddd-dddddddddddd'),'upheld','status upheld');
select is((select count(*) from public.audit_log where report_id='dddddddd-dddd-dddd-dddd-dddddddddddd' and action='penalty' and penalty_points=-200)::int,1,'audit row written');
-- rule #1: the RPC wrote NO aura_events (service_role for true global — own-row SELECT RLS would hide others)
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
     where profile_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
       and ref_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  0, 'RPC writes no aura_events (rule #1)');
reset role;

-- second resolve is a no-op (already upheld → not in open/reviewing)
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
set local role authenticated;
select lives_ok(
  $$ select public.resolve_report('dddddddd-dddd-dddd-dddd-dddddddddddd','dismissed','x','dismiss') $$,
  'second verdict no-ops on resolved report');
reset role;

-- penalty on non-person target → 22023 (a post target is named — since #611 a 'post' report
-- cannot be filed without one; no FK, so the id need not resolve)
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
insert into public.reports (id, target_type, target_id, category)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','post', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'spam');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
select throws_ok(
  $$ select public.resolve_report('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','upheld','test','penalty','high',-200) $$,
  '22023', null, 'penalty on non-person target raises 22023');
reset role;

select * from finish();
rollback;
