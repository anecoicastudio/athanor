begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- 1. function exists
select has_function('public', 'invoke_score_engine_decay', array[]::text[],
  'invoke_score_engine_decay() exists');

-- 2. authenticated has NO execute (revoked by the migration)
select ok(
  not has_function_privilege('authenticated', 'public.invoke_score_engine_decay()', 'execute'),
  'authenticated has NO execute on the decay invoker'
);

-- 3. unconfigured (no app.settings.*) → guard returns void without error
-- (run as the default superuser: pg_cron invokes this as postgres in production;
--  the migration revokes execute from public/anon/authenticated and grants no one else)
select lives_ok(
  $$ select public.invoke_score_engine_decay() $$,
  'decay invoker no-ops cleanly when score_engine_url/_key are unset (pre-deploy)'
);

-- ── unauthorised actors (rule #1: only the engine moves Aura) ─────────────────
-- The decay invoker is the client-facing entry point to the score engine. Assertion 2 proves
-- `authenticated` holds no EXECUTE; these prove the same for `anon` and, more importantly,
-- that an actual call from either role is REFUSED rather than silently no-op'd. A privilege
-- check answers "is the grant absent"; only a call answers "is the door shut".

-- 4. anon holds no execute either (the migration revokes from public, anon, authenticated)
select ok(
  not has_function_privilege('anon', 'public.invoke_score_engine_decay()', 'execute'),
  'anon has NO execute on the decay invoker'
);

-- 5. an authenticated member calling it is refused (42501 = insufficient_privilege)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.invoke_score_engine_decay() $$,
  '42501', null,
  'authenticated member cannot invoke score decay (rule #1: engine-only)'
);
reset role;

-- 6. and neither can an anonymous caller
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select public.invoke_score_engine_decay() $$,
  '42501', null,
  'anon cannot invoke score decay (rule #1: engine-only)'
);
reset role;

select * from finish();
rollback;
