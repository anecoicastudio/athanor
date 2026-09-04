-- #384 — the matcher and the deck compute the seven affinity terms ONCE
-- (migration <ts>_momento_terms_once.sql).
--
-- The class of bug this closes: the two chains were hand-copied, and three of their
-- copies had drifted, so a pair could SCORE on a term the card could not DISPLAY. The
-- parity assertions below are what stops the class from coming back — everything the
-- deck projects must be what the matcher summed, row for row, array for array.
--
-- The three divergences #384 ruled away, each pinned as BEHAVIOUR rather than as SQL
-- text (the regexes in affinity.mirror.test.ts pinned syntax and were unpinned by a
-- reformat):
--
--   A. city needs a DISPLAY NAME, not only a matching geohash cell → NOCT
--   B. an already soft-deleted event neither scores nor is named    → DEAD
--   C. mutual activity is TITLES, and its length is the score       → LIVE
--
-- The fixture isolates each term the way 0099/0100/0102's do: every user shares ONE
-- identity tag with ME, so a pair sits at exactly one term — below the threshold of 2 —
-- unless the term under test fires and lifts it over. A term that wrongly fires flips
-- the proposal-set assertion instead of hiding under the cap.
--
--   ME    artista · Milano u0nd9 · design · organizes and checked in at all four events
--   CITY  artista · Monza  u0ndb            → same 4-char cell WITH a name  → proposed at 2
--   NOCT  artista · (no city) u0ndc         → same cell, NO name (A)       → stays at 1
--   DEAD  artista · 2 shared events, both soft-deleted BEFORE the pass (B) → stays at 1
--   LIVE  artista · 2 shared events, live                            (C)   → proposed at 3
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-0000-4000-8000-000000000122','authenticated','authenticated','me122@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000122','authenticated','authenticated','city122@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000122','authenticated','authenticated','noct122@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000122','authenticated','authenticated','dead122@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000122','authenticated','authenticated','live122@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
update public.profiles set handle='me122', identity_tags=array['artista'],
       city='Milano', city_geohash='u0nd9', profession='design'
  where id='11111111-0000-4000-8000-000000000122';
update public.profiles set handle='city122', identity_tags=array['artista'],
       city='Monza', city_geohash='u0ndb'
  where id='aaaaaaaa-0000-4000-8000-000000000122';
-- Divergence A's whole point: a geohash with no display name behind it. Unreachable
-- through the app today (#149 stores a geohash only for a PICKED city) but nothing in
-- the schema forbids the row, and the matcher used to score it.
update public.profiles set handle='noct122', identity_tags=array['artista'],
       city=null, city_geohash='u0ndc'
  where id='bbbbbbbb-0000-4000-8000-000000000122';
update public.profiles set handle='dead122', identity_tags=array['artista']
  where id='cccccccc-0000-4000-8000-000000000122';
update public.profiles set handle='live122', identity_tags=array['artista']
  where id='dddddddd-0000-4000-8000-000000000122';

insert into public.dreams (profile_id, text) values
  ('11111111-0000-4000-8000-000000000122','Sogno ME'),
  ('aaaaaaaa-0000-4000-8000-000000000122','Sogno CITY'),
  ('bbbbbbbb-0000-4000-8000-000000000122','Sogno NOCT'),
  ('cccccccc-0000-4000-8000-000000000122','Sogno DEAD'),
  ('dddddddd-0000-4000-8000-000000000122','Sogno LIVE');

-- Isolate the matcher's GLOBAL candidate pool to the five fixture users (the 0028
-- pattern): archive every other active dream so the assertions are deterministic.
update public.dreams set status = 'archived'
  where profile_id not in (
    '11111111-0000-4000-8000-000000000122',
    'aaaaaaaa-0000-4000-8000-000000000122',
    'bbbbbbbb-0000-4000-8000-000000000122',
    'cccccccc-0000-4000-8000-000000000122',
    'dddddddd-0000-4000-8000-000000000122')
    and status = 'active' and deleted_at is null;

