begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pred_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'pred_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

select has_function('athanor', 'not_blocked', array['uuid'], 'athanor.not_blocked(uuid) exists');

-- one live post per user (members-wide reads, no blocks yet)
set local role service_role;
insert into public.posts (author_id, category, body) values
  ('11111111-1111-1111-1111-111111111111','human','post by a'),
  ('22222222-2222-2222-2222-222222222222','human','post by b');
reset role;

set local role authenticated;

-- ── no block: predicate true, both profiles + both posts visible ──
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(athanor.not_blocked('22222222-2222-2222-2222-222222222222'), true,
  'no block → not_blocked true');
select is((select count(*) from public.profiles where id='22222222-2222-2222-2222-222222222222')::int, 1,
  'a sees b profile (pre-block)');

-- a blocks b
insert into public.blocks (blocked_id) values ('22222222-2222-2222-2222-222222222222');

-- ── predicate both directions ──
select is(athanor.not_blocked('22222222-2222-2222-2222-222222222222'), false,
  'as a: not_blocked(b) false');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(athanor.not_blocked('11111111-1111-1111-1111-111111111111'), false,
  'as b: not_blocked(a) false (other direction)');

-- ── mutual invisibility BOTH directions on profiles (the root) — §2B-08 ──
select is((select count(*) from public.profiles where id='11111111-1111-1111-1111-111111111111')::int, 0,
  'b cannot see a profile');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*) from public.profiles where id='22222222-2222-2222-2222-222222222222')::int, 0,
  'a cannot see b profile');

-- ── mutual invisibility BOTH directions on posts ──
select is((select count(*) from public.posts where author_id='22222222-2222-2222-2222-222222222222')::int, 0,
  'a cannot see b posts');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*) from public.posts where author_id='11111111-1111-1111-1111-111111111111')::int, 0,
  'b cannot see a posts');
reset role;

select * from finish();
rollback;
