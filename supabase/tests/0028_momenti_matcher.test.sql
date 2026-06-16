begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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

-- Isolate the matcher's GLOBAL candidate pool to just A/B/C: archive every OTHER profile's active
-- dream (incl. seed.sql's sole/luna + any fixture) so the matcher pairs only the three test users and
-- the assertions are deterministic. Rolled back with the test txn. D (added later for the regression)
-- is inserted AFTER this, so it stays an eligible candidate.
update public.dreams set status = 'archived'
  where profile_id not in (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'cccccccc-cccc-cccc-cccc-cccccccccccc')
    and status = 'active' and deleted_at is null;

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

-- Regression (daily_rank offset): a SECOND same-day run with a NEW eligible candidate for a
-- partially-filled recipient must NOT raise a daily_cap 23505, and must respect the ≤3/day cap.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','dddddddd-dddd-dddd-dddd-dddddddddddd',
        'authenticated','authenticated','d@test.athanor','{}'::jsonb, now(), now());
set local role service_role;
update public.profiles set identity_tags = array['music'], seeking = array['design'], locale='it'
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd';   -- D, like B, matches A (A seeks music)
insert into public.dreams (profile_id, text) values ('dddddddd-dddd-dddd-dddd-dddddddddddd','Un sogno D');

select lives_ok($$ select public.run_momenti_matcher() $$,
  'second same-day run does not raise on a partially-filled recipient');
select ok(
  (select count(*)::int from public.momento_proposals
     where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and proposed_on = (now() at time zone 'utc')::date) <= 3,
  'recipient A never exceeds the ≤3/day cap across re-runs');
reset role;
select * from finish();
rollback;
