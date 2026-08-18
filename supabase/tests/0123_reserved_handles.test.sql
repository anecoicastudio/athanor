-- 0123_reserved_handles.test.sql
-- #430 — `profiles_handle_not_reserved` (migration 20260818095917).
--
-- The guard exists because `profiles.handle` carries INSERT and UPDATE for `authenticated`: a
-- client can claim a handle and change it later without passing through any Zod schema of ours,
-- so a check in `packages/schemas` is a courtesy and this constraint is the enforcement. These
-- assertions are therefore made AS AN AUTHENTICATED MEMBER on their own row — the exact path a
-- real client uses — not as service_role, and not as a unit test of the TS predicate.
--
-- The denominator is asserted first and deliberately: an ordinary handle must LAND on that same
-- path. Without it every `throws_ok` below would pass just as well if RLS were refusing the
-- update for some unrelated reason, and the file would prove nothing about the constraint.
--
-- The concern is impersonation, not routing: `apps/web` resolves profiles at `/@handle`, disjoint
-- from its literal routes, so nothing here is about shadowing `/admin`. It is about `@supporto`
-- looking like Athanor. Hence both languages, and hence the prefix rule for the brand name —
-- exact membership stops `athanor` but not `athanor_support`.
--
-- CI-only (hosted lacks pgtap).

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000123', 'alice123@test.dev');

-- ── as the member herself: her own row, her own grant ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000123","role":"authenticated"}';

-- The denominator. If this fails, every refusal below is meaningless.
select lives_ok(
  $$ update public.profiles set handle = 'alice_123'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  'a member may claim an ordinary handle on her own row'
);
select is(
  (select handle from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000123'),
  'alice_123',
  'and the claim actually landed — the write path is open, not silently no-op'
);

select throws_ok(
  $$ update public.profiles set handle = 'admin'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  '23514', null, 'a listed English role word is refused by the database'
);
select throws_ok(
  $$ update public.profiles set handle = 'supporto'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  '23514', null, 'a listed Italian role word is refused too — IT is the canonical catalogue'
);
select throws_ok(
  $$ update public.profiles set handle = 'athanor'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  '23514', null, 'the brand name itself is refused'
);
select throws_ok(
  $$ update public.profiles set handle = 'athanor_support'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  '23514', null,
  'and so is anything built on it — the prefix rule, which exact membership would miss'
);
select throws_ok(
  $$ update public.profiles set handle = 'Admin'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  '23514', null,
  'case cannot sneak past: the original regex CHECK admits lowercase only, which is why this constraint needs no lower()'
);

-- The guard must not have grown teeth it should not have: only the brand is a prefix.
select lives_ok(
  $$ update public.profiles set handle = 'admin_luna'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  'a handle that merely contains a reserved word is still a person''s to claim'
);

update public.profiles set handle = null
  where id = 'aaaaaaaa-0000-0000-0000-000000000123';
select is(
  (select handle from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000123'),
  null,
  'NULL still passes — handle_new_user inserts every profile with one, and refusing it would abort signup'
);
reset role;

-- ── the refusal is the CONSTRAINT, not a policy ───────────────────────────────────────────
-- service_role bypasses RLS entirely. A CHECK does not care who you are, so this must still
-- throw; if it lived up any other stack, this is where the difference would show.
set local role service_role;
select throws_ok(
  $$ update public.profiles set handle = 'admin'
     where id = 'aaaaaaaa-0000-0000-0000-000000000123' $$,
  '23514', null, 'service_role is refused as well — the guard is a CHECK, not an RLS policy'
);
reset role;

select is(
  (select count(*)::int from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_handle_not_reserved'),
  1,
  'the constraint is present on profiles under the name the mirror test greps for'
);

select * from finish();
rollback;
