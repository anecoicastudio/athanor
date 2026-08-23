-- 0132_momento_suggestions.test.sql
-- #124 — «Ti potrebbe interessare» ranks by affinity, and the table it ranks from is
-- unreachable from a client.
--
-- Three things fail independently here, so all three are asserted:
--   1. the SURFACE — momento_suggestions carries no client privilege at all. Asserted as
--      privileges (has_table_privilege / has_column_privilege), never as a failing read: a
--      read can be swallowed by RLS and pass for the wrong reason, which is exactly what
--      #404 found. `affinity` gets its own assertion because it is the one column whose
--      exposure would break rule 3 rather than merely widen the surface.
--   2. the FILL — run_momenti_matcher()'s third pass, and the six sets it excludes. Every
--      excluded candidate below SCORES; the pair is dropped by its gate, not by having
--      nothing in common, so an assertion going green because the fixture was inert is not
--      available.
--   3. the READ — get_momenti_suggestion() serves the latest run in rank order, RECOMPUTES the
--      reason kinds against live masked fields (#273 D: the table stores the ranking, never what
--      a row says), re-checks everything else that can change under a snapshot, and falls back
--      to dream recency for a member no run has reached yet.
--
-- FIXTURE SHAPE. M's deck is pre-filled to three PENDING proposals, which takes M out of the
-- matcher's recipient set for both proposal passes (pending_count < 3 fails). Without that,
-- the affinity pass would propose M the very candidates this file expects to find under
-- suggestions — correctly, since a suggestion is by definition someone NOT in your deck — and
-- the assertions would be measuring the deck's cap instead of the suggestion ranking.
--
--   M      artista+mentor+coach · skills {branding}   the caller
--   S1     artista+mentor+coach                       shared 3 → rank 1
--   S3     artista+mentor                             shared 2 → rank 2
--   S2     artista                                    shared 1 → rank 3
--   DECK1  artista+mentor        (pending proposal)   scores 2, in today's deck
--   PASS1  artista+mentor        (passed, +60d)       scores 2, passed inside the 90d window
--   CONN1  artista+mentor        (connected)          scores 2, already in Connessioni
--   BLK1   artista+mentor        (blocked M)          scores 2, blocked
--   BAN1   artista+mentor        (banned_at set)      scores 2, banned
--   PRIV1  artista+mentor · skills {branding}         scores 1 on SKILLS — which the
--                                identity_tags+seeking both private   both-private gate must
--                                                     still drop, or the gate would be
--                                                     untested against a masked-to-zero pair
--   Z1,Z2  no dream                                   deck filler only, never candidates
--
-- CI-only (hosted lacks pgtap).

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11110000-0000-4000-8000-000000000132','authenticated','authenticated','m132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','22220000-0000-4000-8000-000000000132','authenticated','authenticated','s1-132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','33330000-0000-4000-8000-000000000132','authenticated','authenticated','s3-132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','44440000-0000-4000-8000-000000000132','authenticated','authenticated','s2-132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','55550000-0000-4000-8000-000000000132','authenticated','authenticated','deck132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','66660000-0000-4000-8000-000000000132','authenticated','authenticated','pass132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','77770000-0000-4000-8000-000000000132','authenticated','authenticated','conn132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','88880000-0000-4000-8000-000000000132','authenticated','authenticated','blk132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','99990000-0000-4000-8000-000000000132','authenticated','authenticated','ban132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','aaaa0000-0000-4000-8000-000000000132','authenticated','authenticated','priv132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbb0000-0000-4000-8000-000000000132','authenticated','authenticated','z1-132@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccc0000-0000-4000-8000-000000000132','authenticated','authenticated','z2-132@test.athanor','{}'::jsonb, now(), now());

set local role service_role;

update public.profiles set identity_tags = array['artista','mentor','coach'],
                           skills = array['branding'], locale = 'it'
  where id = '11110000-0000-4000-8000-000000000132';
update public.profiles set identity_tags = array['artista','mentor','coach'], locale = 'it'
  where id = '22220000-0000-4000-8000-000000000132';
update public.profiles set identity_tags = array['artista','mentor'], locale = 'it'
  where id = '33330000-0000-4000-8000-000000000132';
update public.profiles set identity_tags = array['artista'], locale = 'it'
  where id = '44440000-0000-4000-8000-000000000132';
update public.profiles set identity_tags = array['artista','mentor'], locale = 'it'
  where id in ('55550000-0000-4000-8000-000000000132','66660000-0000-4000-8000-000000000132',
               '77770000-0000-4000-8000-000000000132','88880000-0000-4000-8000-000000000132',
               '99990000-0000-4000-8000-000000000132');
