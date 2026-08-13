-- Signup throttle on the public waitlist (issue #23).
--
-- SPEC-FIRST, like 0017: a throttle that exists but admits everything keeps its name, its
-- trigger and its grants. Every assertion below performs a real INSERT as `anon` and checks
-- what happened.
--
-- The surface this protects is the one page guaranteed to be public before anything else, and
-- it is unauthenticated — so the interesting cases are the boundary (does the Nth signup pass
-- or fail?), the isolation (can one address exhaust another's budget?), and the shape of the
-- refusal (does the route get something it can turn into a 429 rather than a 500?).

begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ── shape ────────────────────────────────────────────────────────────────────────────────────
select has_function('athanor'::name, 'waitlist_throttle_check'::name,
  'athanor.waitlist_throttle_check() exists');

-- tgtype bits, not just the name: 1 = ROW, 2 = BEFORE, 4 = INSERT. A recreate as AFTER, or a
-- `ALTER TABLE … DISABLE TRIGGER`, keeps the name and disarms the throttle, so the name alone
-- would be the same kind of assertion 0017's header warns about.
select ok(
  (select (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 4) = 4 and tgenabled = 'O'
     from pg_trigger
    where tgrelid = 'public.email_waitlist'::regclass and tgname = 'email_waitlist_throttle'),
  'the throttle is an ENABLED BEFORE INSERT FOR EACH ROW trigger on email_waitlist');

select is(
  (select p.prosecdef from pg_proc p
    where p.proname = 'waitlist_throttle_check' and p.pronamespace = 'athanor'::regnamespace),
  true, 'waitlist_throttle_check is SECURITY DEFINER (anon must not be able to reset a counter)');

-- `set search_path = ''` is stored as the quoted empty string, not a bare `search_path=`.
select is(
  (select p.proconfig from pg_proc p
    where p.proname = 'waitlist_throttle_check' and p.pronamespace = 'athanor'::regnamespace),
  array['search_path=""'], 'waitlist_throttle_check locks search_path to empty');

-- THE reason this is a trigger rather than an anon-callable RPC. 0080 asserts that no SECURITY
-- DEFINER function anywhere is anon-executable; a trigger fires without that grant because
-- EXECUTE is checked when the trigger is created, not when it runs. If this ever goes green as
-- "executable", the throttle has become the first hole in that invariant.
select ok(
  not has_function_privilege('anon', 'athanor.waitlist_throttle_check()', 'execute'),
  'anon cannot call the throttle function directly — it only fires as a trigger');
select ok(
  not has_function_privilege('authenticated', 'athanor.waitlist_throttle_check()', 'execute'),
  'a signed-in member cannot call it directly either');

-- ── the counter table is unreachable ─────────────────────────────────────────────────────────
select ok(
  not has_table_privilege('anon', 'athanor.waitlist_throttle', 'select'),
  'anon cannot read the throttle counters');
select ok(
  not has_table_privilege('anon', 'athanor.waitlist_throttle', 'insert')
  and not has_table_privilege('anon', 'athanor.waitlist_throttle', 'update')
  and not has_table_privilege('anon', 'athanor.waitlist_throttle', 'delete'),
  'anon cannot write or reset the throttle counters');
select is(
  (select relrowsecurity from pg_class where oid = 'athanor.waitlist_throttle'::regclass),
  true, 'athanor.waitlist_throttle has RLS enabled');

-- Exhaustive, empty-set form (issue #271, was #138): RLS-enabled with ZERO policies is the
-- deny-by-default the grants above rely on — only the DEFINER trigger function touches the
-- counters. Any policy appearing here would be the first client path to them.
select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'athanor' and tablename = 'waitlist_throttle' $$,
  'no policy of any kind exists on athanor.waitlist_throttle — deny-by-default is total');

-- ── it actually counts, as the role that actually signs up ───────────────────────────────────
-- PostgREST sets request.headers per request; simulating it is what proves the key is read from
-- the header rather than from something the route hands over.
set local role anon;
set local request.headers = '{"x-forwarded-for": "203.0.113.7, 70.41.3.18"}';

-- The limit is 5. The boundary IS the assertion: an off-by-one here is the difference between
-- a limit and a suggestion.
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('t1@test.athanor', 'it') $$,
  'signup 1 of 5 is accepted');
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('t2@test.athanor', 'it') $$,
  'signup 2 of 5 is accepted');
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('t3@test.athanor', 'it') $$,
  'signup 3 of 5 is accepted');
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('t4@test.athanor', 'it') $$,
  'signup 4 of 5 is accepted');
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('t5@test.athanor', 'it') $$,
  'the LAST signup at the limit is accepted, not refused');

-- PT429, not a bare P0001. PostgREST maps a PTxxx SQLSTATE onto that HTTP status, and the code
-- alone is what @athanor/api's isWaitlistRateLimited matches — any `raise exception` produces
-- P0001, so keying on that would answer 429 to unrelated failures on this table.
select throws_ok(
  $$ insert into public.email_waitlist (email, locale) values ('t6@test.athanor', 'it') $$,
  'PT429', 'waitlist_rate_limited',
  'the signup past the limit raises PT429 waitlist_rate_limited');

-- ── one address cannot exhaust another's budget ──────────────────────────────────────────────
set local request.headers = '{"x-forwarded-for": "198.51.100.4"}';
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('other@test.athanor', 'it') $$,
  'a different client address has its own budget');

-- ── the FIRST forwarded entry is the client, not the last proxy ──────────────────────────────
-- The edge appends its own hop (Cloudflare does; Vercel did). Keying on the last would put every
-- request in a region into one bucket, so real users would throttle each other off. This header
-- shares its LAST entry with the exhausted client above and differs in its first: it must be admitted.
set local request.headers = '{"x-forwarded-for": "192.0.2.55, 70.41.3.18"}';
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('first-hop@test.athanor', 'it') $$,
  'the budget is keyed on the FIRST x-forwarded-for entry, not the trailing proxy');

reset role;

-- ── the raw address never lands in the table ─────────────────────────────────────────────────
-- GDPR: an IP is personal data. What is stored is sha256(window_start || address), so it is
-- neither readable nor correlatable across windows — and rows are pruned by the trigger itself,
-- not by a cron that might never be scheduled (which is what happened to purge_email_waitlist).
select ok(
  (select bool_and(key_hash ~ '^[0-9a-f]{64}$') from athanor.waitlist_throttle),
  'every stored key is a sha256 hex digest, never the address');

-- The salt is what makes the hash uncorrelatable across windows, and it is the part a
-- "simplification" would drop: an unsalted sha256 of an IP is a 4-billion-entry rainbow table.
-- Assert the stored digest is NOT the plain hash of the address.
select is_empty(
  $$ select key_hash from athanor.waitlist_throttle
      where key_hash = encode(sha256(convert_to('198.51.100.4', 'utf8')), 'hex') $$,
  'the digest is salted with the window, not a bare sha256 of the address');

select finish();
rollback;
