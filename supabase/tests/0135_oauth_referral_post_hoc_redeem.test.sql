-- 0135_oauth_referral_post_hoc_redeem.test.sql
-- #78 — public.redeem_pending_referral(text), the second referral entry point: the one an
-- OAuth signup can reach. An OAuth user carries no `referral_code` in raw_user_meta_data, so
-- neither handle_new_user nor handle_user_confirmed can redeem anything for them; the client
-- calls this RPC on the first authenticated boot instead.
--
-- What this file pins, in order: the catalog posture (DEFINER, locked search_path, owner) ·
-- the ACL, which is the security property — authenticated yes, anon and PUBLIC no (#409, the
-- 'f' default ACL makes every new function anon-reachable unless its migration revokes) · an
-- unauthenticated call raising rather than no-op'ing · the happy path, an OAuth-shaped user
-- with NO referral metadata being attributed · and the three gates, each with the account
-- shape that must be refused: unconfirmed (the pre-confirmation gaming guard of
-- 20260707093739 restated on this path), already-attributed, and older than the window.
-- Last, the posture this RPC must NOT have loosened: `invites` is still server-write-only —
-- asserted as a privilege, not as a denied write, because RLS would swallow the write and
-- make the assertion pass for the wrong reason.
--
-- CI-only (hosted lacks pgtap + tests.* helpers), like every file here.

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ── seed ─────────────────────────────────────────────────────────────────────────────────
-- Top-level, no role switch: inserting into auth.users fires on_auth_user_created, which must
-- run with full privilege. A = inviter. B = the bug's subject: born confirmed, Google-shaped
-- metadata (full_name, no referral_code), created now. C = unconfirmed. D = an established
-- account. E = a second new member, used for the codes that must resolve to nothing.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000078',
   'authenticated', 'authenticated', 'oauth_ref_a@test.athanor',
   '{"locale":"it"}'::jsonb, now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb0000-0000-0000-0000-000000000078',
   'authenticated', 'authenticated', 'oauth_ref_b@test.athanor',
   '{"full_name":"Bea Oauth","email_verified":true}'::jsonb, now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dddd0000-0000-0000-0000-000000000078',
   'authenticated', 'authenticated', 'oauth_ref_d@test.athanor',
   '{"locale":"it"}'::jsonb, now() - interval '30 days', now(), now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000000000', 'eeee0000-0000-0000-0000-000000000078',
   'authenticated', 'authenticated', 'oauth_ref_e@test.athanor',
   '{"locale":"it"}'::jsonb, now(), now(), now());

-- C is the unconfirmed one — email_confirmed_at omitted, not null'd, so the column default
-- rather than an explicit write decides it.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-000000000078',
   'authenticated', 'authenticated', 'oauth_ref_c@test.athanor',
   '{"locale":"it"}'::jsonb, now(), now());

-- ── 1. catalog shape ─────────────────────────────────────────────────────────────────────
select has_function('public', 'redeem_pending_referral', array['text'],
  'redeem_pending_referral(text) exists');

-- SECURITY DEFINER is load-bearing: athanor.redeem_referral has EXECUTE revoked from every
-- client role, and public.invites has no INSERT grant for authenticated. An invoker function
-- would 42501 on both counts.
select is(
  (select prosecdef from pg_proc where oid = 'public.redeem_pending_referral(text)'::regprocedure),
  true,
  'runs SECURITY DEFINER — a client role can reach neither redeem_referral nor an invites INSERT'
);

select is(
  (select proconfig from pg_proc where oid = 'public.redeem_pending_referral(text)'::regprocedure),
  array['search_path=""'],
  'search_path is locked to the empty string'
);

-- For a DEFINER function the owner is the borrowed right. `postgres` owns public.invites and
-- athanor.redeem_referral; owned by anyone else this function is a 42501 on every call.
select is(
  (select proowner::regrole::text
     from pg_proc where oid = 'public.redeem_pending_referral(text)'::regprocedure),
  'postgres',
  'owned by postgres — the role whose invites INSERT and redeem_referral EXECUTE it borrows'
);

-- ── 2. the ACL — the security property ───────────────────────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'public.redeem_pending_referral(text)', 'execute'),
  'authenticated can execute it — this is a real RPC, called on the first authenticated boot'
);

select ok(
  not has_function_privilege('anon', 'public.redeem_pending_referral(text)', 'execute'),
  'anon cannot execute it — a signed-out caller has no auth.uid() to attribute'
);

select is_empty(
  $$ select 1 from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ax
      where p.oid = 'public.redeem_pending_referral(text)'::regprocedure
        and ax.privilege_type = 'EXECUTE'
        and ax.grantee = 0 $$,
  'PUBLIC cannot execute it — the migration revoked the born-with grant (#409)'
);

-- `invites` must still be unreachable for a client write. Asserted as a privilege and not as
-- a denied INSERT: RLS would refuse the write anyway, so a behaviour test would pass even if
-- the grant had been widened (rules/supabase-db.md, Grants).
select ok(
  not has_table_privilege('authenticated', 'public.invites', 'INSERT'),
  'authenticated still holds no INSERT on invites — the RPC did not open a client write path'
);

