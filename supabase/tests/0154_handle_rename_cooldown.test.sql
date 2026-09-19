-- 0154_handle_rename_cooldown.test.sql
-- #782 — the @handle is the member's choice, renameable once every 30 days, enforced by the
-- `profiles_handle_cooldown` trigger (migration 20260919174008). What must hold:
--
--   1. Catalog: the column, the trigger (BEFORE UPDATE OF handle), the function's posture
--      (INVOKER, empty search_path, no client EXECUTE — 0121 states the rule, these witness it).
--   2. Privileges, asserted as privileges (supabase-db.md): no client role can read or write
--      handle_changed_at directly; the member still holds UPDATE on handle, which is exactly why
--      the rule lives in a trigger.
--   3. Behaviour, AS THE MEMBER on their own row — the direct PostgREST path the app does not own:
--      the first choice starts no clock; the first rename is free and stamps it; a second inside
--      30 days is refused with PT429 handle_cooldown and a DETAIL naming the reopening instant;
--      naming the handle without changing it, and editing another column, are not renames;
--      clearing is refused; the boundary is exact (30 days minus a second refused, 30 accepted);
--      a released handle is free at once; unique and reserved still refuse as before.
--   4. The operator is not bound: service_role and postgres rename inside the window, and still
--      stamp the clock.
--
-- The clock is driven by WRITING handle_changed_at as service_role, never by sleeping. now() is
-- frozen for the transaction, so every stamp in this file equals now().

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c1540000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'cooldown154_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1540000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'cooldown154_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- The refusal's DETAIL is the one thing throws_ok cannot see. Created before any role switch;
-- a pg_temp function is EXECUTE-able by PUBLIC like any other, so the member role can call it,
-- and it runs as the caller (INVOKER) — the trigger still sees current_user = authenticated.
create function pg_temp.rename_refusal_detail(p_id uuid, p_handle text)
returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  update public.profiles set handle = p_handle where id = p_id;
  return 'no refusal';
exception when sqlstate 'PT429' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

-- ── 1. catalog ───────────────────────────────────────────────────────────────────────────────
select has_column('public', 'profiles', 'handle_changed_at', 'profiles.handle_changed_at exists');
select col_type_is('public', 'profiles', 'handle_changed_at', 'timestamp with time zone',
  'handle_changed_at is a timestamptz');
select col_is_null('public', 'profiles', 'handle_changed_at',
  'handle_changed_at is nullable — NULL until the first rename');
select has_trigger('public', 'profiles', 'profiles_handle_cooldown',
  'the cooldown trigger is wired on profiles');
select alike(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_handle_cooldown'),
  '%BEFORE UPDATE OF handle ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_handle_cooldown()%',
  'the trigger fires BEFORE UPDATE OF handle, for every row — INSERT is handle_new_user''s NULL'
);
select ok(
  (select not prosecdef from pg_proc where oid = 'public.profiles_handle_cooldown()'::regprocedure),
  'profiles_handle_cooldown is SECURITY INVOKER — it must see the writer''s role'
);
select is(
  (select array_to_string(proconfig, ',') from pg_proc
    where oid = 'public.profiles_handle_cooldown()'::regprocedure),
  'search_path=""',
  'profiles_handle_cooldown pins an empty search_path'
);
select ok(not has_function_privilege('anon', 'public.profiles_handle_cooldown()', 'execute'),
  'anon cannot execute the trigger function');
select ok(not has_function_privilege('authenticated', 'public.profiles_handle_cooldown()', 'execute'),
  'authenticated cannot execute the trigger function');

-- ── 2. privileges, not reads ─────────────────────────────────────────────────────────────────
select ok(has_column_privilege('authenticated', 'public.profiles', 'handle', 'UPDATE'),
  'the premise: a member holds UPDATE on handle — the direct path the trigger exists to bind');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'handle_changed_at', 'UPDATE'),
  'a member cannot UPDATE handle_changed_at — resetting their own clock is not theirs to do');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'handle_changed_at', 'INSERT'),
  'nor INSERT it');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'handle_changed_at', 'SELECT'),
  'no direct SELECT for members — the owner reads it through get_own_profile()');
select ok(not has_column_privilege('anon', 'public.profiles', 'handle_changed_at', 'SELECT'),
  'anon cannot read it');