-- Four events, ME organizing, starts_at strictly descending so the deck's newest-first
-- title order is deterministic.
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at) values
  ('eeeeeeee-0000-4000-8000-000000000221','11111111-0000-4000-8000-000000000122','Serata Viva Uno','networking', true,'https://athanor.test/v1', now() - interval '1 day'),
  ('eeeeeeee-0000-4000-8000-000000000222','11111111-0000-4000-8000-000000000122','Serata Viva Due','networking', true,'https://athanor.test/v2', now() - interval '2 days'),
  ('eeeeeeee-0000-4000-8000-000000000223','11111111-0000-4000-8000-000000000122','Serata Morta Uno','arte', true,'https://athanor.test/m1', now() - interval '3 days'),
  ('eeeeeeee-0000-4000-8000-000000000224','11111111-0000-4000-8000-000000000122','Serata Morta Due','arte', true,'https://athanor.test/m2', now() - interval '4 days');

insert into public.event_tickets (id, user_id, event_id, status) values
  ('ffffffff-0000-4000-8000-000000000211','11111111-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000221','checked_in'),
  ('ffffffff-0000-4000-8000-000000000212','11111111-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000222','checked_in'),
  ('ffffffff-0000-4000-8000-000000000213','11111111-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000223','checked_in'),
  ('ffffffff-0000-4000-8000-000000000214','11111111-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000224','checked_in'),
  ('ffffffff-0000-4000-8000-000000000241','dddddddd-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000221','checked_in'),
  ('ffffffff-0000-4000-8000-000000000242','dddddddd-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000222','checked_in'),
  ('ffffffff-0000-4000-8000-000000000231','cccccccc-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000223','checked_in'),
  ('ffffffff-0000-4000-8000-000000000232','cccccccc-0000-4000-8000-000000000122','eeeeeeee-0000-4000-8000-000000000224','checked_in');

insert into public.event_attendance (ticket_id, event_id, scanned_by)
select t.id, t.event_id, '11111111-0000-4000-8000-000000000122'
  from public.event_tickets t
 where t.status = 'checked_in'
   and t.event_id in (
     'eeeeeeee-0000-4000-8000-000000000221','eeeeeeee-0000-4000-8000-000000000222',
     'eeeeeeee-0000-4000-8000-000000000223','eeeeeeee-0000-4000-8000-000000000224');

-- Divergence B: the two evenings ME and DEAD shared are soft-deleted BEFORE the pass
-- runs. 0100:141-164 covers the other direction — a deletion landing AFTER the match,
-- which still must not rewrite the stored score.
update public.events set deleted_at = now()
  where id in ('eeeeeeee-0000-4000-8000-000000000223','eeeeeeee-0000-4000-8000-000000000224');
reset role;

-- ── the matcher scores what the deck can display, and nothing else ──────────
select ok(public.run_momenti_matcher() >= 2, 'matcher inserts at least ME''s two proposals');

select results_eq(
  $$ select candidate_id from public.momento_proposals
      where user_id='11111111-0000-4000-8000-000000000122' and affinity >= 2
      order by candidate_id $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000122'::uuid),
            ('dddddddd-0000-4000-8000-000000000122'::uuid) $$,
  'ME is proposed exactly CITY and LIVE — a geohash without a city name and a pair of dead listings both stay at one term'
);

select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000122'
      and candidate_id='aaaaaaaa-0000-4000-8000-000000000122'),
  2::numeric,
  'CITY reaches the threshold on shared tag + city proximity'
);
select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000122'
      and candidate_id='dddddddd-0000-4000-8000-000000000122'),
  3::numeric,
  'LIVE reaches 3 on shared tag + two live shared evenings'
);

-- ── divergence A: the term needs a name to put on the card ──────────────────
select is(
  (select city_near from athanor.momento_terms(
     '11111111-0000-4000-8000-000000000122','aaaaaaaa-0000-4000-8000-000000000122')),
  array['Monza'],
  'city_near carries the candidate''s DISPLAY NAME — never the geohash (0098)'
);
select is(
  (select city_near from athanor.momento_terms(
     '11111111-0000-4000-8000-000000000122','bbbbbbbb-0000-4000-8000-000000000122')),
  '{}'::text[],
  '#384 A: u0ndc agrees with u0nd9 at the match precision, but with no city name there is nothing to display'
);
select is(
  (select affinity from athanor.momento_terms(
     '11111111-0000-4000-8000-000000000122','bbbbbbbb-0000-4000-8000-000000000122')),
  1::numeric,
  '#384 A: and so it does not score either — the matcher used to, the deck never could'
);

