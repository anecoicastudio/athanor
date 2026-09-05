-- 0146_profile_birth_date_zodiac.test.sql
-- #694 — profiles.birth_date (owner-only) + profiles.zodiac_sign (generated, public), migration
-- 20260905165133. What must hold, and in which direction:
--
--   1. Catalog: both columns exist; zodiac_sign is a STORED generated column; the two CHECKs and
--      the guard trigger exist by name; athanor.zodiac_sign is IMMUTABLE + STRICT + invoker.
--   2. The cusp table, all 24 boundary days plus the leap day and NULL — the same 24 that
--      packages/core/src/profile/zodiac.test.ts pins in TypeScript. One table, two mirrors.
--   3. Privileges, asserted as privileges (supabase-db.md): no client role can SELECT birth_date;
--      anon CAN select zodiac_sign and authenticated CANNOT — the asymmetry the migration header
--      explains (PG17 + 0073); nobody can write zodiac_sign; the owner role can write birth_date.
--   4. Behaviour: the owner's UPDATE recomputes the sign under the CLIENT role (proves the
--      generation expression is executable by authenticated), get_own_profile carries both, the
--      14-year floor refuses at 23514 on the exact boundary, the 1900 floor refuses, clearing is
--      allowed; another member reads the sign through get_person_profile and cannot reach the
--      date by any spelling; anon likewise; a tombstone shows no sign.
--   5. Realtime: zodiac_sign is NOT in the profiles publication — the reason authenticated holds
--      no column grant (0073 pins publication == grant, and PG17 refuses a generated column there).

begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1460000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'zodiac146_owner@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1460000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'zodiac146_other@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

set local role service_role;
update public.profiles set handle = 'zodiac146_owner', display_name = 'Owner',
       visibility = '{"identity":"public"}'::jsonb
 where id = 'a1460000-0000-4000-8000-000000000001';
update public.profiles set handle = 'zodiac146_other'
 where id = 'b1460000-0000-4000-8000-000000000002';
reset role;

-- ── 1. catalog ─────────────────────────────────────────────────────────────────────────
select has_column('public', 'profiles', 'birth_date', 'profiles.birth_date exists');
select has_column('public', 'profiles', 'zodiac_sign', 'profiles.zodiac_sign exists');
select is(
  (select attgenerated::text from pg_attribute
    where attrelid = 'public.profiles'::regclass and attname = 'zodiac_sign'),
  's', 'zodiac_sign is a STORED generated column — never client-written');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_zodiac_sign_check' and contype = 'c'),
  1, 'profiles_zodiac_sign_check exists as a CHECK (the schemas mirror test reads its list)');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_birth_date_floor' and contype = 'c'),
  1, 'profiles_birth_date_floor exists as a CHECK');
select is(
  (select provolatile::text from pg_proc
    where oid = 'athanor.zodiac_sign(date)'::regprocedure),
  'i', 'athanor.zodiac_sign is IMMUTABLE — a generated column demands it');
select ok(
  (select proisstrict from pg_proc where oid = 'athanor.zodiac_sign(date)'::regprocedure),
  'athanor.zodiac_sign is STRICT — a NULL date yields a NULL sign without entering the body');
select ok(
  (select not prosecdef from pg_proc where oid = 'athanor.zodiac_sign(date)'::regprocedure),
  'athanor.zodiac_sign is SECURITY INVOKER — nothing here needs elevation');
select has_trigger('public', 'profiles', 'profiles_birth_date_guard',
  'the min-age guard trigger is wired on profiles');
select alike(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_birth_date_guard'),
  '%BEFORE INSERT OR UPDATE OF birth_date ON public.profiles FOR EACH ROW WHEN ((new.birth_date IS NOT NULL))%',
  'guard fires BEFORE INSERT OR UPDATE OF birth_date, only when a date is being written');

-- function ACLs: the helper is reachable by the writing role only; the trigger fn by nobody
select ok(not has_function_privilege('anon', 'athanor.zodiac_sign(date)', 'execute'),
  'anon cannot execute athanor.zodiac_sign');
select ok(has_function_privilege('authenticated', 'athanor.zodiac_sign(date)', 'execute'),
  'authenticated can execute athanor.zodiac_sign — the generation expression runs as the writer');
