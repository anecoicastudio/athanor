begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- two users (the handle_new_user trigger auto-creates their public.profiles rows)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'contrib_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'contrib_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- structure + RLS
select has_table('public', 'fund_contributions', 'fund_contributions exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fund_contributions'::regclass),
  'RLS enabled on fund_contributions'
);
select policies_are('public', 'fund_contributions', array['fund_contributions_select_own'],
  'exactly the owner-select policy');

-- seed an edition + two succeeded contributions (service_role — the sole writer)
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('00000000-0000-0000-0000-0000000000ed', now() + interval '10 days', 1000000, true, 100000, 5, 3,
          10, 'fixture costs statement', 'none');
insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
  values
   ('00000000-0000-0000-0000-0000000000ed','11111111-1111-1111-1111-111111111111',100,'cs_a','succeeded'),
   ('00000000-0000-0000-0000-0000000000ed','22222222-2222-2222-2222-222222222222',500,'cs_b','succeeded');
reset role;

-- anon cannot read (no grant → 42501)
set local role anon;
select throws_ok(
  $$ select * from public.fund_contributions $$,
  '42501', null, 'anon cannot read contributions');
reset role;

-- owner-scoped read: user_a sees own (1), never user_b's (0 — RLS filters)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.fund_contributions
   where profile_id = '11111111-1111-1111-1111-111111111111')::bigint,
  1::bigint, 'owner sees own contribution');
select is(
  (select count(*) from public.fund_contributions
   where profile_id = '22222222-2222-2222-2222-222222222222')::bigint,
  0::bigint, 'owner cannot see another member''s contribution (RLS)');

-- no client write (money-is-cache): insert / update / delete all 42501 (grant omits writes)
select throws_ok(
  $$ insert into public.fund_contributions (edition_id, amount_cents, stripe_checkout_session_id, status)
     values ('00000000-0000-0000-0000-0000000000ed',999,'cs_hax','succeeded') $$,
  '42501', null, 'client cannot insert a contribution');
select throws_ok(
  $$ update public.fund_contributions set status='refunded' $$,
  '42501', null, 'client cannot update a contribution');
select throws_ok(
  $$ delete from public.fund_contributions $$,
  '42501', null, 'client cannot delete a contribution');

-- recompute fn is service_role only: a client cannot call it
select throws_ok(
  $$ select public.recompute_fund_aggregate('00000000-0000-0000-0000-0000000000ed') $$,
  '42501', null, 'client cannot call recompute_fund_aggregate');
reset role;

-- recompute correctness: service_role derives raised=600 (100+500), contributors=2
set local role service_role;
select lives_ok(
  $$ select public.recompute_fund_aggregate('00000000-0000-0000-0000-0000000000ed') $$,
  'service_role recomputes the aggregate');
select results_eq(
  $$ select raised_cents, contributor_count from public.fund_aggregates
     where edition_id = '00000000-0000-0000-0000-0000000000ed' $$,
  $$ values (600::bigint, 2::bigint) $$,
  'aggregate recomputed from succeeded contributions');
reset role;

-- #239: profile_id is NOT NULL — no anonymous rows, so contributor_count and raised_cents
-- describe the same set of succeeded contributions (D24: contributions are never anonymous).
select col_not_null('public', 'fund_contributions', 'profile_id',
  'profile_id is NOT NULL — anonymous contributions are impossible');

set local role service_role;
select throws_ok(
  $$ insert into public.fund_contributions (edition_id, profile_id, amount_cents, stripe_checkout_session_id, status)
     values ('00000000-0000-0000-0000-0000000000ed', null, 300, 'cs_anon', 'succeeded') $$,
  '23502', null, 'even service_role cannot insert an anonymous contribution');
-- recompute after the rejected anon attempt: the aggregate still derives from the same two
-- member rows — every counted cent belongs to a counted contributor.
select public.recompute_fund_aggregate('00000000-0000-0000-0000-0000000000ed');
select results_eq(
  $$ select raised_cents, contributor_count from public.fund_aggregates
     where edition_id = '00000000-0000-0000-0000-0000000000ed' $$,
  $$ values (600::bigint, 2::bigint) $$,
  'raised_cents and contributor_count describe the same succeeded rows');
reset role;

-- rule #1: a contribution creates ZERO aura events
select is(
  (select count(*)::int from public.aura_events),
  0, 'no aura_events exist from a contribution (fund = 0 Aura)');

select * from finish();
rollback;
