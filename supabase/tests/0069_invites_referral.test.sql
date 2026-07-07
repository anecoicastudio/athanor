-- 0069_invites_referral.test.sql
-- P4.1 — referral chain: profiles.referral_code, ensure_referral_code(), invites, signup
-- redemption via handle_new_user v3 + athanor.redeem_referral(). Asserts: schema shape + RLS
-- posture · idempotent code generation · referral_code is client-unwritable (column-grant
-- lockdown, no guard trigger needed) · valid-code signup (already-confirmed) activates an
-- invite · malformed/unknown codes are a silent no-op (fail-open, rule: signup must never
-- break) · select_party RLS (inviter/invitee only, non-party sees zero) · invites is
-- server-write-only (no client insert/update) · zero Aura (rule #1 — invites confer no
-- aura_events row, at all, ever) · redemption is gated on email confirmation — an unconfirmed
-- signup with a valid code creates no invite until email_confirmed_at flips (pre-confirmation
-- gaming guard, 20260707093739_p4_1_referral_hardening.sql).
-- CI-only (hosted lacks pgtap + tests.* helpers); the hosted-replay smoke in
-- docs/superpowers/sdd/task-1-report.md is the correctness evidence for this slice.
--
-- NOTE on assertion 8 (self/bogus case): a literal self-referral (ref_inviter = new.id) is
-- structurally unreachable — a brand-new signup's own profile has referral_code = null at the
-- moment handle_new_user runs, so a code can never resolve back to the row being inserted.
-- The brief explicitly allows a "bogus/self" stand-in; this exercises the equivalent guarded
-- no-op path (blank/whitespace-only code → `ref_code <> ''` guard skips redemption entirely).

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ── seed inviter A + third-party E (auth trigger fires → profiles auto-created) ───────────
-- Top-level, no role switch: inserting into auth.users fires on_auth_user_created, which
-- must run with full (superuser-ish) privilege, not as `authenticated`/`service_role`.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000069',
   'authenticated', 'authenticated', 'invite_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'eeee0000-0000-0000-0000-000000000069',
   'authenticated', 'authenticated', 'invite_e@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── schema + RLS posture ────────────────────────────────────────────────────────────────
select has_table('public', 'invites', 'invites table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.invites'::regclass),
  'RLS enabled on invites'
);

select policies_are(
  'public',
  'invites',
  array['invites_select_party'],
  'exactly the expected policy on invites'
);

select has_column('public', 'profiles', 'referral_code', 'profiles.referral_code exists');

-- ── ensure_referral_code(): idempotent + client-unwritable column ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000069","role":"authenticated"}';

select set_config('test.code1', public.ensure_referral_code(), false);
select set_config('test.code2', public.ensure_referral_code(), false);

select is(
  current_setting('test.code1'),
  current_setting('test.code2'),
  'ensure_referral_code returns the same code on repeat call'
);

select throws_ok(
  $$ update public.profiles set referral_code = 'HACKHACK' where id = 'aaaa0000-0000-0000-0000-000000000069' $$,
  '42501', null,
  'client cannot update referral_code directly (column-grant lockdown)'
);

reset role;

-- ── B signs up with A's real code, already-confirmed → activated invite ────────────────────
-- (email_confirmed_at set at INSERT time: redemption is now gated on confirmation, so this
-- simulates the confirmations-OFF / born-confirmed path — see the unconfirmed-then-confirmed
-- case near the end of this file for the confirmations-ON path.)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
values (
  '00000000-0000-0000-0000-000000000000', 'bbbb0000-0000-0000-0000-000000000069',
  'authenticated', 'authenticated', 'invite_b@test.athanor',
  jsonb_build_object('locale', 'it', 'referral_code', current_setting('test.code1')), now(), now(), now()
);

select is(
  (select (count(*) = 1) from public.invites
    where inviter_id = 'aaaa0000-0000-0000-0000-000000000069'
      and invitee_id = 'bbbb0000-0000-0000-0000-000000000069'
      and activated_at is not null),
  true,
  'signup with a valid referral code creates an activated invite row'
);

