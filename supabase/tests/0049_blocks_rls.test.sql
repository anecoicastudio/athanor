begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'block_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'block_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── schema ──
select has_table('public', 'blocks', 'blocks exists');
select policies_are('public', 'blocks',
  array['blocks_select_own','blocks_insert_own','blocks_delete_own'],
  'exactly the three CRUD-own policies');
select ok(
  (select count(*) = 1 from pg_indexes
   where schemaname = 'public' and tablename = 'blocks'
     and indexname = 'blocks_pair'),
  'unique (blocker_id, blocked_id)');

select ok(
  (select indisunique
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'blocks_pair'
      and i.indrelid = 'public.blocks'::regclass),
  'blocks_pair index is UNIQUE');

-- ── anon denied ──
set local role anon;
select throws_ok($$ select * from public.blocks $$, '42501', null, 'anon SELECT denied');
reset role;

-- ── blocker CRUD own ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.blocks (blocked_id) values ('22222222-2222-2222-2222-222222222222') $$,
  'user_a blocks user_b (blocker_id defaults to auth.uid())');
select is((select count(*) from public.blocks)::int, 1, 'user_a sees own block');
select lives_ok(
  $$ delete from public.blocks where blocked_id = '22222222-2222-2222-2222-222222222222' $$,
  'user_a unblocks own');

-- ── cannot insert on another's behalf (WITH CHECK) ──
select throws_ok(
  $$ insert into public.blocks (blocker_id, blocked_id)
     values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'cannot forge a block as another user');

-- ── self-block rejected (check constraint 23514) ──
select throws_ok(
  $$ insert into public.blocks (blocked_id) values ('11111111-1111-1111-1111-111111111111') $$,
  '23514', null, 'self-block rejected');

-- ── blocker-only read: the blocked user never learns who blocked them ──
insert into public.blocks (blocked_id) values ('22222222-2222-2222-2222-222222222222');  -- a blocks b
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*) from public.blocks)::int, 0,
  'user_b cannot see the block row that targets them (blocker-only SELECT)');

-- ── ZERO AURA (rule #1) ──
select is(
  (select count(*)::int from public.aura_events
   where profile_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222')),
  0, 'blocking produced zero aura_events');
reset role;

select * from finish();
rollback;