-- ── 3. an unauthenticated call raises ────────────────────────────────────────────────────
-- Role `authenticated` with no `sub` claim, deliberately: calling as `anon` would also throw
-- 42501, but for lack of EXECUTE, and the assertion would pass without the guard existing.
-- The message is pinned for the same reason.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';

select throws_ok(
  $$ select public.redeem_pending_referral('ABC123') $$,
  '42501', 'not authenticated',
  'a caller with no auth.uid() raises rather than silently no-op''ing'
);

-- ── 4. A mints a code ────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000078","role":"authenticated"}';
select set_config('test.code_a', public.ensure_referral_code(), false);

set local request.jwt.claims = '{"sub":"eeee0000-0000-0000-0000-000000000078","role":"authenticated"}';
select set_config('test.code_e', public.ensure_referral_code(), false);

-- ── 5. the happy path — the whole point of the issue ─────────────────────────────────────
-- B is an OAuth signup: born confirmed, no referral_code anywhere in its metadata, so both
-- triggers have already run and redeemed nothing.
select is(
  (select count(*) from public.invites where invitee_id = 'bbbb0000-0000-0000-0000-000000000078')::int,
  0,
  'an OAuth signup is attributed to nobody by the signup triggers (the bug)'
);

set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-000000000078","role":"authenticated"}';
select lives_ok(
  $$ select public.redeem_pending_referral(current_setting('test.code_a')) $$,
  'redeeming the stashed code post-hoc never raises'
);

select is(
  (select (count(*) = 1) from public.invites
    where inviter_id = 'aaaa0000-0000-0000-0000-000000000078'
      and invitee_id = 'bbbb0000-0000-0000-0000-000000000078'
      and activated_at is not null),
  true,
  'the OAuth member is attributed to the inviter, activated (#78 Done when)'
);

-- ── 6. gate 2 — already an invitee ───────────────────────────────────────────────────────
-- The client calls this on every boot that finds a stash, so re-entry is the normal case,
-- not an edge one.
select lives_ok(
  $$ select public.redeem_pending_referral(current_setting('test.code_a')) $$,
  'a repeat redemption never raises'
);

select is(
  (select count(*) from public.invites where invitee_id = 'bbbb0000-0000-0000-0000-000000000078')::int,
  1,
  'a repeat redemption adds no second row (invitee_id is unique, and the gate returns first)'
);

select lives_ok(
  $$ select public.redeem_pending_referral(current_setting('test.code_e')) $$,
  'a second, different code never raises'
);

select is(
  (select inviter_id from public.invites where invitee_id = 'bbbb0000-0000-0000-0000-000000000078'),
  'aaaa0000-0000-0000-0000-000000000078'::uuid,
  'attribution cannot be moved to another inviter after the fact'
);

-- ── 7. codes that resolve to nothing ─────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"eeee0000-0000-0000-0000-000000000078","role":"authenticated"}';

select public.redeem_pending_referral('ZZZZZZZZ');                        -- unknown code
select public.redeem_pending_referral(current_setting('test.code_e'));   -- E's own code
select public.redeem_pending_referral('   ');                            -- blank stash
select public.redeem_pending_referral(null::text);                       -- absent stash

select is(
  (select count(*) from public.invites where invitee_id = 'eeee0000-0000-0000-0000-000000000078')::int,
  0,
  'unknown, self, blank and null codes are all silent no-ops (fail-open, no row)'
);

-- ── 8. gate 1 — confirmation ─────────────────────────────────────────────────────────────
-- C confirmed nothing. Redeeming here would make this RPC the way around the
-- pre-confirmation gaming guard: mint throwaway unconfirmed signups, redeem each from the
-- client, and count as an activated Ambasciatore without a single confirmed human.
set local request.jwt.claims = '{"sub":"cccc0000-0000-0000-0000-000000000078","role":"authenticated"}';
select public.redeem_pending_referral(current_setting('test.code_a'));

select is(
  (select count(*) from public.invites where invitee_id = 'cccc0000-0000-0000-0000-000000000078')::int,
  0,
  'an unconfirmed caller redeems nothing (pre-confirmation gaming guard, on the new path)'
);

-- ── 9. gate 3 — account age ──────────────────────────────────────────────────────────────
-- D is an established member. Without this gate, any member could sign out, open a friend's
-- invite link, sign back in and hand that friend an activation — codes traded after the fact.
set local request.jwt.claims = '{"sub":"dddd0000-0000-0000-0000-000000000078","role":"authenticated"}';
select public.redeem_pending_referral(current_setting('test.code_a'));

select is(
  (select count(*) from public.invites where invitee_id = 'dddd0000-0000-0000-0000-000000000078')::int,
  0,
  'an account older than the window redeems nothing (no trading codes after the fact)'
);

reset role;

-- ── 10. rule #1 — invites confer zero Aura, on this path too ─────────────────────────────
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('aaaa0000-0000-0000-0000-000000000078',
                         'bbbb0000-0000-0000-0000-000000000078')),
  0,
  'a post-hoc referral activation confers zero Aura (rule #1)'
);
reset role;

select * from finish();
rollback;