select ok(has_function_privilege('service_role', 'athanor.zodiac_sign(date)', 'execute'),
  'service_role can execute athanor.zodiac_sign — every role that writes profiles recomputes the generated column (20260905171924; the first migration''s ACL dropped it and every service-role UPDATE failed 42501)');
select ok(not has_function_privilege('anon', 'athanor.profiles_birth_date_guard()', 'execute'),
  'anon cannot execute the guard (trigger functions are revoked — 0121 rule)');
select ok(not has_function_privilege('authenticated', 'athanor.profiles_birth_date_guard()', 'execute'),
  'authenticated cannot execute the guard');

-- ── 2. the cusp table — first and last day of every sign, Italian fixed convention ─────
select is(athanor.zodiac_sign(date '2000-03-21'), 'ariete',     'ariete starts 21 March');
select is(athanor.zodiac_sign(date '2000-04-20'), 'ariete',     'ariete ends 20 April');
select is(athanor.zodiac_sign(date '2000-04-21'), 'toro',       'toro starts 21 April');
select is(athanor.zodiac_sign(date '2000-05-20'), 'toro',       'toro ends 20 May');
select is(athanor.zodiac_sign(date '2000-05-21'), 'gemelli',    'gemelli starts 21 May');
select is(athanor.zodiac_sign(date '2000-06-21'), 'gemelli',    'gemelli ends 21 June');
select is(athanor.zodiac_sign(date '2000-06-22'), 'cancro',     'cancro starts 22 June');
select is(athanor.zodiac_sign(date '2000-07-22'), 'cancro',     'cancro ends 22 July');
select is(athanor.zodiac_sign(date '2000-07-23'), 'leone',      'leone starts 23 July');
select is(athanor.zodiac_sign(date '2000-08-23'), 'leone',      'leone ends 23 August');
select is(athanor.zodiac_sign(date '2000-08-24'), 'vergine',    'vergine starts 24 August');
select is(athanor.zodiac_sign(date '2000-09-22'), 'vergine',    'vergine ends 22 September');
select is(athanor.zodiac_sign(date '2000-09-23'), 'bilancia',   'bilancia starts 23 September');
select is(athanor.zodiac_sign(date '2000-10-22'), 'bilancia',   'bilancia ends 22 October');
select is(athanor.zodiac_sign(date '2000-10-23'), 'scorpione',  'scorpione starts 23 October');
select is(athanor.zodiac_sign(date '2000-11-22'), 'scorpione',  'scorpione ends 22 November');
select is(athanor.zodiac_sign(date '2000-11-23'), 'sagittario', 'sagittario starts 23 November');
select is(athanor.zodiac_sign(date '2000-12-21'), 'sagittario', 'sagittario ends 21 December');
select is(athanor.zodiac_sign(date '2000-12-22'), 'capricorno', 'capricorno starts 22 December');
select is(athanor.zodiac_sign(date '2001-01-20'), 'capricorno', 'capricorno ends 20 January — the wrap');
select is(athanor.zodiac_sign(date '2000-01-21'), 'acquario',   'acquario starts 21 January');
select is(athanor.zodiac_sign(date '2000-02-19'), 'acquario',   'acquario ends 19 February');
select is(athanor.zodiac_sign(date '2000-02-20'), 'pesci',      'pesci starts 20 February');
select is(athanor.zodiac_sign(date '2000-03-20'), 'pesci',      'pesci ends 20 March');
select is(athanor.zodiac_sign(date '2000-02-29'), 'pesci',      'the leap day is pesci');
select is(athanor.zodiac_sign(null::date), null::text,          'a NULL date has no sign (STRICT)');

-- ── 3. privileges, not reads ───────────────────────────────────────────────────────────
select ok(not has_column_privilege('anon', 'public.profiles', 'birth_date', 'SELECT'),
  'anon holds no SELECT on birth_date');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'birth_date', 'SELECT'),
  'authenticated holds no SELECT on birth_date — the only read path is get_own_profile');
select ok(has_column_privilege('anon', 'public.profiles', 'zodiac_sign', 'SELECT'),
  'anon holds SELECT on zodiac_sign — apps/web /@handle reads it off the table');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'zodiac_sign', 'SELECT'),
  'authenticated holds NO SELECT on zodiac_sign: PG17 cannot publish a generated column and 0073 pins publication == grant; members read it via the DEFINER RPCs');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'zodiac_sign', 'UPDATE'),
  'authenticated holds no UPDATE on zodiac_sign (generated)');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'zodiac_sign', 'INSERT'),
  'authenticated holds no INSERT on zodiac_sign (generated)');