-- ── C signs up with a blank/self-referential code → silent no-op, no row ───────────────────
-- (born-confirmed like B, so redeem_referral actually runs and the guard is exercised —
-- an unconfirmed seed would make this assertion vacuously true under the confirmation gate.)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
values (
  '00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-000000000069',
  'authenticated', 'authenticated', 'invite_c@test.athanor',
  jsonb_build_object('locale', 'it', 'referral_code', '   '), now(), now(), now()
);

select is(
  (select count(*) from public.invites where invitee_id = 'cccc0000-0000-0000-0000-000000000069')::int,
  0,
  'blank/self-referential code redemption is a no-op (fail-open, no row)'
);

-- ── D signs up with an unknown code → signup must never be blocked ─────────────────────────
-- (born-confirmed like B/C so the unknown-code lookup path in redeem_referral really runs.)
select lives_ok(
  $$ insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
     values ('00000000-0000-0000-0000-000000000000', 'dddd0000-0000-0000-0000-000000000069',
             'authenticated', 'authenticated', 'invite_d@test.athanor',
             jsonb_build_object('locale', 'it', 'referral_code', 'ZZZZZZZZ'), now(), now(), now()) $$,
  'unknown referral code never blocks signup'
);

-- ── select_party RLS: inviter sees own, non-party sees nothing ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000069","role":"authenticated"}';
select is(
  (select count(*)::int from public.invites),
  1,
  'inviter reads exactly their own activated invite (bogus/unknown codes created no rows)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeee0000-0000-0000-0000-000000000069","role":"authenticated"}';
select is(
  (select count(*)::int from public.invites),
  0,
  'non-party reads zero invites (select_party RLS)'
);

-- ── server-write-only: client insert/update always denied ──────────────────────────────────
set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-000000000069","role":"authenticated"}';

select throws_ok(
  $$ insert into public.invites (inviter_id, code, invitee_id)
     values ('aaaa0000-0000-0000-0000-000000000069', current_setting('test.code1'), 'eeee0000-0000-0000-0000-000000000069') $$,
  '42501', null,
  'client cannot insert into invites'
);

select throws_ok(
  $$ update public.invites set activated_at = null where invitee_id = 'bbbb0000-0000-0000-0000-000000000069' $$,
  '42501', null,
  'client cannot update invites (server-write only, targets the real seeded row)'
);

reset role;

-- ── zero Aura (rule #1): a true global check, run as service_role ──────────────────────────
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('aaaa0000-0000-0000-0000-000000000069', 'bbbb0000-0000-0000-0000-000000000069')),
  0,
  'referral activation confers zero Aura (rule #1)'
);
reset role;

-- ── F signs up with A's valid code but UNCONFIRMED → no invite until email confirms ────────
-- (confirmations-ON path; pre-confirmation-gaming guard added by
-- 20260707093739_p4_1_referral_hardening.sql)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000', 'ffff0000-0000-0000-0000-000000000069',
  'authenticated', 'authenticated', 'invite_f@test.athanor',
  jsonb_build_object('locale', 'it', 'referral_code', current_setting('test.code1')), now(), now()
);

select is(
  (select count(*) from public.invites where invitee_id = 'ffff0000-0000-0000-0000-000000000069')::int,
  0,
  'unconfirmed signup with a valid code creates no invite (pre-confirmation gaming guard)'
);

update auth.users set email_confirmed_at = now()
  where id = 'ffff0000-0000-0000-0000-000000000069';

select is(
  (select (count(*) = 1) from public.invites
    where inviter_id = 'aaaa0000-0000-0000-0000-000000000069'
      and invitee_id = 'ffff0000-0000-0000-0000-000000000069'
      and activated_at is not null),
  true,
  'confirming email retroactively redeems the stashed referral code'
);

select * from finish();
rollback;
