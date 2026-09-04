-- #123 — the matcher's fourth and fifth affinity terms (skills overlap, city
-- proximity) and their surfacing through get_momenti_deck()
-- (migration <ts>_momenti_skills_city_affinity_terms.sql).
--
-- The fixture isolates each term the way 0028's does: every pair that must NOT be
-- proposed sits at exactly ONE term (below the threshold of 2), so a term that
-- wrongly fires — a null geohash scoring, a masked field leaking — flips an
-- assertion instead of hiding under the cap.
--
--   ME  artista · skills {branding,seo,sviluppo-web} · Milano u0nd9
--   SK  no tags · skills {branding,sviluppo-web,copywriting}  → skills overlap 2 = proposed
--   CT  artista · Monza u0ndb (same 4-char cell as ME)        → tag 1 + city 1 = proposed
--   NG  artista · free-text city, NO geohash                  → 1, city term must stay zero
--   PC  artista · u0ndc but 'city' PRIVATE                    → 1, masked geohash must not score
--   PS  skills {branding,sviluppo-web} but 'skills' PRIVATE   → 0, masked skills must not score
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-0000-4000-8000-000000000099','authenticated','authenticated','me99@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000099','authenticated','authenticated','sk99@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000099','authenticated','authenticated','ct99@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000099','authenticated','authenticated','ng99@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000099','authenticated','authenticated','pc99@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000099','authenticated','authenticated','ps99@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
update public.profiles set handle='me99', identity_tags=array['artista'],
       skills=array['branding','seo','sviluppo-web'], city='Milano', city_geohash='u0nd9'
  where id='11111111-0000-4000-8000-000000000099';
update public.profiles set handle='sk99',
       skills=array['branding','sviluppo-web','copywriting']
  where id='aaaaaaaa-0000-4000-8000-000000000099';
update public.profiles set handle='ct99', identity_tags=array['artista'],
       city='Monza', city_geohash='u0ndb'
  where id='bbbbbbbb-0000-4000-8000-000000000099';
update public.profiles set handle='ng99', identity_tags=array['artista'],
       city='Roma'  -- typed free text: no geohash, by design (#149)
  where id='cccccccc-0000-4000-8000-000000000099';
update public.profiles set handle='pc99', identity_tags=array['artista'],
       city='Sesto San Giovanni', city_geohash='u0ndc', visibility='{"city":"private"}'::jsonb
  where id='dddddddd-0000-4000-8000-000000000099';
update public.profiles set handle='ps99',
       skills=array['branding','sviluppo-web'], visibility='{"skills":"private"}'::jsonb
  where id='eeeeeeee-0000-4000-8000-000000000099';

insert into public.dreams (profile_id, text) values
  ('11111111-0000-4000-8000-000000000099','Sogno ME'),
  ('aaaaaaaa-0000-4000-8000-000000000099','Sogno SK'),
  ('bbbbbbbb-0000-4000-8000-000000000099','Sogno CT'),
  ('cccccccc-0000-4000-8000-000000000099','Sogno NG'),
  ('dddddddd-0000-4000-8000-000000000099','Sogno PC'),
  ('eeeeeeee-0000-4000-8000-000000000099','Sogno PS');

-- Isolate the matcher's GLOBAL candidate pool to the six fixture users (the 0028
-- pattern): archive every other active dream so the assertions are deterministic.
update public.dreams set status = 'archived'
  where profile_id not in (
    '11111111-0000-4000-8000-000000000099',
    'aaaaaaaa-0000-4000-8000-000000000099',
    'bbbbbbbb-0000-4000-8000-000000000099',
    'cccccccc-0000-4000-8000-000000000099',
    'dddddddd-0000-4000-8000-000000000099',
    'eeeeeeee-0000-4000-8000-000000000099')
    and status = 'active' and deleted_at is null;

-- ── the matcher scores the two new terms (#123) ─────────────────────────────
select ok(public.run_momenti_matcher() >= 2, 'matcher inserts at least ME''s two proposals');

select results_eq(
  $$ select candidate_id from public.momento_proposals
      where user_id='11111111-0000-4000-8000-000000000099' and affinity >= 2
      order by candidate_id $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000099'::uuid),
            ('bbbbbbbb-0000-4000-8000-000000000099'::uuid) $$,
  'ME is proposed exactly SK (skills overlap alone) and CT (one tag + city proximity)'
);

select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000099'
      and candidate_id='aaaaaaaa-0000-4000-8000-000000000099'),
  2::numeric,
  'each shared skill counts one, at tag parity: two shared skills reach the threshold with nothing else'
);
select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000099'
      and candidate_id='bbbbbbbb-0000-4000-8000-000000000099'),
  2::numeric,
  'city proximity (4-char geohash prefix agreement) counts exactly one, completing a single-tag pair'
);

select is(
  (select count(*)::int from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000099'
      and candidate_id='cccccccc-0000-4000-8000-000000000099' and affinity >= 2),
  0,
  'a member with NO geohash (free-text city) contributes zero to the city term, gracefully'
);
select is(
  (select count(*)::int from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000099'
      and candidate_id='dddddddd-0000-4000-8000-000000000099' and affinity >= 2),
  0,
  'a candidate''s PRIVATE city masks the geohash before scoring — proximity never fires on it'
);
select is(
  (select count(*)::int from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000099'
      and candidate_id='eeeeeeee-0000-4000-8000-000000000099' and affinity >= 2),
  0,
  'a candidate''s PRIVATE skills mask the array before scoring — the overlap never fires on it'
);
reset role;

-- ── the deck surfaces the terms, masked and geohash-free (#123) ─────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000099","role":"authenticated"}';

select is(
  (select skills_shared from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000099'),
  array['branding','sviluppo-web'],
  'skills_shared: the skills you both claim, sorted, recomputed at read time'
);
select is(
  (select city_near from public.get_momenti_deck()
    where candidate_id='bbbbbbbb-0000-4000-8000-000000000099'),
  array['Monza'],
  'city_near carries the candidate''s city DISPLAY NAME, never the geohash'
);
select is(
  (select city_near from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000099'),
  '{}'::text[],
  'no geohash on the candidate: the city term is silent, the card still renders'
);
select throws_ok(
  $$ select city_geohash from public.get_momenti_deck() $$,
  '42703', null, 'city_geohash is not a column of the deck projection at all (0098''s promise holds here)'
);
reset role;

-- Read-time re-masking (#273 D): hiding a field AFTER the proposal was scored blanks
-- the term on the very next read — the stored row holds no prose to purge.
set local role service_role;
update public.profiles set visibility='{"city":"private"}'::jsonb
  where id='bbbbbbbb-0000-4000-8000-000000000099';
update public.profiles set visibility='{"skills":"private"}'::jsonb
  where id='aaaaaaaa-0000-4000-8000-000000000099';
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000099","role":"authenticated"}';
select is(
  (select city_near from public.get_momenti_deck()
    where candidate_id='bbbbbbbb-0000-4000-8000-000000000099'),
  '{}'::text[],
  'a city hidden after matching disappears from the reason on the next read'
);
select is(
  (select skills_shared from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000099'),
  '{}'::text[],
  'skills hidden after matching disappear from the reason on the next read'
);
reset role;

select * from finish();
rollback;
