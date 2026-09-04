begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- two users (the handle_new_user trigger auto-creates their public.profiles rows)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'circle_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'circle_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── schema ──
select has_table('public', 'circle_memberships', 'circle_memberships exists');
select has_view('public', 'entitlements', 'entitlements view exists');
select has_column('public', 'circle_memberships', 'founding_member', 'has founding_member');
-- #511 — «renews on» vs «ends on» is only distinguishable if this column exists and defaults
-- to false; the app reads it through circleMembershipSchema, which strips anything unnamed.
select has_column('public', 'circle_memberships', 'cancel_at_period_end', 'has cancel_at_period_end');
select col_type_is('public', 'circle_memberships', 'cancel_at_period_end', 'boolean',
  'cancel_at_period_end is boolean');
select col_not_null('public', 'circle_memberships', 'cancel_at_period_end',
  'cancel_at_period_end is NOT NULL');
select col_default_is('public', 'circle_memberships', 'cancel_at_period_end', 'false',
  'cancel_at_period_end defaults to false — an existing membership is not cancelled');
select ok(
  (select count(*) = 1 from pg_constraint
   where conrelid = 'public.circle_memberships'::regclass
     and conname = 'circle_memberships_profile_id_key'
     and contype = 'u'),
  'profile_id is unique');
select policies_are('public', 'circle_memberships', array['circle_memberships_select_own'],
  'exactly one (select-own) policy');

-- seed an active founding membership for user_a (service role — the sole writer)
set local role service_role;
insert into public.circle_memberships (profile_id, stripe_customer_id, plan, status, founding_member)
  values ('11111111-1111-1111-1111-111111111111', 'cus_a', 'monthly', 'active', true);
reset role;

-- ── anon cannot read ──
set local role anon;
select throws_ok(
  $$ select * from public.circle_memberships $$,
  '42501', null, 'anon SELECT denied');
reset role;

-- ── authenticated cannot grant themselves membership (SRW — grant omits writes) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.circle_memberships (profile_id, stripe_customer_id, plan, status)
     values ('22222222-2222-2222-2222-222222222222','cus_b','monthly','active') $$,
  '42501', null, 'client INSERT denied (cannot grant yourself the Circle)');
select throws_ok(
  $$ update public.circle_memberships set status='active'
     where profile_id='11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'client UPDATE denied');

-- ── owner-scoped read isolation ──
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.circle_memberships)::bigint,
  1::bigint, 'user_a sees only own membership row');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*) from public.circle_memberships)::bigint,
  0::bigint, 'user_b (no membership) sees zero rows');

-- ── entitlements derivation ──
-- user_b: no membership → is_member=false, features=false
select is((select is_member from public.entitlements), false, 'non-member entitlements.is_member=false');
select is((select advanced_filters from public.entitlements), false, 'non-member advanced_filters=false');
-- The left join is what could leak a null here; every bit is coalesced precisely so it cannot.
-- packages/schemas entitlementsSchema reads a null bit as false rather than throwing, so this
-- assertion is the half that notices a dropped coalesce instead of silently degrading.
select is(
  (select count(*) from public.entitlements
   where profile_id is null or is_member is null or founding is null
      or advanced_filters is null or premium_events is null
      or analytics is null or market_reduced_fee is null),
  0::bigint, 'non-member row: the view emits no null column');
-- user_a: active founding member → is_member=true, Fase-1 features=true, Fase-2=false
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select is_member from public.entitlements), true, 'member entitlements.is_member=true');
select is(
  (select advanced_filters and premium_events and analytics from public.entitlements),
  true, 'member Fase-1 features all true');
select is(
  (select market_reduced_fee from public.entitlements),
  false, 'Fase-2 market_reduced_fee=false even for member');
select is(
  (select count(*) from public.entitlements
   where profile_id is null or is_member is null or founding is null
      or advanced_filters is null or premium_events is null
      or analytics is null or market_reduced_fee is null),
  0::bigint, 'member row: the view emits no null column');
reset role;

-- ── ZERO AURA: membership + founding badge emit no score event (rule #1) ──
select is(
  (select count(*)::int from public.aura_events
   where profile_id = '11111111-1111-1111-1111-111111111111'),
  0, 'active founding membership produced ZERO aura_events (Meritocracy is untouchable)');

select * from finish();
rollback;
