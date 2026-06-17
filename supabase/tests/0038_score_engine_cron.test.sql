begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- 1. function exists
select has_function('public', 'invoke_score_engine_decay', array[]::text[],
  'invoke_score_engine_decay() exists');

-- 2. authenticated has NO execute (revoked by the migration)
select ok(
  not has_function_privilege('authenticated', 'public.invoke_score_engine_decay()', 'execute'),
  'authenticated has NO execute on the decay invoker'
);

-- 3. unconfigured (no app.settings.*) → guard returns void without error
set local role service_role;
select lives_ok(
  $$ select public.invoke_score_engine_decay() $$,
  'decay invoker no-ops cleanly when score_engine_url/_key are unset (pre-deploy)'
);
reset role;

select * from finish();
rollback;