-- PRIV1 scores on skills, which stay visible; only the two tag fields are private.
update public.profiles set identity_tags = array['artista','mentor'],
                           skills = array['branding'], locale = 'it',
                           visibility = '{"identity_tags":"private","seeking":"private"}'::jsonb
  where id = 'aaaa0000-0000-4000-8000-000000000132';
update public.profiles set banned_at = now()
  where id = '99990000-0000-4000-8000-000000000132';

-- Z1/Z2 deliberately get NO dream: they exist only to fill M's deck, never as candidates.
insert into public.dreams (profile_id, text) values
  ('11110000-0000-4000-8000-000000000132','Sogno di M'),
  ('22220000-0000-4000-8000-000000000132','Sogno di S1'),
  ('33330000-0000-4000-8000-000000000132','Sogno di S3'),
  ('44440000-0000-4000-8000-000000000132','Sogno di S2'),
  ('55550000-0000-4000-8000-000000000132','Sogno di DECK1'),
  ('66660000-0000-4000-8000-000000000132','Sogno di PASS1'),
  ('77770000-0000-4000-8000-000000000132','Sogno di CONN1'),
  ('88880000-0000-4000-8000-000000000132','Sogno di BLK1'),
  ('99990000-0000-4000-8000-000000000132','Sogno di BAN1'),
  ('aaaa0000-0000-4000-8000-000000000132','Sogno di PRIV1');

-- Isolate the global candidate pool to this file's fixtures (the same move 0028 makes, and for
-- the same reason: the matcher pairs against every profile in the schema).
update public.dreams set status = 'archived'
  where profile_id not in (
    '11110000-0000-4000-8000-000000000132','22220000-0000-4000-8000-000000000132',
    '33330000-0000-4000-8000-000000000132','44440000-0000-4000-8000-000000000132',
    '55550000-0000-4000-8000-000000000132','66660000-0000-4000-8000-000000000132',
    '77770000-0000-4000-8000-000000000132','88880000-0000-4000-8000-000000000132',
    '99990000-0000-4000-8000-000000000132','aaaa0000-0000-4000-8000-000000000132')
    and status = 'active' and deleted_at is null;

insert into public.blocks (blocker_id, blocked_id)
values ('88880000-0000-4000-8000-000000000132','11110000-0000-4000-8000-000000000132');

insert into public.connections (profile_a, profile_b)
values (least('11110000-0000-4000-8000-000000000132'::uuid, '77770000-0000-4000-8000-000000000132'::uuid),
        greatest('11110000-0000-4000-8000-000000000132'::uuid, '77770000-0000-4000-8000-000000000132'::uuid));

-- M's deck: three pending cards, which takes M out of both proposal passes. PASS1 is a fourth
-- row, already swiped away and inside its 90-day window.
insert into public.momento_proposals (user_id, candidate_id, affinity, daily_rank, proposed_on, status)
values
  ('11110000-0000-4000-8000-000000000132','55550000-0000-4000-8000-000000000132', 2, 1,
   (now() at time zone 'utc')::date, 'pending'),
  ('11110000-0000-4000-8000-000000000132','bbbb0000-0000-4000-8000-000000000132', 2, 2,
   (now() at time zone 'utc')::date, 'pending'),
  ('11110000-0000-4000-8000-000000000132','cccc0000-0000-4000-8000-000000000132', 2, 3,
   (now() at time zone 'utc')::date, 'pending');
insert into public.momento_proposals
      (user_id, candidate_id, affinity, daily_rank, proposed_on, status, passed_until)
values
  ('11110000-0000-4000-8000-000000000132','66660000-0000-4000-8000-000000000132', 2, 1,
   (now() at time zone 'utc')::date - 5, 'passed', (now() at time zone 'utc')::date + 60);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. The surface — no client privilege on the table, and none on `affinity`
-- ─────────────────────────────────────────────────────────────────────────────────────
reset role;

select is_empty(
  $$ select r.role || ' / ' || v.priv
       from (values ('anon'), ('authenticated')) as r(role)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as v(priv)
      where has_table_privilege(r.role, 'public.momento_suggestions', v.priv) $$,
  'no client role holds ANY table privilege on momento_suggestions'
);

