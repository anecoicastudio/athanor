begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- #383 is_on_ballot(): THE definition of "on the ballot", and the invariant that the five
-- former literal sites now read from it. The truth table is asserted once, here; the five
-- call sites are asserted only to REFERENCE the predicate — reintroducing a hand-copied
-- status literal in any of them fails the reference asserts, and changing the set fails
-- the truth table. Fixture edition is 'closed' on purpose: the predicate ignores the
-- edition, and a closed row cannot collide with fund_editions_one_active when this file
-- runs against a database that already holds a live cycle (staging SQL smoke).

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('a0000000-0000-0000-0000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'iob_u' || i || '@test.athanor', '{}'::jsonb, now(), now()
  from generate_series(1, 6) i;

-- structure
select has_function('public', 'is_on_ballot', array['dream_candidacies'],
  'is_on_ballot(dream_candidacies) exists');
select volatility_is('public', 'is_on_ballot', array['dream_candidacies'], 'immutable',
  'is_on_ballot is IMMUTABLE — required by the partial-index predicate; a body change must rebuild dream_candidacies_list_feed');

-- ── fixture: one closed edition, six candidacies — five statuses + one soft-deleted ─────
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('00000000-0000-0000-0000-0000000000ed', now() + interval '30 days', 5000000, 'closed', 'realized', false, false,
          100000, 3, 3, 10, 'fixture costs statement', 'none');
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status, deleted_at, rejection_reasons)
select ('c0000000-0000-0000-0000-00000000000' || i)::uuid,
       '00000000-0000-0000-0000-0000000000ed',
       ('a0000000-0000-0000-0000-00000000000' || i)::uuid,
       's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, s.status, s.deleted_at, s.rejection_reasons
  from (values
    (1, 'submitted',   null::timestamptz, null::text[]),
    (2, 'screening',   null, null),
    (3, 'shortlisted', null, null),
    (4, 'winner',      null, null),
    (5, 'rejected',    null, array['plan_coherent']),
    (6, 'shortlisted', now(), null)
  ) as s(i, status, deleted_at, rejection_reasons);

-- ── truth table (#218: the ballot is the SCREENED set) ──────────────────────────────────
select is((select public.is_on_ballot(c) from public.dream_candidacies c
            where c.id = 'c0000000-0000-0000-0000-000000000001'),
  false, 'submitted is NOT on the ballot — the field publishes at shortlist (FUND-52/D4)');
select is((select public.is_on_ballot(c) from public.dream_candidacies c
            where c.id = 'c0000000-0000-0000-0000-000000000002'),
  false, 'screening is NOT on the ballot — the committee has not admitted it yet');
select is((select public.is_on_ballot(c) from public.dream_candidacies c
            where c.id = 'c0000000-0000-0000-0000-000000000003'),
  true,  'shortlisted is on the ballot — screening passed');
select is((select public.is_on_ballot(c) from public.dream_candidacies c
            where c.id = 'c0000000-0000-0000-0000-000000000004'),
  true,  'winner stays on the ballot (visible field; declare_winner composes its own exception)');
select is((select public.is_on_ballot(c) from public.dream_candidacies c
            where c.id = 'c0000000-0000-0000-0000-000000000005'),
  false, 'rejected is off the ballot');
select is((select public.is_on_ballot(c) from public.dream_candidacies c
            where c.id = 'c0000000-0000-0000-0000-000000000006'),
  false, 'a soft-deleted candidacy is off the ballot regardless of status');

-- ── the five call sites read the ONE definition ─────────────────────────────────────────
select has_index('public', 'dream_candidacies', 'dream_candidacies_list_feed',
  'the list-feed partial index exists');
select alike(
  (select pg_get_expr(x.indpred, x.indrelid)
     from pg_index x
     join pg_class i on i.oid = x.indexrelid
    where i.relname = 'dream_candidacies_list_feed'),
  '%is_on_ballot%',
  'list-feed index predicate reads is_on_ballot');
select alike(
  (select p.qual from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'dream_candidacies'
      and p.policyname = 'dream_candidacies_select_visible'),
  '%is_on_ballot%',
  'the select policy''s public branch reads is_on_ballot');
select alike(
  (select prosrc from pg_proc
    where oid = 'public.cast_vote(uuid, uuid)'::regprocedure),
  '%is_on_ballot%',
  'cast_vote''s votability check reads is_on_ballot');
select alike(
  (select prosrc from pg_proc
    where oid = 'public.fund_editions_ballot_open_check()'::regprocedure),
  '%is_on_ballot%',
  'the ballot-open minimum counts is_on_ballot rows');
select alike(
  (select prosrc from pg_proc
    where oid = 'public.declare_winner(uuid)'::regprocedure),
  '%is_on_ballot%',
  'declare_winner eligibility reads is_on_ballot');
-- The one deliberate divergence, stated as composition where it lives: a sitting winner
-- is on the ballot but cannot win again.
select alike(
  (select prosrc from pg_proc
    where oid = 'public.declare_winner(uuid)'::regprocedure),
  '%status <> ''winner''%',
  'declare_winner states the winner exception as a composition, not a diverging literal');

-- own-row visibility (any status) and the public branch still behave — the deep visibility
-- rows stay 0042's job; this is the recreate-did-not-drift smoke.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.dream_candidacies
      where edition_id = '00000000-0000-0000-0000-0000000000ed' $$,
  array[3],
  'a member sees the two on-ballot candidacies plus their own rejected row');
reset role;

select * from finish();
rollback;
