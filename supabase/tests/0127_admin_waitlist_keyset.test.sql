begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- #335: admin_list_waitlist is a keyset reader now — (created_at desc, id desc), cursor
-- = the last row's pair, limit clamped to 1..1000. The old flat-limit shape is gone.

-- ── shape ─────────────────────────────────────────────────────────────────────────────
select has_function(
  'public', 'admin_list_waitlist', array['integer', 'timestamp with time zone', 'uuid'],
  'admin_list_waitlist(int, timestamptz, uuid) exists');
select hasnt_function(
  'public', 'admin_list_waitlist', array['integer'],
  'the flat-limit admin_list_waitlist(int) is gone — no overload PostgREST could confuse');
select is_definer(
  'public', 'admin_list_waitlist', array['integer', 'timestamp with time zone', 'uuid'],
  'still SECURITY DEFINER: the table has no SELECT policy, this RPC is the only read');
select function_privs_are(
  'public', 'admin_list_waitlist', array['integer', 'timestamp with time zone', 'uuid'],
  'anon', array[]::text[], 'anon cannot execute admin_list_waitlist');
select function_privs_are(
  'public', 'admin_list_waitlist', array['integer', 'timestamp with time zone', 'uuid'],
  'authenticated', array['EXECUTE'], 'authenticated may execute (is_admin gates inside)');
select has_index(
  'public', 'email_waitlist', 'email_waitlist_created_at_id_idx',
  'the keyset order (created_at desc, id desc) is indexed');

-- ── fixture ───────────────────────────────────────────────────────────────────────────
-- one admin, one normal member
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','admin@test.athanor','{}'::jsonb,'{"role":"admin"}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','member@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now());

-- The throttle trigger (0083) allows 5 signups per window per address and fires for every
-- role, so a fixture of a thousand rows cannot go through it. Disabled for this transaction
-- only — the table is owned by the test role, and the whole file rolls back.
alter table public.email_waitlist disable trigger email_waitlist_throttle;

-- 1,005 old rows, so the 1000 clamp is observable …
insert into public.email_waitlist (email, created_at)
select format('bulk%s@test.athanor', g), timestamptz '2025-01-01T00:00:00Z' + (g * interval '1 second')
from generate_series(1, 1005) g;

-- … and five newer rows with fixed ids, two of them sharing a timestamp (the tie-break case).
insert into public.email_waitlist (id, email, locale, source, created_at) values
 ('10000000-0000-4000-8000-000000000001', 'e1@test.athanor', 'it', 'landing-hero',   '2026-01-01T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000002', 'e2@test.athanor', 'en', 'landing-footer', '2026-01-02T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000003', 'e3@test.athanor', 'it', null,             '2026-01-03T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000004', 'e4@test.athanor', 'it', null,             '2026-01-03T00:00:00Z'),
 ('10000000-0000-4000-8000-000000000005', 'e5@test.athanor', 'en', 'landing-hero',   '2026-01-04T00:00:00Z');

-- ── gates ─────────────────────────────────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select public.admin_list_waitlist() $$,
  '42501', null, 'anon cannot list the waitlist (no EXECUTE)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_list_waitlist() $$,
  '42501', null, 'a signed-in non-admin gets 42501 from the is_admin gate');
reset role;

-- ── admin: order, cursor walk, tie-break, clamp ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';

-- default page: 25 rows, newest first, id is part of the projection now
select is((select count(*) from public.admin_list_waitlist())::int, 25, 'default page is 25 rows, not the whole table');
select results_eq(
  $$ select email from public.admin_list_waitlist(5) $$,
  $$ values ('e5@test.athanor'), ('e4@test.athanor'), ('e3@test.athanor'), ('e2@test.athanor'), ('e1@test.athanor') $$,
  'newest first; the shared-timestamp pair is ordered by id desc');
select is(
  (select id from public.admin_list_waitlist(1)),
  '10000000-0000-4000-8000-000000000005'::uuid,
  'the row carries its id — the cursor tie-break the old shape omitted');

-- page 1 of 2 → its last row is (2026-01-03, …0004); page 2 must start at the OTHER row
-- sharing that timestamp and must not repeat …0004
select results_eq(
  $$ select email from public.admin_list_waitlist(2) $$,
  $$ values ('e5@test.athanor'), ('e4@test.athanor') $$,
  'page 1');
select results_eq(
  $$ select email from public.admin_list_waitlist(2, '2026-01-03T00:00:00Z', '10000000-0000-4000-8000-000000000004') $$,
  $$ values ('e3@test.athanor'), ('e2@test.athanor') $$,
  'page 2 continues past the cursor through the shared timestamp — no skip, no repeat');
select results_eq(
  $$ select email from public.admin_list_waitlist(2, '2026-01-02T00:00:00Z', '10000000-0000-4000-8000-000000000002') $$,
  $$ values ('e1@test.athanor'), ('bulk1005@test.athanor') $$,
  'page 3 runs off the fixed rows into the newest bulk row — the walk does not stop at a gap');

-- half a cursor is a caller bug, not page 1
select throws_ok(
  $$ select public.admin_list_waitlist(2, '2026-01-02T00:00:00Z', null) $$,
  '22023', null, 'created_at without id is refused');
select throws_ok(
  $$ select public.admin_list_waitlist(2, null, '10000000-0000-4000-8000-000000000002') $$,
  '22023', null, 'id without created_at is refused');

-- clamp: the 5000 of old is answered with 1000, a zero or null limit with 1 / the default
select is((select count(*) from public.admin_list_waitlist(5000))::int, 1000, 'p_limit is clamped to 1000');
select is((select count(*) from public.admin_list_waitlist(0))::int, 1, 'p_limit 0 is clamped to 1');
select is((select count(*) from public.admin_list_waitlist(null))::int, 25, 'a null p_limit falls back to the default page');

-- walking the whole table by cursor sees every row exactly once
select is(
  (with a as (select id, created_at from public.admin_list_waitlist(1000)),
        last_a as (select id, created_at from a order by created_at asc, id asc limit 1),
        b as (select l.id
                from last_a
                cross join lateral public.admin_list_waitlist(1000, last_a.created_at, last_a.id) l)
   select (select count(*) from a) + (select count(*) from b) = 1010
      and (select count(distinct id) from (select id from a union all select id from b) u) = 1010),
  true,
  'two cursor pages of 1000 cover all 1,010 rows exactly once — no gap, no overlap');
reset role;

select * from finish();
rollback;
