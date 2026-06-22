begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
        'authenticated', 'authenticated', 'audit_a@test.athanor', '{}'::jsonb, now(), now());

select has_table('public', 'audit_log', 'audit_log exists');
select col_is_pk('public', 'audit_log', 'id', 'id is PK');

-- RLS on + no client write policy
select is(
  (select rowsecurity from pg_tables where schemaname='public' and tablename='audit_log'),
  true, 'RLS enabled');

-- anon fully denied
set local role anon;
select throws_ok($$ select * from public.audit_log $$, '42501', null, 'anon SELECT denied');
reset role;

-- authenticated non-admin: client INSERT denied (no insert policy)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ insert into public.audit_log (report_id, actor_id, action) values
     (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'dismiss') $$,
  '42501', null, 'client INSERT denied (append-only)');
reset role;

-- action enum + penalty range enforced (as table owner)
select throws_ok(
  $$ insert into public.audit_log (report_id, actor_id, action) values
     (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'nope') $$,
  '23514', null, 'bad action rejected');
select throws_ok(
  $$ insert into public.audit_log (report_id, actor_id, action, penalty_points) values
     (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'penalty', -10) $$,
  '23514', null, 'penalty_points out of [-200,-50] rejected');

select * from finish();
rollback;
