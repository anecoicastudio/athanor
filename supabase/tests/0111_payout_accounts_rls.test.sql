-- #245 — payout_accounts RLS: the Connect Express account cache (ruling #244).
-- SRW posture: owner reads own; every client write raises 42501 (grant strips writes);
-- only service_role (the stripe-webhook account.updated branch) writes. One row per
-- profile, one Stripe account per row. Zero Aura from anything here (rule #1).
begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- two users (the handle_new_user trigger auto-creates their public.profiles rows)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'payout_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'payout_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- structure + RLS
select has_table('public', 'payout_accounts', 'payout_accounts exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payout_accounts'::regclass),
  'RLS enabled on payout_accounts'
);
select policies_are('public', 'payout_accounts', array['payout_accounts_select_own'],
  'exactly the owner-select policy');

-- seed both accounts (service_role — the sole writer). Flags left to their defaults:
-- the gate #247 reads must fail closed until the webhook says otherwise.
set local role service_role;
insert into public.payout_accounts (profile_id, stripe_account_id)
  values
   ('11111111-1111-1111-1111-111111111111', 'acct_a'),
   ('22222222-2222-2222-2222-222222222222', 'acct_b');
reset role;

-- capability defaults are false — never null, never true at birth
select results_eq(
  $$ select charges_enabled, payouts_enabled from public.payout_accounts
     where stripe_account_id = 'acct_a' $$,
  $$ values (false, false) $$,
  'a fresh account has both capability flags false (transfer gate fails closed)');

-- anon cannot read (no grant → 42501)
set local role anon;
select throws_ok(
  $$ select * from public.payout_accounts $$,
  '42501', null, 'anon cannot read payout accounts');
reset role;

-- owner-scoped read: user_a sees own (1), never user_b's (0 — RLS filters)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.payout_accounts
   where profile_id = '11111111-1111-1111-1111-111111111111')::bigint,
  1::bigint, 'owner sees own payout account');
select is(
  (select count(*) from public.payout_accounts
   where profile_id = '22222222-2222-2222-2222-222222222222')::bigint,
  0::bigint, 'owner cannot see another member''s payout account (RLS)');

-- no client write (money-is-cache, rule #6): insert / update / delete all raise 42501,
-- never silently affect zero rows — the grant strips writes before RLS is even consulted.
select throws_ok(
  $$ insert into public.payout_accounts (profile_id, stripe_account_id)
     values ('11111111-1111-1111-1111-111111111111', 'acct_hax') $$,
  '42501', null, 'client cannot insert a payout account');
select throws_ok(
  $$ update public.payout_accounts set payouts_enabled = true $$,
  '42501', null, 'client cannot update a payout account (no self-enabled payouts)');
select throws_ok(
  $$ delete from public.payout_accounts $$,
  '42501', null, 'client cannot delete a payout account');
reset role;

-- service_role (the webhook) updates freely: account.updated flips the flags
set local role service_role;
select lives_ok(
  $$ update public.payout_accounts
     set charges_enabled = true, payouts_enabled = true, onboarded_at = now()
     where stripe_account_id = 'acct_a' $$,
  'service_role updates capability flags (the account.updated branch)');

-- uniqueness: one Stripe account per row, one row per profile (design doc: one per profile)
select throws_ok(
  $$ insert into public.payout_accounts (profile_id, stripe_account_id)
     values ('11111111-1111-1111-1111-111111111111', 'acct_c') $$,
  '23505', null, 'a second payout account for the same profile is rejected');
select throws_ok(
  $$ insert into public.payout_accounts (profile_id, stripe_account_id)
     values ('22222222-2222-2222-2222-222222222222', 'acct_a') $$,
  '23505', null, 'the same stripe_account_id cannot attach to a second profile');
reset role;

-- the touch trigger is wired (now() is transaction-frozen here, so the timestamp move
-- itself is unobservable in a single-transaction test — assert the wiring instead)
select has_trigger('public', 'payout_accounts', 'payout_accounts_touch_updated_at',
  'payout_accounts carries the touch_updated_at trigger');

-- rule #1: onboarding a payout account creates ZERO aura events. Scoped to the fixture
-- profiles (not a global count) so the assertion also holds on a seeded world (staging).
select is(
  (select count(*)::int from public.aura_events
   where profile_id in ('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222')),
  0, 'no aura_events for either fixture profile (payout onboarding = 0 Aura)');

select * from finish();
rollback;