select ok(has_column_privilege('authenticated', 'public.profiles', 'birth_date', 'UPDATE'),
  'authenticated holds UPDATE on birth_date — the owner writes it (RLS scopes to own row)');
select ok(has_column_privilege('authenticated', 'public.profiles', 'birth_date', 'INSERT'),
  'authenticated holds INSERT on birth_date (parity with every column since 20260617225450)');
select ok(not has_column_privilege('anon', 'public.profiles', 'birth_date', 'UPDATE'),
  'anon holds no UPDATE on birth_date');

-- ── 5. realtime — the reason for the authenticated asymmetry ───────────────────────────
select ok(
  not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
       and 'zodiac_sign' = any(attnames)),
  'zodiac_sign is not in the profiles realtime publication (PG17 refuses a generated column there)');

-- ── 4a. the owner writes the date; the sign follows, under the client role ─────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1460000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set birth_date = date '1990-08-10'
      where id = 'a1460000-0000-4000-8000-000000000001' $$,
  'owner sets birth_date — the generation expression runs as authenticated and succeeds');
select is((select zodiac_sign from public.get_own_profile()), 'leone',
  'get_own_profile carries the generated sign');
select is((select birth_date from public.get_own_profile()), date '1990-08-10',
  'get_own_profile carries the date — the one read path for it');
select throws_ok(
  $$ update public.profiles
        set birth_date = ((now() at time zone 'utc')::date - interval '14 years' + interval '1 day')::date
      where id = 'a1460000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a member turning 14 tomorrow is refused with check_violation');
select lives_ok(
  $$ update public.profiles
        set birth_date = ((now() at time zone 'utc')::date - interval '14 years')::date
      where id = 'a1460000-0000-4000-8000-000000000001' $$,
  'a member turning 14 today is admitted — the boundary is inclusive');
select throws_ok(
  $$ update public.profiles set birth_date = date '1899-12-31'
      where id = 'a1460000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a date before the 1900 floor is refused with check_violation');
select lives_ok(
  $$ update public.profiles set birth_date = null
      where id = 'a1460000-0000-4000-8000-000000000001' $$,
  'the owner may clear the date (requiredness is the onboarding schema''s job, not the column''s)');
select is((select zodiac_sign from public.get_own_profile()), null::text,
  'no date, no sign');
update public.profiles set birth_date = date '1990-08-10'
 where id = 'a1460000-0000-4000-8000-000000000001';
reset role;

-- ── 4b. another member: the sign through the RPC, the date by no spelling ──────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1460000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select birth_date from public.profiles where id = 'a1460000-0000-4000-8000-000000000001' $$,
  '42501', null, 'another member cannot select birth_date directly (column grant)');
select is(
  (select zodiac_sign from public.get_person_profile('a1460000-0000-4000-8000-000000000001')),
  'leone', 'get_person_profile projects the sign, unmasked');
select throws_ok(
  $$ select birth_date from public.get_person_profile('a1460000-0000-4000-8000-000000000001') $$,
  '42703', null, 'get_person_profile has no birth_date column at all');
reset role;

-- ── 4c. anon: the sign off the table, the date never ───────────────────────────────────
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select birth_date from public.profiles where id = 'a1460000-0000-4000-8000-000000000001' $$,
  '42501', null, 'anon cannot select birth_date');
select is(
  (select zodiac_sign from public.profiles where id = 'a1460000-0000-4000-8000-000000000001'),
  'leone', 'anon reads zodiac_sign on the default public shell');
reset role;

-- ── 4d. a tombstone wears no sign ──────────────────────────────────────────────────────
set local role service_role;
update public.profiles set banned_at = now() where id = 'a1460000-0000-4000-8000-000000000001';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1460000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select removed from public.get_person_profile('a1460000-0000-4000-8000-000000000001')),
  true, 'the banned row still resolves, as a tombstone (control)');
select is(
  (select zodiac_sign from public.get_person_profile('a1460000-0000-4000-8000-000000000001')),
  null::text, 'a tombstone shows no sign');
reset role;

select * from finish();
rollback;
