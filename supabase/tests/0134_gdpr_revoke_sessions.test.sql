-- 0134_gdpr_revoke_sessions.test.sql
-- Issue #542 — erasure cascade step (1) never revoked anything. The auth port was wired to
-- auth-js `admin.signOut(profileId, 'global')`, a call that takes «A valid, logged-in JWT» and
-- sends its first argument as the Authorization bearer; GoTrue 401s on a profile id every time,
-- so the loop recorded a failed step and the erasure landed `failed` with the member's sessions
-- still open — on every request that took this path (how many did is unknown: the job is
-- deployed but unscheduled behind the legal gate). No admin surface revokes by id — auth-js has
-- getUserById / updateUserById / deleteUser (plus factor and passkey deletes) and GoTrue's
-- /admin router registers no session route — so 20260825074614 puts the revoke where they live:
-- public.gdpr_revoke_sessions(uuid), running GoTrue's own global-logout statement.
--
-- Asserts: catalog shape (SECURITY DEFINER, search_path locked) · the ACL, which on THIS
-- function is the security property and not bookkeeping — it signs any user out by id, so the
-- born-with default (EXECUTE to PUBLIC, plus anon and authenticated from the pg_default_acl 'f'
-- row) would let the unauthenticated internet end anyone's sessions · behaviour: every session
-- of the subject goes, refresh tokens follow, a session_id-NULL orphan is swept, ANOTHER user's
-- session is untouched, the return value is the count revoked, a user with no sessions returns
-- 0 rather than failing, and a second call is a clean no-op.
--
-- The zero case has teeth beyond tidiness: ./logic.ts flips `degraded` on a reported error, and
-- #515/#516 reserve `failed` for a step that actually failed. If revoking nothing read as a
-- failure, every member who never signed in on a second device would land `failed` — #542's
-- outcome arriving through a different door.
--
-- Fixtures are this file's own 9134xxxx-shaped users; nothing here is scoped to a whole-table
-- count, because auth.sessions is a live table on a hosted project.

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────
-- S is the erasure subject; O is an unrelated member who must still be signed in afterwards.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '91340000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'revoke_s@test.athanor', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91340000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'revoke_o@test.athanor', now(), now());

-- Two devices for S, one for O.
insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('91341111-0000-0000-0000-000000000001', '91340000-0000-0000-0000-000000000001', now(), now()),
  ('91341111-0000-0000-0000-000000000002', '91340000-0000-0000-0000-000000000001', now(), now()),
  ('91341111-0000-0000-0000-000000000003', '91340000-0000-0000-0000-000000000002', now(), now());

-- One refresh token per session, plus an orphan: session_id NULL is the pre-sessions-table shape
-- that no cascade reaches, and it is the whole reason the function sweeps refresh_tokens on top
-- of deleting sessions. auth.refresh_tokens.user_id is varchar in GoTrue's schema, not uuid.
insert into auth.refresh_tokens (instance_id, token, user_id, session_id, revoked, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'pgtap0134-s1', '91340000-0000-0000-0000-000000000001',
   '91341111-0000-0000-0000-000000000001', false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'pgtap0134-s2', '91340000-0000-0000-0000-000000000001',
   '91341111-0000-0000-0000-000000000002', false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'pgtap0134-orphan', '91340000-0000-0000-0000-000000000001',
   null, false, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'pgtap0134-o1', '91340000-0000-0000-0000-000000000002',
   '91341111-0000-0000-0000-000000000003', false, now(), now());

-- ── 1. catalog shape ────────────────────────────────────────────────────────────────────────
select has_function('public', 'gdpr_revoke_sessions', array['uuid'],
  'gdpr_revoke_sessions(uuid) exists');

-- SECURITY DEFINER is load-bearing, not stylistic: auth.sessions is owned by supabase_auth_admin
-- and service_role holds no DELETE on it, so an invoker function would 42501 on every call.
select is(
  (select prosecdef from pg_proc where oid = 'public.gdpr_revoke_sessions(uuid)'::regprocedure),
  true,
  'runs SECURITY DEFINER — service_role cannot delete from auth.sessions on its own'
);