-- Column privileges are a separate ACL and a `revoke all on table` does not imply them, so the
-- one column that rule 3 turns on is asserted by name rather than inferred from the row above.
select ok(
  not has_column_privilege('authenticated', 'public.momento_suggestions', 'affinity', 'SELECT'),
  'authenticated cannot SELECT momento_suggestions.affinity (rule 3: the score never leaves the server)'
);
select ok(
  not has_column_privilege('anon', 'public.momento_suggestions', 'affinity', 'SELECT'),
  'anon cannot SELECT momento_suggestions.affinity'
);

select is_empty(
  $$ select v.priv from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as v(priv)
      where not has_table_privilege('service_role', 'public.momento_suggestions', v.priv) $$,
  'service_role keeps the full read/write surface — it is the sole writer'
);

select ok(
  (select c.relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'momento_suggestions'),
  'RLS is enabled on momento_suggestions'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'momento_suggestions'),
  0,
  'no client policies: RLS-on with zero policies is the deny-all, as on push_receipts'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. Constraints — the shape the fill relies on
-- ─────────────────────────────────────────────────────────────────────────────────────
set local role service_role;

select throws_ok(
  $$ insert into public.momento_suggestions (user_id, candidate_id, affinity, computed_on, rank)
     values ('11110000-0000-4000-8000-000000000132','11110000-0000-4000-8000-000000000132',
             1, current_date, 1) $$,
  '23514',
  null,
  'a member is never suggested to themselves');

select throws_ok(
  $$ insert into public.momento_suggestions (user_id, candidate_id, affinity, computed_on, rank)
     values ('11110000-0000-4000-8000-000000000132','22220000-0000-4000-8000-000000000132',
             1, current_date, 4) $$,
  '23514',
  null,
  'rank is bounded to the three rows PRD §4.7 asks for');

select throws_ok(
  $$ insert into public.momento_suggestions (user_id, candidate_id, affinity, computed_on, rank)
     values ('11110000-0000-4000-8000-000000000132','22220000-0000-4000-8000-000000000132',
             0, current_date, 1) $$,
  '23514',
  null,
  'affinity 0 is not a suggestion — that member falls through to the cold-start arm');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. The fill
-- ─────────────────────────────────────────────────────────────────────────────────────
select public.run_momenti_matcher();

select results_eq(
  $$ select candidate_id, rank from public.momento_suggestions
      where user_id = '11110000-0000-4000-8000-000000000132' order by rank $$,
  $$ values ('22220000-0000-4000-8000-000000000132'::uuid, 1::smallint),
            ('33330000-0000-4000-8000-000000000132'::uuid, 2::smallint),
            ('44440000-0000-4000-8000-000000000132'::uuid, 3::smallint) $$,
  'the list is ranked by AFFINITY (3, 2, 1 shared tags), not by dream recency');

select is_empty(
  $$ select a.attname::text from pg_attribute a
      where a.attrelid = 'public.momento_suggestions'::regclass
        and a.attname = 'reasons' and a.attnum > 0 and not a.attisdropped $$,
  'the table stores no reason kinds — a frozen reason outlives the field it came from (#273 D)');

-- The premise every exclusion below rests on. Without it each `count = 0` would also pass on a
-- fixture that simply had nothing in common with M, and the gate it names would go untested.
-- athanor.momento_terms() carries no block and no ban gate of its own — its callers do — so all
-- six score here and are dropped by the matcher, which is exactly what is being asserted.
reset role;
select is_empty(
  $$ select c.id::text
       from (values ('55550000-0000-4000-8000-000000000132'::uuid),
                    ('66660000-0000-4000-8000-000000000132'),
                    ('77770000-0000-4000-8000-000000000132'),
                    ('88880000-0000-4000-8000-000000000132'),
                    ('99990000-0000-4000-8000-000000000132'),
                    ('aaaa0000-0000-4000-8000-000000000132')) as c(id)
       cross join lateral athanor.momento_terms('11110000-0000-4000-8000-000000000132', c.id) t
      where t.affinity <= 0 $$,
  'every excluded candidate SCORES against M — the six assertions below test gates, not empty overlaps');
set local role service_role;

select is(
  (select count(*)::int from public.momento_suggestions
    where user_id = '11110000-0000-4000-8000-000000000132'
      and candidate_id = '55550000-0000-4000-8000-000000000132'),
  0,
  'a candidate already in today''s deck is not also suggested');

select is(
  (select count(*)::int from public.momento_suggestions
    where user_id = '11110000-0000-4000-8000-000000000132'
      and candidate_id = '66660000-0000-4000-8000-000000000132'),
  0,
  'a candidate passed inside the 90-day window is not suggested');

