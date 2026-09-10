-- #733 — a pending erasure request bans sign-in at once (20260910130552), and the ban is
-- sticky, reaches the re-queue path and closes the Data API (20260910132434, 20260910134453,
-- 20260910140902). The claims:
--
--   1. THE REQUEST BANS. A member's own insert into gdpr_erasure_requests — through RLS, as
--      `authenticated` — leaves auth.users.banned_until ~100 years out. Before it: NULL.
--   2. IT IS THE SAME BAN moderation-enforce writes, 876000h, and it RAISES a shorter existing
--      ban (the member had a 1-hour suspension; after the request they have the erasure ban).
--   3. IT IS STICKY: while the request is not done, a later write that shortens or clears
--      banned_until — a 7-day suspension, a bare NULL — is re-raised; once the row is done the
--      column is the operator's again, and a re-queue (`status = 'requested'`) bans afresh.
--   4. IT CLOSES THE DATA API: athanor.is_active() is false for the member from the request,
--      which is what every restrictive write policy composes (0091).
--   5. A SECOND REQUEST CANNOT MOVE THE CLOCK: the one-open-request index rejects it and
--      banned_until is byte-identical before and after.
--   6. THE SHAPE: both triggers exist with the tgtype they claim (AFTER ROW INSERT|UPDATE with a
--      WHEN clause; BEFORE ROW UPDATE on exactly the banned_until column), both functions are
--      DEFINER with a locked search_path, and no client role can EXECUTE either (#409).
--   7. ONE PREDICATE (20260910134453): a legacy-shaped row inserted straight as `failed` — the
--      pre-#107 population §7.5 reconciles — bans and closes the Data API exactly like a fresh
--      request, so no member can hold an open request and keep sign-in.
begin;
select plan(31);

-- ── fixture ─────────────────────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '73300000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'erase-me@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73300000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'suspended-first@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73300000-0000-0000-0000-0000000000cc',
   'authenticated', 'authenticated', 'data-api@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73300000-0000-0000-0000-0000000000dd',
   'authenticated', 'authenticated', 'legacy-failed@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── 6. shape ────────────────────────────────────────────────────────────────────────────────
select has_trigger('public', 'gdpr_erasure_requests', 'gdpr_erasure_request_bans_signin',
  '#733: the ban trigger exists on gdpr_erasure_requests');
select is(
  (select t.tgtype::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'gdpr_erasure_requests'
     and t.tgname = 'gdpr_erasure_request_bans_signin'),
  21, 'it is AFTER · ROW · INSERT OR UPDATE (tgtype 1+4+16) — the re-queue path fires it too');
select ok(
  (select t.tgqual is not null from pg_trigger t where t.tgname = 'gdpr_erasure_request_bans_signin'),
  'and it carries a WHEN clause');
select ok(
  (select pg_get_functiondef('public.gdpr_ban_on_erasure_request()'::regprocedure)
     like '%tg_op = ''UPDATE'' and old.status <> ''done''%'),
  'on UPDATE the body writes auth.users only for a row coming back from done — the nightly claim takes no auth.users lock (20260910140902; a source pin, because one connection cannot observe the lock)');
select ok(
  (select pg_get_triggerdef(t.oid) like '%WHEN ((new.status <> ''done''::text))%'
     from pg_trigger t where t.tgname = 'gdpr_erasure_request_bans_signin'),
  'and it fires whenever the new status is not done — the same predicate as the sticky trigger and is_active()');
select is(
  (select t.tgtype::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'gdpr_erasure_ban_sticky'),
  19, 'the sticky trigger is BEFORE · ROW · UPDATE on auth.users (tgtype 1+2+16)');
select is(
  (select t.tgattr::text from pg_trigger t where t.tgname = 'gdpr_erasure_ban_sticky'),
  (select a.attnum::text from pg_attribute a
    where a.attrelid = 'auth.users'::regclass and a.attname = 'banned_until'),
  'and it is OF banned_until alone — widening it would fire on every GoTrue sign-in write');
select is_definer('public', 'gdpr_ban_on_erasure_request', array[]::text[],
  'the request trigger function is SECURITY DEFINER — service_role holds no UPDATE on auth.users');
select is_definer('public', 'gdpr_keep_erasure_ban', array[]::text[],
  'the sticky trigger function is SECURITY DEFINER too');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('gdpr_ban_on_erasure_request', 'gdpr_keep_erasure_ban')
      and 'search_path=""' = any(p.proconfig)),
  2, 'both lock search_path to the empty string');
select ok(not has_function_privilege('anon', 'public.gdpr_ban_on_erasure_request()', 'execute')
      and not has_function_privilege('authenticated', 'public.gdpr_ban_on_erasure_request()', 'execute')
      and not has_function_privilege('anon', 'public.gdpr_keep_erasure_ban()', 'execute')
      and not has_function_privilege('authenticated', 'public.gdpr_keep_erasure_ban()', 'execute'),
  '#409: no client role can EXECUTE either trigger function');

