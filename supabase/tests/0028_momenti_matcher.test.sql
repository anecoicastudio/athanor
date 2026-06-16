begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- three users: A & B share a tag (→ should match); C is isolated (no overlap)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','a@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','b@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','c@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
update public.profiles set identity_tags = array['design'], seeking = array['music'], locale='it'
  where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profiles set identity_tags = array['music'],  seeking = array['design'], locale='it'
  where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profiles set identity_tags = array['cooking'],seeking = array['gardening'], locale='it'
  where id='cccccccc-cccc-cccc-cccc-cccccccccccc';
insert into public.dreams (profile_id, text) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Un sogno A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Un sogno B'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','Un sogno C');

select ok(public.run_momenti_matcher() >= 2, 'matcher inserts at least the A↔B pair');

-- A got proposed B (seek_hit: A seeks music, B is music)
select results_eq(
  $$ select candidate_id from public.momento_proposals where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid) $$,
  'A is proposed B (mutual seeking overlap)');

-- never self-proposed
select is((select count(*)::int from public.momento_proposals where user_id = candidate_id), 0,
  'no self-proposals');

-- C (no overlap with anyone) gets nothing
select is((select count(*)::int from public.momento_proposals where user_id='cccccccc-cccc-cccc-cccc-cccccccccccc'), 0,
  'zero-affinity user gets no proposals');

-- reasons authored (≥1 string, IT voice)
select ok(
  (select array_length(reasons,1) from public.momento_proposals
    where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') >= 1,
  'proposal carries at least one reason string');

reset role;
select * from finish();
rollback;
