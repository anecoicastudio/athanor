-- public.run_momenti_matcher — the nightly Momenti matcher, as replaced by
-- <ts>_momenti_affinity_and_deck.sql (#273 A/B/C/E).
--
-- The fixtures use the REAL onboarding vocabulary (packages/core/src/onboarding/tags.ts),
-- unlike the 'design'/'music' placeholders this file used to carry: the two vocabularies are
-- disjoint by construction, and the whole point of #273 A is the seeking → identity map, which
-- an invented tag cannot exercise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','a@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','b@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','c@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
-- A seeks mentorship and is a freelance; B is exactly that answer (mentor+coach) and seeks
-- collaborations, which A is. NOTHING is shared between them — this pair scores only on the
-- two terms that were structurally dead before #273.
update public.profiles set identity_tags = array['freelance'], seeking = array['mentorship'], locale='it'
  where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profiles set identity_tags = array['mentor','coach'], seeking = array['collaborazioni'], locale='it'
  where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
-- C is the rare-tag member: one artista among mentors. Against B she scores exactly ONE term
-- (B seeks collaborazioni, which artista answers) — below the threshold — and against A, none.
update public.profiles set identity_tags = array['artista'], seeking = array['eventi'], locale='it'
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

-- ── the map itself (#273 A) ─────────────────────────────────────────────────
-- Mirrored in packages/core/src/onboarding/affinity.ts; affinity.mirror.test.ts compares the
-- two, this asserts the SQL half actually answers.
select is(
  athanor.seeking_to_identity(array['mentorship']),
  array['coach','mentor'],
  'seeking «mentorship» expands to the identities that answer it'
);
select is(
  athanor.seeking_to_identity(array['connessioni','eventi']),
  '{}'::text[],
  'the two generic intents expand to nothing (they name no profession)'
);

select ok(public.run_momenti_matcher() >= 2, 'matcher inserts at least the A↔B pair and C''s fallback');

-- A is proposed B on COMPLEMENTARITY ALONE — the pair shares no identity tag at all.
select results_eq(
  $$ select candidate_id from public.momento_proposals where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid) $$,
  'A is proposed B (seek_hit + offer_hit, zero shared tags)');
select ok(
  (select affinity from public.momento_proposals
    where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') >= 2,
  'the pair scores at or above the threshold (#273 C)');

select is((select count(*)::int from public.momento_proposals where user_id = candidate_id), 0,
  'no self-proposals');

-- #273 C: C ↔ B has exactly one term (artista answers B''s «collaborazioni»), which used to be
-- enough under `affinity > 0`. It is not any more…
select is(
  (select count(*)::int from public.momento_proposals
    where user_id='cccccccc-cccc-cccc-cccc-cccccccccccc'
      and candidate_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      and affinity >= 2),
  0,
  'a single-term overlap is below the threshold and is not proposed as affinity');
-- …and #273 E: C is not left staring at an empty deck either. She gets exactly one card, at
-- affinity 0 — the dream-recency fallback the deck labels «Sogno nuovo».
select is(
  (select count(*)::int from public.momento_proposals
    where user_id='cccccccc-cccc-cccc-cccc-cccccccccccc' and affinity = 0),
  1,
  'a member who scores below the threshold against everyone gets one fallback card');

-- #273 D: nothing writes reason prose any more — the deck computes terms at read time.
select is(
  (select count(*)::int from public.momento_proposals where reasons <> '{}'),
  0,
  'the matcher writes no reason strings');

-- ── expiry (#273 B) ─────────────────────────────────────────────────────────
-- An unswiped pending row older than a week is deleted, so the matcher's cap stops sitting on
-- a backlog and the pair returns to the pool. A passed row is untouched: its passed_until must
-- keep suppressing re-proposal for the full 90 days.
insert into public.momento_proposals (user_id, candidate_id, affinity, daily_rank, proposed_on, status)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc', 3, 1,
   (now() at time zone 'utc')::date - 9, 'pending'),
  -- candidate B, not A: C already holds a fallback row for A from the run above, and
  -- (user_id, candidate_id) is unique.
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3, 2,
   (now() at time zone 'utc')::date - 9, 'passed');

select is(public.expire_momento_proposals(), 1, 'expiry deletes exactly the stale PENDING row');
select is(
  (select count(*)::int from public.momento_proposals
    where user_id='cccccccc-cccc-cccc-cccc-cccccccccccc' and status='passed'),
  1,
  'a passed row survives expiry (its 90-day window must not be freed early)');

-- Regression (daily_rank offset): a SECOND same-day run with a NEW eligible candidate for a
-- partially-filled recipient must NOT raise a daily_cap 23505, and must respect the ≤3/day cap.
reset role;   -- auth.users INSERT needs the superuser session role; service_role lacks it
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','dddddddd-dddd-dddd-dddd-dddddddddddd',
        'authenticated','authenticated','d@test.athanor','{}'::jsonb, now(), now());
set local role service_role;
update public.profiles set identity_tags = array['mentor','coach'], seeking = array['collaborazioni'], locale='it'
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd';   -- D, like B, answers what A seeks
insert into public.dreams (profile_id, text) values ('dddddddd-dddd-dddd-dddd-dddddddddddd','Un sogno D');

select lives_ok($$ select public.run_momenti_matcher() $$,
  'second same-day run does not raise on a partially-filled recipient');
select ok(
  (select count(*)::int from public.momento_proposals
     where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and proposed_on = (now() at time zone 'utc')::date) <= 3,
  'recipient A never exceeds the ≤3/day cap across re-runs');

-- #273 B: the cap is on WAITING cards, not on rows written today. A holds B and D from the two
-- runs above; top her up to three pending and a further run must add nothing — otherwise a
-- member who never swipes collects three more every night, each one firing «Hai un Momento».
insert into public.momento_proposals (user_id, candidate_id, affinity, daily_rank, proposed_on)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc',
        2, 3, (now() at time zone 'utc')::date);
select public.run_momenti_matcher();
select is(
  (select count(*)::int from public.momento_proposals
     where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and status='pending'),
  3,
  'a member already holding three waiting Momenti gets none added');
reset role;
select * from finish();
rollback;