select is(
  (select count(*)::int from public.momento_suggestions
    where user_id = '11110000-0000-4000-8000-000000000132'
      and candidate_id = '77770000-0000-4000-8000-000000000132'),
  0,
  'someone already in Connessioni is not suggested — the list is for discovery');

select is(
  (select count(*)::int from public.momento_suggestions
    where user_id = '11110000-0000-4000-8000-000000000132'
      and candidate_id = '88880000-0000-4000-8000-000000000132'),
  0,
  'a blocked pair is never suggested, either direction');

select is(
  (select count(*)::int from public.momento_suggestions
    where candidate_id = '99990000-0000-4000-8000-000000000132'),
  0,
  'a banned member is suggested to nobody (#314''s ruling, applied to this surface)');

select is(
  (select count(*)::int from public.momento_suggestions
    where user_id = '99990000-0000-4000-8000-000000000132'),
  0,
  'a banned member receives no suggestions either');

select is(
  (select count(*)::int from public.momento_suggestions
    where user_id = '11110000-0000-4000-8000-000000000132'
      and candidate_id = 'aaaa0000-0000-4000-8000-000000000132'),
  0,
  'a member who hid BOTH tag fields is not suggested, even when another term scores them');

select is(
  (select count(*)::int from public.momento_suggestions where user_id = candidate_id),
  0,
  'no self-suggestions anywhere in the run');

select is_empty(
  $$ select user_id::text || ' -> ' || count(*)::text
       from public.momento_suggestions
      where computed_on = (now() at time zone 'utc')::date
      group by user_id having count(*) > 3 $$,
  'no member gets more than three suggestions in one run');

select is_empty(
  $$ select id::text from public.momento_suggestions where affinity <= 0 $$,
  'every stored suggestion scored something');

-- Idempotence: a second run the same day replaces the day's rows rather than duplicating or
-- colliding on either unique constraint.
select lives_ok(
  $$ select public.run_momenti_matcher() $$,
  'a second run on the same day does not collide with the day''s existing rows');

select results_eq(
  $$ select candidate_id, rank from public.momento_suggestions
      where user_id = '11110000-0000-4000-8000-000000000132' order by rank $$,
  $$ values ('22220000-0000-4000-8000-000000000132'::uuid, 1::smallint),
            ('33330000-0000-4000-8000-000000000132'::uuid, 2::smallint),
            ('44440000-0000-4000-8000-000000000132'::uuid, 3::smallint) $$,
  'and it leaves the same three rows, not six');

-- Retention: a run older than a week is pruned by the pass that writes the new one.
insert into public.momento_suggestions (user_id, candidate_id, affinity, computed_on, rank)
values ('11110000-0000-4000-8000-000000000132','22220000-0000-4000-8000-000000000132',
        9, (now() at time zone 'utc')::date - 8, 1);
select public.run_momenti_matcher();
select is(
  (select count(*)::int from public.momento_suggestions
    where computed_on < (now() at time zone 'utc')::date - 7),
  0,
  'runs older than a week are pruned by the next pass');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. The read
-- ─────────────────────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select results_eq(
  $$ select candidate_id, dream_text, reasons from public.get_momenti_suggestion() $$,
  $$ values ('22220000-0000-4000-8000-000000000132'::uuid, 'Sogno di S1', array['shared']),
            ('33330000-0000-4000-8000-000000000132'::uuid, 'Sogno di S3', array['shared']),
            ('44440000-0000-4000-8000-000000000132'::uuid, 'Sogno di S2', array['shared']) $$,
  'the RPC serves the latest run in rank order, with the dream and the reason kinds');

select is(
  (select count(*)::int from public.get_momenti_suggestion(
     array['22220000-0000-4000-8000-000000000132']::uuid[])),
  2,
  'p_exclude still drops a candidate the client is already showing on the deck');

select is(
  (select count(*)::int from public.get_momenti_suggestion(null::uuid[])),
  3,
  'a null p_exclude is the empty exclusion, not an empty list');

-- ── read-time re-checks: a snapshot must not outlive a ban ──
reset role;
set local role service_role;
update public.profiles set banned_at = now() where id = '22220000-0000-4000-8000-000000000132';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select is(
  (select count(*)::int from public.get_momenti_suggestion()
    where candidate_id = '22220000-0000-4000-8000-000000000132'),
  0,
  'a member banned AFTER the run drops out of the list at read time, not at the next run');