-- ── 1. the request bans ─────────────────────────────────────────────────────────────────────
select is(
  (select banned_until from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  null, 'before the request: banned_until is NULL');

set local role authenticated;
set local request.jwt.claims = '{"sub":"73300000-0000-0000-0000-0000000000aa","role":"authenticated"}';
insert into public.gdpr_erasure_requests (profile_id)
values ('73300000-0000-0000-0000-0000000000aa');
reset role;

select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'after the request: banned_until is ~100 years out — GoTrue refuses sign-in and refresh from now');
select ok(
  (select banned_until between now() + interval '876000 hours' - interval '1 minute'
                            and now() + interval '876000 hours' + interval '1 minute'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'the value is BAN_FOREVER, 876000h, the figure moderation-enforce sends as ban_duration');

-- ── 2. a shorter existing ban is RAISED ─────────────────────────────────────────────────────
update auth.users set banned_until = now() + interval '1 hour'
 where id = '73300000-0000-0000-0000-0000000000bb';
select ok(
  (select banned_until < now() + interval '2 hours'
   from auth.users where id = '73300000-0000-0000-0000-0000000000bb'),
  'fixture: a one-hour suspension is in place, and nothing re-raised it (no request yet)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"73300000-0000-0000-0000-0000000000bb","role":"authenticated"}';
insert into public.gdpr_erasure_requests (profile_id)
values ('73300000-0000-0000-0000-0000000000bb');
reset role;
select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000bb'),
  'the request RAISED the one-hour suspension to the erasure ban — the trigger ran on a member who already had a ban');

-- ── 3. sticky while the request is open, released once it is done, re-armed on re-queue ────
update auth.users set banned_until = now() + interval '7 days'
 where id = '73300000-0000-0000-0000-0000000000aa';
select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'a later 7-day suspension (moderation-enforce writes absolutely) is re-raised to the erasure ban');
update auth.users set banned_until = null
 where id = '73300000-0000-0000-0000-0000000000aa';
select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'a bare NULL (the documented moderation un-ban) is re-raised while the request is open');
update public.gdpr_erasure_requests set status = 'done'
 where profile_id = '73300000-0000-0000-0000-0000000000aa';
update auth.users set banned_until = null
 where id = '73300000-0000-0000-0000-0000000000aa';
select is(
  (select banned_until from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  null, 'once the request is done the column is the operator''s again: NULL sticks');
update public.gdpr_erasure_requests set status = 'requested'
 where profile_id = '73300000-0000-0000-0000-0000000000aa';
select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'the §7.5 re-queue (status back to requested) bans afresh — the UPDATE OF status path');
update public.gdpr_erasure_requests set status = 'failed'
 where profile_id = '73300000-0000-0000-0000-0000000000aa';
update auth.users set banned_until = null
 where id = '73300000-0000-0000-0000-0000000000aa';
select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'a failed row is still an open obligation: the ban stays sticky until the row is done or gone');
update public.gdpr_erasure_requests set status = 'partial'
 where profile_id = '73300000-0000-0000-0000-0000000000aa';
update auth.users set banned_until = null
 where id = '73300000-0000-0000-0000-0000000000aa';
select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'and so is a partial row — status <> done is the whole predicate (the status flip itself re-bans under the widened WHEN; the NULL write is what isolates the sticky path)');
update public.gdpr_erasure_requests set status = 'requested'
 where profile_id = '73300000-0000-0000-0000-0000000000aa';

-- ── 4. the Data API half ────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"73300000-0000-0000-0000-0000000000cc","role":"authenticated"}';
select is(athanor.is_active(), true, 'control: an untouched member is active');
insert into public.gdpr_erasure_requests (profile_id)
values ('73300000-0000-0000-0000-0000000000cc');
select is(athanor.is_active(), false,
  'from the request the member is not active — every restrictive write policy now denies their still-valid JWT');
reset role;
select has_index('public', 'gdpr_erasure_requests', 'gdpr_erasure_requests_open_by_profile',
  'the open-request lookup is indexed — is_active() runs on every social write');

-- ── 7. one predicate: a legacy-shaped failed row bans and closes the Data API ──────────────
insert into public.gdpr_erasure_requests (profile_id, status)
values ('73300000-0000-0000-0000-0000000000dd', 'failed');
select ok(
  (select banned_until > now() + interval '99 years'
   from auth.users where id = '73300000-0000-0000-0000-0000000000dd'),
  'a row inserted straight as failed (the pre-#107 shape) bans — no status keeps sign-in open');
set local role authenticated;
set local request.jwt.claims = '{"sub":"73300000-0000-0000-0000-0000000000dd","role":"authenticated"}';
select is(athanor.is_active(), false, 'and the Data API is closed to that member as well — the two halves agree');
reset role;

-- ── 5. a second request cannot move the clock ──────────────────────────────────────────────
select set_config('test.before',
  (select banned_until::text from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"73300000-0000-0000-0000-0000000000aa","role":"authenticated"}';
select throws_ok(
  $$ insert into public.gdpr_erasure_requests (profile_id)
     values ('73300000-0000-0000-0000-0000000000aa') $$,
  '23505',
  null,
  'a second open request is rejected by gdpr_erasure_requests_one_open_per_profile');
reset role;
select is(
  (select banned_until::text from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  current_setting('test.before', true),
  'banned_until is byte-identical before and after the rejected insert');

-- ── bookkeeping ─────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.gdpr_erasure_requests
    where profile_id in ('73300000-0000-0000-0000-0000000000aa',
                         '73300000-0000-0000-0000-0000000000bb',
                         '73300000-0000-0000-0000-0000000000cc',
                         '73300000-0000-0000-0000-0000000000dd')),
  4, 'exactly the four requests exist');
select is(
  (select count(*)::int from auth.users
    where id in ('73300000-0000-0000-0000-0000000000aa',
                 '73300000-0000-0000-0000-0000000000bb',
                 '73300000-0000-0000-0000-0000000000cc',
                 '73300000-0000-0000-0000-0000000000dd')
      and banned_until > now() + interval '99 years'),
  4, 'all four fixture members carry the erasure ban at the end');

select * from finish();
rollback;
