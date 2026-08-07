-- M10 per-field visibility enforcement matrix (migration 20260807170813).
-- Personas: alice (mixed visibility), bob (plain member), carla (blocked by alice).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000072', 'alice72@test.dev'),
  ('bbbbbbbb-0000-0000-0000-000000000072', 'bob72@test.dev'),
  ('cccccccc-0000-0000-0000-000000000072', 'carla72@test.dev');

-- alice: private bio, members tags, public seeking, private dream; bob/carla: defaults ({}).
update public.profiles set
  handle = 'alice72',
  bio = 'segreto di alice',
  identity_tags = array['maker'],
  seeking = array['mentore'],
  visibility = '{"bio":"private","identity_tags":"members","seeking":"public","dream":"private"}'::jsonb
  where id = 'aaaaaaaa-0000-0000-0000-000000000072';
update public.profiles set handle = 'bob72', bio = 'bio di bob'
  where id = 'bbbbbbbb-0000-0000-0000-000000000072';

insert into public.dreams (id, profile_id, text, status) values
  ('dddddddd-0000-0000-0000-000000000072', 'aaaaaaaa-0000-0000-0000-000000000072', 'sogno privato di alice', 'active'),
  ('dddddddd-1111-0000-0000-000000000072', 'bbbbbbbb-0000-0000-0000-000000000072', 'sogno di bob', 'active');

insert into public.blocks (blocker_id, blocked_id) values
  ('aaaaaaaa-0000-0000-0000-000000000072', 'cccccccc-0000-0000-0000-000000000072');

-- ── bob (plain member) ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000072","role":"authenticated"}';

select throws_ok(
  $$ select bio from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000072' $$,
  '42501', null, 'direct bio select is column-denied for members'
);
select throws_ok(
  $$ select visibility from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000072' $$,
  '42501', null, 'direct visibility select is column-denied for members'
);
select is(
  (select bio from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000072')),
  null,
  'private bio is NULLed by get_person_profile'
);
select is(
  (select identity_tags from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000072')),
  array['maker'],
  'members tags are visible to a member'
);
select is(
  (select seeking from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000072')),
  array['mentore'],
  'public seeking is visible to a member'
);
select is(
  (select bio from public.get_person_profile('bbbbbbbb-0000-0000-0000-000000000072')),
  'bio di bob',
  'absent visibility key behaves as members (visible to a member)'
);
select is(
  (select count(*) from public.dreams where profile_id = 'aaaaaaaa-0000-0000-0000-000000000072'),
  0::bigint,
  'private dream is invisible to a member'
);
select is(
  (select count(*) from public.dreams where profile_id = 'bbbbbbbb-0000-0000-0000-000000000072'),
  1::bigint,
  'default (members) dream stays visible to a member'
);
-- search: alice matchable by handle, NOT by her private bio text; subtitle empty.
select is(
  (select count(*) from public.search_all('segreto')),
  0::bigint,
  'private bio text is not searchable'
);
select is(
  (select s.subtitle from public.search_all('alice72') s
    where s.id = 'aaaaaaaa-0000-0000-0000-000000000072' limit 1),
  '',
  'search subtitle is empty when bio is private (handle still matches)'
);
reset role;

-- ── alice (owner) ────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000072","role":"authenticated"}';
select is(
  (select bio from public.get_own_profile()),
  'segreto di alice',
  'owner reads own full row via get_own_profile'
);
select is(
  (select visibility ->> 'bio' from public.get_own_profile()),
  'private',
  'own visibility settings readable via get_own_profile'
);
select is(
  (select count(*) from public.dreams where profile_id = 'aaaaaaaa-0000-0000-0000-000000000072'),
  1::bigint,
  'owner still reads own private dream'
);
reset role;

-- ── carla (blocked by alice) ─────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000072","role":"authenticated"}';
select is(
  (select count(*) from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000072')),
  0::bigint,
  'blocked pair gets zero rows from get_person_profile'
);
reset role;

-- ── anon ─────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok(
  $$ select * from public.get_person_profile('aaaaaaaa-0000-0000-0000-000000000072') $$,
  '42501', null, 'anon cannot execute get_person_profile'
);
select throws_ok(
  $$ select * from public.get_own_profile() $$,
  '42501', null, 'anon cannot execute get_own_profile'
);
reset role;

select * from finish();
rollback;