select is(
  (select count(*)::int from public.get_momenti_suggestion()),
  2,
  'and the rest of the list still renders — one ban is not an empty section');

-- ── read-time re-checks: a connection made during the day ──
-- The likeliest of all of them to change between the run and the read, because connecting is
-- what a member DOES with a suggestion. Without the read-side gate, tapping a suggestion through
-- to a connection leaves that person in the list until the next night.
reset role;
set local role service_role;
update public.profiles set banned_at = null where id = '22220000-0000-4000-8000-000000000132';
insert into public.connections (profile_a, profile_b)
values (least('11110000-0000-4000-8000-000000000132'::uuid, '33330000-0000-4000-8000-000000000132'::uuid),
        greatest('11110000-0000-4000-8000-000000000132'::uuid, '33330000-0000-4000-8000-000000000132'::uuid));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select results_eq(
  $$ select candidate_id from public.get_momenti_suggestion() $$,
  $$ values ('22220000-0000-4000-8000-000000000132'::uuid),
            ('44440000-0000-4000-8000-000000000132'::uuid) $$,
  'connecting with a suggested peer drops them from the list at once, not at the next run');

reset role;
set local role service_role;
delete from public.connections
 where profile_a = least('11110000-0000-4000-8000-000000000132'::uuid, '33330000-0000-4000-8000-000000000132'::uuid)
   and profile_b = greatest('11110000-0000-4000-8000-000000000132'::uuid, '33330000-0000-4000-8000-000000000132'::uuid);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select is(
  (select count(*)::int from public.get_momenti_suggestion()),
  3,
  'and comes back when the connection goes — the read is a gate, not a deletion');

-- ── read-time re-checks: the REASONS are recomputed, not served from the snapshot ──
-- S2's only term is the shared `artista` tag. Hiding identity_tags alone leaves `seeking`
-- visible, so the both-tags-private gate above does NOT fire — the row can only be dropped by
-- recomputing what it would say. A stored `reasons` array would have kept rendering
-- «Condividete», telling the reader that S2's now-hidden tags overlap theirs (#273 D).
reset role;
set local role service_role;
update public.profiles
   set visibility = coalesce(visibility, '{}'::jsonb) || '{"identity_tags":"private"}'::jsonb
 where id = '44440000-0000-4000-8000-000000000132';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select results_eq(
  $$ select candidate_id from public.get_momenti_suggestion() $$,
  $$ values ('22220000-0000-4000-8000-000000000132'::uuid),
            ('33330000-0000-4000-8000-000000000132'::uuid) $$,
  'a peer who hides the field their only reason came from leaves the list, chip and all');

reset role;
set local role service_role;
update public.profiles set visibility = '{}'::jsonb
 where id = '44440000-0000-4000-8000-000000000132';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select is(
  (select count(*)::int from public.get_momenti_suggestion()),
  3,
  'and returns when the field is visible again — recomputed every read, never cached');

-- ── the latest run, not today's run ──
reset role;
set local role service_role;
update public.momento_suggestions set computed_on = (now() at time zone 'utc')::date - 1
  where user_id = '11110000-0000-4000-8000-000000000132';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select is(
  (select count(*)::int from public.get_momenti_suggestion()),
  3,
  'a night the matcher missed degrades to the previous run, not to an empty section');

-- ── cold start ──
reset role;
set local role service_role;
delete from public.momento_suggestions where user_id = '11110000-0000-4000-8000-000000000132';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000132","role":"authenticated"}';

select is(
  (select count(*)::int from public.get_momenti_suggestion()),
  1,
  'a member no run has reached yet still gets a peer — the section is never empty');

select is(
  (select reasons from public.get_momenti_suggestion()),
  array['newDream'],
  'and it is tagged newDream, so «Sogno nuovo» is an honest chip rather than a stand-in');

select is_empty(
  $$ select candidate_id::text from public.get_momenti_suggestion()
      where candidate_id in ('88880000-0000-4000-8000-000000000132',
                             '99990000-0000-4000-8000-000000000132',
                             'aaaa0000-0000-4000-8000-000000000132') $$,
  'the cold-start arm honours the same block, ban and both-tags-private gates');

-- ── anon gets nothing ──
reset role;
select ok(
  not has_function_privilege('anon', 'public.get_momenti_suggestion(uuid[])', 'execute'),
  'anon cannot execute get_momenti_suggestion');
select ok(
  has_function_privilege('authenticated', 'public.get_momenti_suggestion(uuid[])', 'execute'),
  'authenticated can');

select * from finish();
rollback;
