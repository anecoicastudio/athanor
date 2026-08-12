-- public.get_momenti_deck (migration <ts>_momenti_affinity_and_deck.sql) — the deck read path
-- moved behind a DEFINER RPC in #273 so that the affinity TERMS are recomputed and re-masked on
-- every read, and so the order is (proposed_on desc, daily_rank asc) rather than `daily_rank`
-- alone across every day at once.
--
-- The fixture is adversarial in the same way 0075's is: every row that must be FILTERED OUT is
-- newer than every row that must survive, so a dropped predicate changes the answer instead of
-- hiding behind the limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-0000-4000-8000-000000000089','authenticated','authenticated','me89@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000089','authenticated','authenticated','x89@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000089','authenticated','authenticated','y89@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000089','authenticated','authenticated','z89@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000089','authenticated','authenticated','w89@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000089','authenticated','authenticated','blk89@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','ffffffff-0000-4000-8000-000000000089','authenticated','authenticated','nod89@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','abababab-0000-4000-8000-000000000089','authenticated','authenticated','prv89@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
-- ME seeks mentorship and is freelance + artista. X answers it in both directions (coach+mentor,
-- seeking collaborazioni), so all three terms are exercised on one card.
update public.profiles set handle='me89', identity_tags=array['freelance','artista'], seeking=array['mentorship']
  where id='11111111-0000-4000-8000-000000000089';
update public.profiles set handle='x89', identity_tags=array['mentor','coach'], seeking=array['collaborazioni']
  where id='aaaaaaaa-0000-4000-8000-000000000089';
update public.profiles set handle='y89', identity_tags=array['coach']
  where id='bbbbbbbb-0000-4000-8000-000000000089';
update public.profiles set handle='z89', identity_tags=array['artista']
  where id='cccccccc-0000-4000-8000-000000000089';
update public.profiles set handle='w89', identity_tags=array['mentor']
  where id='dddddddd-0000-4000-8000-000000000089';
update public.profiles set handle='blk89', identity_tags=array['mentor']
  where id='eeeeeeee-0000-4000-8000-000000000089';
update public.profiles set handle='nod89', identity_tags=array['mentor']
  where id='ffffffff-0000-4000-8000-000000000089';
update public.profiles set handle='prv89', identity_tags=array['mentor'], visibility='{"dream":"private"}'::jsonb
  where id='abababab-0000-4000-8000-000000000089';

insert into public.dreams (profile_id, text) values
  ('aaaaaaaa-0000-4000-8000-000000000089','Sogno X'),
  ('bbbbbbbb-0000-4000-8000-000000000089','Sogno Y'),
  ('cccccccc-0000-4000-8000-000000000089','Sogno Z'),
  ('dddddddd-0000-4000-8000-000000000089','Sogno W'),
  ('eeeeeeee-0000-4000-8000-000000000089','Sogno BLK'),
  ('abababab-0000-4000-8000-000000000089','Sogno PRV');
-- NOD has no active dream: a Momento with nothing to answer is not a Momento.
insert into public.dreams (profile_id, text, status)
  values ('ffffffff-0000-4000-8000-000000000089','Sogno archiviato','archived');

insert into public.blocks (blocker_id, blocked_id)
  values ('eeeeeeee-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089');

-- TODAY's three rows are the three that must be filtered out; the eligible ones are older.
-- Under the pre-#273 order (`daily_rank` asc, no day) the answer would start with them.
insert into public.momento_proposals (id, user_id, candidate_id, affinity, status, proposed_on, daily_rank)
values
  ('e0000000-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089','eeeeeeee-0000-4000-8000-000000000089', 3, 'pending', current_date,     1),
  ('f0000000-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089','ffffffff-0000-4000-8000-000000000089', 3, 'pending', current_date,     2),
  ('ab000000-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089','abababab-0000-4000-8000-000000000089', 3, 'pending', current_date,     3),
  ('a0000000-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089','aaaaaaaa-0000-4000-8000-000000000089', 4, 'pending', current_date - 1, 1),
  ('b0000000-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089','bbbbbbbb-0000-4000-8000-000000000089', 2, 'pending', current_date - 1, 2),
  -- affinity 0 = the dream-recency fallback (#273 E)
  ('c0000000-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089','cccccccc-0000-4000-8000-000000000089', 0, 'pending', current_date - 2, 1),
  ('d0000000-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089','dddddddd-0000-4000-8000-000000000089', 2, 'pending', current_date - 3, 1),
  -- X's own deck, to prove the RPC is scoped to the caller
  ('aa000000-0000-4000-8000-000000000089','aaaaaaaa-0000-4000-8000-000000000089','11111111-0000-4000-8000-000000000089', 4, 'pending', current_date,     1);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000089","role":"authenticated"}';

select results_eq(
  $$ select proposal_id from public.get_momenti_deck() $$,
  $$ values ('a0000000-0000-4000-8000-000000000089'::uuid),
            ('b0000000-0000-4000-8000-000000000089'::uuid),
            ('c0000000-0000-4000-8000-000000000089'::uuid) $$,
  'newest DAY first then rank, capped at 3 — blocked / dream-less / private-dream rows are '
  'dropped even though they are the newest'
);

select is(
  (select reason_kind from public.get_momenti_deck() where proposal_id='a0000000-0000-4000-8000-000000000089'),
  'affinity',
  'a scored proposal reports reason_kind affinity'
);
select is(
  (select reason_kind from public.get_momenti_deck() where proposal_id='c0000000-0000-4000-8000-000000000089'),
  'new_dream',
  'the affinity-0 fallback reports reason_kind new_dream (never an affinity claim)'
);

select is(
  (select shared from public.get_momenti_deck() where proposal_id='a0000000-0000-4000-8000-000000000089'),
  '{}'::text[],
  'no shared identity label between the pair — the card stands on complementarity alone'
);
select is(
  (select seek_hit from public.get_momenti_deck() where proposal_id='a0000000-0000-4000-8000-000000000089'),
  array['coach','mentor'],
  'seek_hit: the identities they hold that answer what I seek (#273 A)'
);
select is(
  (select offer_hit from public.get_momenti_deck() where proposal_id='a0000000-0000-4000-8000-000000000089'),
  array['artista','freelance'],
  'offer_hit: the identities I hold that answer what they seek (#273 A)'
);
reset role;

-- scoped to the caller: X sees X's row, never ME's
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000089","role":"authenticated"}';
select results_eq(
  $$ select proposal_id from public.get_momenti_deck() $$,
  $$ values ('aa000000-0000-4000-8000-000000000089'::uuid) $$,
  'the deck is the caller''s own — auth.uid(), never an argument (rule #8)'
);
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.get_momenti_deck() $$,
  '42501', null, 'anon cannot execute get_momenti_deck'
);
reset role;

-- ── shape ───────────────────────────────────────────────────────────────────
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_momenti_deck' and p.prosecdef),
  1::bigint,
  'get_momenti_deck is SECURITY DEFINER (profiles.visibility is not client-readable)'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_momenti_deck'
      and p.proconfig @> array['search_path=""']),
  1::bigint,
  'get_momenti_deck pins an empty search_path'
);
-- Rule #1: the score is server-only. The RPC hands back a KIND, and 'affinity' must not appear
-- as an output column — a DEFINER function's projection is not covered by the column grant.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_momenti_deck'
      and 'affinity' = any (p.proargnames)),
  0::bigint,
  'the deck never returns the affinity number, only reason_kind'
);

select * from finish();
rollback;
