-- Momento reasons are computed at READ time (#273 D), and the stale-reasons purge
-- apparatus that existed only because they were not is retired.
--
-- What this file used to assert: 20260807201350 + 20260807203343 deleted a candidate's
-- PENDING proposals (and blanked the text on accepted/passed ones) the moment they hid
-- or removed a tag, because `momento_reasons()` froze a prose snapshot at match time and
-- nothing ever refreshed it. get_momenti_deck() now recomputes and re-masks the terms on
-- every read, so the snapshot cannot rot — the trigger, its function and momento_reasons()
-- are all dropped, and the assertions below are the inverse of the old ones: hiding a tag
-- now MASKS a card instead of deleting it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000074','authenticated','authenticated','a74@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000074','authenticated','authenticated','b74@test.athanor','{}'::jsonb, now(), now());

-- ── the apparatus is gone ───────────────────────────────────────────────────
select is(
  (select count(*) from pg_trigger where tgname = 'profiles_purge_momenti'),
  0::bigint,
  'the profiles_purge_momenti trigger is dropped'
);
select hasnt_function('athanor', 'purge_stale_momento_proposals',
  'athanor.purge_stale_momento_proposals is dropped');
select hasnt_function('public', 'momento_reasons', array['text','text[]','text[]','text[]'],
  'momento_reasons (the frozen-prose author) is dropped');

set local role service_role;
-- A is the recipient, B the candidate: complementary in both directions (B is what A
-- seeks; A is what B seeks), so both the seek_hit and the offer_hit terms fire.
update public.profiles set handle = 'a74',
       identity_tags = array['freelance','artista'], seeking = array['mentorship']
  where id = 'aaaaaaaa-0000-4000-8000-000000000074';
update public.profiles set handle = 'b74',
       identity_tags = array['mentor','coach'], seeking = array['collaborazioni']
  where id = 'bbbbbbbb-0000-4000-8000-000000000074';
insert into public.dreams (profile_id, text)
  values ('bbbbbbbb-0000-4000-8000-000000000074','Il sogno di B');

-- Inserted directly rather than through the matcher: deterministic, and the matcher has
-- its own coverage in 0028 / 0073. `reasons` stays at its '{}' default — nothing writes
-- it any more.
insert into public.momento_proposals (user_id, candidate_id, affinity, status, proposed_on, daily_rank)
values ('aaaaaaaa-0000-4000-8000-000000000074','bbbbbbbb-0000-4000-8000-000000000074',
        4, 'pending', current_date, 1);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000074","role":"authenticated"}';
select is(
  (select seek_hit from public.get_momenti_deck()),
  array['coach','mentor'],
  'the deck reads the candidate''s CURRENT identity tags, not a snapshot'
);
reset role;

-- ── hiding a field masks the card, it no longer deletes it ──────────────────
set local role service_role;
update public.profiles set visibility = '{"identity_tags":"private"}'::jsonb
  where id = 'bbbbbbbb-0000-4000-8000-000000000074';
reset role;

select is(
  (select count(*) from public.momento_proposals
    where candidate_id = 'bbbbbbbb-0000-4000-8000-000000000074' and status = 'pending'),
  1::bigint,
  'hiding identity_tags no longer deletes the pending proposal (the old trigger did)'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000074","role":"authenticated"}';
select is(
  (select seek_hit from public.get_momenti_deck()),
  '{}'::text[],
  'the hidden field is masked out of the reason terms on the very next read'
);
-- `seeking` was left visible, so the term derived from it survives — the same
-- field-by-field boundary 0073 pins for the matcher.
select is(
  (select offer_hit from public.get_momenti_deck()),
  array['artista','freelance'],
  'a field the candidate did NOT hide still produces its term'
);
reset role;

-- ── editing a tag is reflected without a matcher run ────────────────────────
set local role service_role;
update public.profiles set visibility = '{}'::jsonb, identity_tags = array['coach']
  where id = 'bbbbbbbb-0000-4000-8000-000000000074';
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000074","role":"authenticated"}';
select is(
  (select seek_hit from public.get_momenti_deck()),
  array['coach'],
  'dropping a tag drops its term immediately — no stale prose to purge'
);
select is(
  (select count(*) from public.momento_proposals where reasons <> '{}'),
  0::bigint,
  'no row carries frozen reason prose any more'
);
reset role;

select * from finish();
rollback;
