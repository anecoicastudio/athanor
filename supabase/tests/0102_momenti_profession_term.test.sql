-- #361 — the matcher's seventh affinity term: PROFESSION COMPLEMENTARITY (the ruled
-- sparse map, athanor.profession_complements) and its surfacing through
-- get_momenti_deck() (migration <ts>_momenti_profession_term.sql).
--
-- The fixture isolates the term the way 0099/0100's do: every user shares ONE identity
-- tag with ME, so a pair sits at exactly one term (below the threshold of 2) unless
-- the profession term fires and lifts it over. A term that wrongly fires — same craft
-- scoring, a missing profession matching, a masked one leaking — flips the
-- proposal-set assertion instead of hiding under the cap.
--
--   ME    artista · design                              → the recipient under test
--   COMP  artista · sviluppo                            → design↔sviluppo = proposed at 2
--   SAME  artista · design                              → same craft must NOT fire → 1
--   NONE  artista · no profession                       → missing side scores zero → 1
--   NCMP  artista · arte                                → design↔arte not in the map → 1
--   MASK  artista · sviluppo, profession PRIVATE        → masked candidate must not leak → 1
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-0000-4000-8000-000000000102','authenticated','authenticated','me102@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000102','authenticated','authenticated','comp102@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000102','authenticated','authenticated','same102@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000102','authenticated','authenticated','none102@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000102','authenticated','authenticated','ncmp102@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000102','authenticated','authenticated','mask102@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
update public.profiles set handle='me102', identity_tags=array['artista'], profession='design'
  where id='11111111-0000-4000-8000-000000000102';
update public.profiles set handle='comp102', identity_tags=array['artista'], profession='sviluppo'
  where id='aaaaaaaa-0000-4000-8000-000000000102';
update public.profiles set handle='same102', identity_tags=array['artista'], profession='design'
  where id='bbbbbbbb-0000-4000-8000-000000000102';
update public.profiles set handle='none102', identity_tags=array['artista']
  where id='cccccccc-0000-4000-8000-000000000102';
update public.profiles set handle='ncmp102', identity_tags=array['artista'], profession='arte'
  where id='dddddddd-0000-4000-8000-000000000102';
update public.profiles set handle='mask102', identity_tags=array['artista'], profession='sviluppo',
       visibility='{"profession":"private"}'::jsonb
  where id='eeeeeeee-0000-4000-8000-000000000102';

insert into public.dreams (profile_id, text) values
  ('11111111-0000-4000-8000-000000000102','Sogno ME'),
  ('aaaaaaaa-0000-4000-8000-000000000102','Sogno COMP'),
  ('bbbbbbbb-0000-4000-8000-000000000102','Sogno SAME'),
  ('cccccccc-0000-4000-8000-000000000102','Sogno NONE'),
  ('dddddddd-0000-4000-8000-000000000102','Sogno NCMP'),
  ('eeeeeeee-0000-4000-8000-000000000102','Sogno MASK');

-- Isolate the matcher's GLOBAL candidate pool to the six fixture users (the 0028
-- pattern): archive every other active dream so the assertions are deterministic.
update public.dreams set status = 'archived'
  where profile_id not in (
    '11111111-0000-4000-8000-000000000102',
    'aaaaaaaa-0000-4000-8000-000000000102',
    'bbbbbbbb-0000-4000-8000-000000000102',
    'cccccccc-0000-4000-8000-000000000102',
    'dddddddd-0000-4000-8000-000000000102',
    'eeeeeeee-0000-4000-8000-000000000102')
    and status = 'active' and deleted_at is null;

-- ── the matcher scores the ruled map, once per pair (#361) ──────────────────
select ok(public.run_momenti_matcher() >= 1, 'matcher inserts at least ME''s proposal');

select results_eq(
  $$ select candidate_id from public.momento_proposals
      where user_id='11111111-0000-4000-8000-000000000102' and affinity >= 2
      order by candidate_id $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000102'::uuid) $$,
  'ME is proposed exactly COMP — same craft, no craft, an unmapped pair and a masked profession all stay at one term'
);

select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000102'
      and candidate_id='aaaaaaaa-0000-4000-8000-000000000102'),
  2::numeric,
  'a complementary craft counts once, at tag parity: shared tag + profession reach the threshold'
);
select is(
  (select affinity from public.momento_proposals
    where user_id='aaaaaaaa-0000-4000-8000-000000000102'
      and candidate_id='11111111-0000-4000-8000-000000000102'),
  2::numeric,
  'the map is symmetric IN THE ENGINE: sviluppo↔design scores the same the other way round'
);
reset role;

-- ── the deck names the craft pairing, caller's profession first (#361) ──────
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000102","role":"authenticated"}';

select is((select count(*)::int from public.get_momenti_deck()), 1,
  'the deck deals exactly the one complementary-craft card');
select is(
  (select profession_pair from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000102'),
  array['design','sviluppo'],
  'profession_pair carries the two profession KEYS, the caller''s craft first — never a score'
);
reset role;

-- Read-time re-masking (#273 D): hiding the field AFTER the proposal was scored blanks
-- the term on the very next read — the stored row holds no prose to purge.
set local role service_role;
update public.profiles set visibility='{"profession":"private"}'::jsonb
  where id='aaaaaaaa-0000-4000-8000-000000000102';
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000102","role":"authenticated"}';
select is(
  (select profession_pair from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000102'),
  '{}'::text[],
  'a profession masked after the match disappears from the reason on the next read'
);
reset role;

select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000102'
      and candidate_id='aaaaaaaa-0000-4000-8000-000000000102'),
  2::numeric,
  'the stored score does not chase the masking — re-masking is a read-time rule (#273 D)'
);

select * from finish();
rollback;