-- ── 3. behaviour, as member A on their own row ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1540000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select handle from public.get_own_profile()), null::text,
  'a new profile starts with no handle — nothing is derived from the email'
);
select lives_ok(
  $$ update public.profiles set handle = 'cool154_first'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'the first choice lands'
);
select is(
  (select handle_changed_at from public.get_own_profile()), null::timestamptz,
  'the first choice starts no clock — a mistyped onboarding handle can be fixed at once'
);
select lives_ok(
  $$ update public.profiles set handle = 'cool154_second'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'the first rename is free'
);
select is(
  (select handle_changed_at from public.get_own_profile()), now(),
  'and it stamps the clock'
);
select throws_ok(
  $$ update public.profiles set handle = 'cool154_third'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'PT429', 'handle_cooldown',
  'a second rename inside 30 days is refused with PT429 handle_cooldown'
);
select is(
  (select handle from public.get_own_profile()), 'cool154_second',
  'and the refused rename changed nothing'
);
select lives_ok(
  $$ update public.profiles set handle = 'cool154_second'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'naming the handle without changing it is not a rename — the edit form and the staging seed do this'
);
select lives_ok(
  $$ update public.profiles set bio = 'sempre io'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'the rest of the profile stays editable inside the window'
);
select throws_ok(
  $$ update public.profiles set handle = null
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  '23502', 'handle_required',
  'a member cannot clear their handle — NULL-then-new would walk around the clock'
);
reset role;

-- The boundary. The clock is moved by writing it as the operator.
set local role service_role;
update public.profiles set handle_changed_at = now() - interval '30 days' + interval '1 second'
 where id = 'c1540000-0000-4000-8000-000000000001';
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1540000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set handle = 'cool154_third'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'PT429', 'handle_cooldown',
  '30 days minus one second after the last rename: still refused'
);
select is(
  pg_temp.rename_refusal_detail('c1540000-0000-4000-8000-000000000001', 'cool154_third'),
  to_char((now() + interval '1 second') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'the refusal''s DETAIL is the ISO instant the next rename opens — what the app formats'
);
select alike(
  pg_temp.rename_refusal_detail('c1540000-0000-4000-8000-000000000001', 'cool154_third'),
  '____-__-__T__:__:__.___Z',
  'and it is shaped for Date.parse on every engine, Hermes included'
);
reset role;

set local role service_role;
update public.profiles set handle_changed_at = now() - interval '30 days'
 where id = 'c1540000-0000-4000-8000-000000000001';
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1540000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set handle = 'cool154_third'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'exactly 30 days after the last rename: accepted'
);
select is(
  (select handle_changed_at from public.get_own_profile()), now(),
  'and the clock restarts'
);
reset role;

-- ── a released handle is free at once, and the other refusals are unchanged ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1540000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set handle = 'cool154_second'
     where id = 'c1540000-0000-4000-8000-000000000002' $$,
  'the handle A released a moment ago is B''s to claim — no history, no hold'
);
select is(
  (select handle_changed_at from public.get_own_profile()), null::timestamptz,
  'B''s first choice starts no clock either'
);
select throws_ok(
  $$ update public.profiles set handle = 'cool154_third'
     where id = 'c1540000-0000-4000-8000-000000000002' $$,
  '23505', null,
  'a handle someone holds is still refused by the unique index — the trigger let the rename through'
);
select throws_ok(
  $$ update public.profiles set handle = 'admin'
     where id = 'c1540000-0000-4000-8000-000000000002' $$,
  '23514', null,
  'a reserved word is still refused by its CHECK, not by the cooldown'
);
select is(
  (select handle_changed_at from public.get_own_profile()), null::timestamptz,
  'refused renames stamp nothing — B''s first rename is still free'
);
select lives_ok(
  $$ update public.profiles set handle = 'cool154_b'
     where id = 'c1540000-0000-4000-8000-000000000002' $$,
  'so B''s first real rename lands'
);
reset role;

-- ── 4. the operator is not bound ─────────────────────────────────────────────────────────────
-- A is inside the window again (renamed a moment ago, stamped now()).
set local role service_role;
update public.profiles set handle_changed_at = now() - interval '1 day'
 where id = 'c1540000-0000-4000-8000-000000000001';
select lives_ok(
  $$ update public.profiles set handle = 'cool154_support'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'service_role renames inside the window — a support rename, the staging seed'
);
select is(
  (select handle_changed_at from public.profiles where id = 'c1540000-0000-4000-8000-000000000001'),
  now(),
  'and still stamps the clock: an operator rename on the member''s behalf counts as theirs'
);
select lives_ok(
  $$ update public.profiles set handle = null
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'service_role may clear a handle (support: send the member back to the handle step)'
);
reset role;

select lives_ok(
  $$ update public.profiles set handle = 'cool154_owner'
     where id = 'c1540000-0000-4000-8000-000000000002' $$,
  'the postgres owner renames inside the window too — migrations and fixtures'
);

-- ── the member who was sent back chooses again ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1540000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set handle = 'cool154_again'
     where id = 'c1540000-0000-4000-8000-000000000001' $$,
  'a change from NULL is a choice, never a rename — whoever cleared it'
);
reset role;

select * from finish();
rollback;