-- ── divergence B: a dead listing is neither named nor scored ────────────────
select is(
  (select mutual_activity from athanor.momento_terms(
     '11111111-0000-4000-8000-000000000122','cccccccc-0000-4000-8000-000000000122')),
  '{}'::text[],
  '#384 B: a soft-deleted event is not named'
);
select is(
  (select affinity from athanor.momento_terms(
     '11111111-0000-4000-8000-000000000122','cccccccc-0000-4000-8000-000000000122')),
  1::numeric,
  '#384 B: nor scored — two dead evenings used to be enough to propose a card that then rendered with no reasons'
);

-- ── divergence C: titles, newest first, and the length IS the score ─────────
select is(
  (select mutual_activity from athanor.momento_terms(
     '11111111-0000-4000-8000-000000000122','dddddddd-0000-4000-8000-000000000122')),
  array['Serata Viva Uno','Serata Viva Due'],
  '#384 C: one join serves both sides — TITLES for the deck, newest first; ids never leave the server'
);

-- The tunables are LIVE, not documentation: the score is derived from
-- athanor.momento_affinity_constants(), so a weight that drifts from
-- packages/core/src/onboarding/affinity.ts changes what the matcher does.
select is(
  (select affinity from athanor.momento_terms(
     '11111111-0000-4000-8000-000000000122','dddddddd-0000-4000-8000-000000000122')),
  ((athanor.momento_affinity_constants() ->> 'tag')::numeric * 1
 + (athanor.momento_affinity_constants() ->> 'activity')::numeric * 2),
  'the scoring expression reads its weights from athanor.momento_affinity_constants()'
);

-- ── the parity that closes the class ────────────────────────────────────────
-- Both halves need auth.uid() (the deck) AND execute on athanor.momento_terms (revoked
-- from every client role, service_role included), so these two run as the owning role
-- with the JWT claim set rather than under `set local role authenticated`. auth.uid()
-- reads the GUC, not the role, and get_momenti_deck() is DEFINER — the authenticated
-- call path itself is covered by 0089/0100/0102.
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000122","role":"authenticated"}';

select results_eq(
  $$ select d.candidate_id, d.shared, d.seek_hit, d.offer_hit, d.skills_shared,
            d.city_near, d.mutual_activity, d.profession_pair
       from public.get_momenti_deck() d
      order by d.candidate_id $$,
  $$ select mp.candidate_id, t.shared, t.seek_hit, t.offer_hit, t.skills_shared,
            t.city_near, t.mutual_activity, t.profession_pair
       from public.momento_proposals mp
       cross join lateral athanor.momento_terms(mp.user_id, mp.candidate_id) t
      where mp.user_id='11111111-0000-4000-8000-000000000122' and mp.status='pending'
      order by mp.candidate_id $$,
  '#384: every array the deck projects is the one athanor.momento_terms() produced — no second copy to drift'
);

select results_eq(
  $$ select mp.candidate_id, mp.affinity
       from public.momento_proposals mp
      where mp.user_id='11111111-0000-4000-8000-000000000122' and mp.status='pending'
      order by mp.candidate_id $$,
  $$ select mp.candidate_id, t.affinity
       from public.momento_proposals mp
       cross join lateral athanor.momento_terms(mp.user_id, mp.candidate_id) t
      where mp.user_id='11111111-0000-4000-8000-000000000122' and mp.status='pending'
      order by mp.candidate_id $$,
  '#384: and the score the matcher stored is the sum of those same terms'
);

-- ── read-time re-masking still holds through the shared function (#273 D) ───
set local role service_role;
update public.profiles set visibility='{"city":"private"}'::jsonb
  where id='aaaaaaaa-0000-4000-8000-000000000122';
reset role;

set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000122","role":"authenticated"}';
select is(
  (select city_near from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000122'),
  '{}'::text[],
  'a city masked after the match disappears from the reason on the next read — one masking rule, both call sites (#384 D)'
);
select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000122'
      and candidate_id='aaaaaaaa-0000-4000-8000-000000000122'),
  2::numeric,
  'the stored score does not chase the masking — re-masking is a read-time rule (#273 D)'
);

select * from finish();
rollback;