-- An unlocked search_path on a DEFINER function is the classic escalation: the caller chooses
-- which `sessions` the delete resolves to.
select is(
  (select proconfig from pg_proc where oid = 'public.gdpr_revoke_sessions(uuid)'::regprocedure),
  array['search_path=""'],
  'search_path is locked to the empty string'
);

-- For a SECURITY DEFINER function the OWNER is the borrowed right, so it is the one attribute
-- that must not drift: `postgres` is the role that holds DELETE on auth.sessions and carries
-- BYPASSRLS past its zero-policy RLS. Owned by anyone else, this function is a 42501 or a
-- silent zero-row delete, and the migration's whole rationale (20260825074614:32) evaporates.
select is(
  (select proowner::regrole::text
     from pg_proc where oid = 'public.gdpr_revoke_sessions(uuid)'::regprocedure),
  'postgres',
  'owned by postgres — the role whose DELETE and BYPASSRLS the DEFINER borrows'
);

-- ── 2. the ACL — the security property ──────────────────────────────────────────────────────
-- #409: a new function is born executable by PUBLIC, and the 'f' default ACL adds anon and
-- authenticated. On a function that ends any user's sessions by id, that default is the
-- vulnerability itself. 0121 pins anon and PUBLIC schema-wide; these three name this function,
-- so the finding is legible here rather than as one row in a sweep.
select ok(
  not has_function_privilege('anon', 'public.gdpr_revoke_sessions(uuid)', 'execute'),
  'anon cannot execute it — the unauthenticated internet cannot sign anyone out'
);

select ok(
  not has_function_privilege('authenticated', 'public.gdpr_revoke_sessions(uuid)', 'execute'),
  'authenticated cannot execute it — no member can end another member''s sessions'
);

select ok(
  has_function_privilege('service_role', 'public.gdpr_revoke_sessions(uuid)', 'execute'),
  'service_role CAN execute it — the erasure job reaches Postgres as service_role'
);

-- ── 3. behaviour ────────────────────────────────────────────────────────────────────────────
-- The return value is the count of sessions revoked. The erasure job ignores it, but a revoke
-- that reports how much it did is the difference between "ran" and "did something" when the
-- live re-proof reads the run back.
select is(
  public.gdpr_revoke_sessions('91340000-0000-0000-0000-000000000001'::uuid),
  2,
  'returns the number of sessions revoked'
);

select is(
  (select count(*) from auth.sessions where user_id = '91340000-0000-0000-0000-000000000001'),
  0::bigint,
  'every session of the subject is gone'
);

-- Access tokens already minted stay valid until they expire — stateless JWT, true of GoTrue's
-- own /logout too. What the revoke buys is that no NEW one can be minted, which is this:
select is(
  (select count(*) from auth.refresh_tokens where user_id = '91340000-0000-0000-0000-000000000001'),
  0::bigint,
  'the subject''s refresh tokens go too, orphan included — no new access token can be minted'
);

-- Named separately from the count above: a cascade would have taken the two session-bound rows
-- on its own, and only the explicit sweep reaches this one. If the sweep is ever dropped as
-- redundant, this is the assertion that says what was lost.
select is(
  (select count(*) from auth.refresh_tokens where token = 'pgtap0134-orphan'),
  0::bigint,
  'a refresh token with a NULL session_id is swept — no cascade reaches it'
);

-- Blast radius. The function takes a user id and must honour it.
select is(
  (select count(*) from auth.sessions where user_id = '91340000-0000-0000-0000-000000000002'),
  1::bigint,
  'another member''s session is untouched'
);

select is(
  (select count(*) from auth.refresh_tokens where token = 'pgtap0134-o1'),
  1::bigint,
  'another member''s refresh token is untouched'
);

-- Idempotent: every step of the erasure loop has to be, because nothing re-queues a failed
-- request and re-driving one is a manual act until #107 lands.
select is(
  public.gdpr_revoke_sessions('91340000-0000-0000-0000-000000000001'::uuid),
  0,
  'a second call is a clean no-op'
);

-- A member who never signed in on any device. Zero is a result, not an error — see the header.
select is(
  public.gdpr_revoke_sessions('91340000-0000-0000-0000-000000000009'::uuid),
  0,
  'a user with no sessions revokes 0 and does not raise'
);

select * from finish();
rollback;
