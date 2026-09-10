-- #733 — a pending erasure request bans sign-in at once (the trigger in
-- 20260910130552_gdpr_erasure_request_bans_signin.sql). Four claims:
--
--   1. THE REQUEST BANS. A member's own insert into gdpr_erasure_requests — through RLS, as
--      `authenticated` — leaves auth.users.banned_until ~100 years out. Before it: NULL.
--   2. IT IS THE SAME BAN moderation-enforce writes: 876000h, so GoTrue's IsBanned() closes
--      sign-in and refresh alike, and a longer existing ban is kept (GREATEST), never shortened.
--   3. IT IS THE ONLY WAY IN: the function is DEFINER with a locked search_path, and no client
--      role can EXECUTE it (#409). A trigger, not an RPC.
--   4. A SECOND REQUEST CANNOT MOVE THE CLOCK BACK: the one-open-request index
--      (20260908085513) rejects it, and banned_until is untouched.
begin;
select plan(13);

-- ── fixture ─────────────────────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '73300000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'erase-me@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73300000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'banned-first@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── 3. shape ────────────────────────────────────────────────────────────────────────────────
select has_trigger('public', 'gdpr_erasure_requests', 'gdpr_erasure_request_bans_signin',
  '#733: the ban trigger exists on gdpr_erasure_requests');
select is_definer('public', 'gdpr_ban_on_erasure_request', array[]::text[],
  'the trigger function is SECURITY DEFINER — service_role holds no UPDATE on auth.users');
select ok(
  (select 'search_path=""' = any(p.proconfig)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'gdpr_ban_on_erasure_request'),
  'its search_path is locked to the empty string (proconfig holds search_path="")');
select ok(not has_function_privilege('anon', 'public.gdpr_ban_on_erasure_request()', 'execute'),
  '#409: anon cannot EXECUTE the trigger function');
select ok(not has_function_privilege('authenticated', 'public.gdpr_ban_on_erasure_request()', 'execute'),
  '#409: authenticated cannot EXECUTE the trigger function');

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

-- ── 2. the same ban moderation-enforce writes, and never shorter ────────────────────────────
select ok(
  (select banned_until between now() + interval '876000 hours' - interval '1 minute'
                            and now() + interval '876000 hours' + interval '1 minute'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'the value is BAN_FOREVER, 876000h, the same figure moderation-enforce sends as ban_duration');

update auth.users set banned_until = now() + interval '2000000 hours'
 where id = '73300000-0000-0000-0000-0000000000bb';
set local role authenticated;
set local request.jwt.claims = '{"sub":"73300000-0000-0000-0000-0000000000bb","role":"authenticated"}';
insert into public.gdpr_erasure_requests (profile_id)
values ('73300000-0000-0000-0000-0000000000bb');
reset role;
select ok(
  (select banned_until > now() + interval '1999999 hours'
   from auth.users where id = '73300000-0000-0000-0000-0000000000bb'),
  'a longer ban already in place is kept — GREATEST, never shortened by the request');

-- ── 4. a second request cannot move the clock back ──────────────────────────────────────────
update auth.users set banned_until = now() + interval '876000 hours' + interval '5 days'
 where id = '73300000-0000-0000-0000-0000000000aa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"73300000-0000-0000-0000-0000000000aa","role":"authenticated"}';
select throws_ok(
  $$ insert into public.gdpr_erasure_requests (profile_id)
     values ('73300000-0000-0000-0000-0000000000aa') $$,
  '23505',
  null,
  'a second open request is rejected by gdpr_erasure_requests_one_open_per_profile');
reset role;
select ok(
  (select banned_until > now() + interval '876000 hours' + interval '4 days'
   from auth.users where id = '73300000-0000-0000-0000-0000000000aa'),
  'the rejected insert did not fire the trigger — banned_until untouched');

-- ── control: a request by a member with no ban is the only path that sets one ───────────────
select is(
  (select count(*)::int from auth.users
    where id in ('73300000-0000-0000-0000-0000000000aa', '73300000-0000-0000-0000-0000000000bb')
      and banned_until is not null),
  2, 'both fixture members are banned; nothing else in this file wrote auth.users');
select is(
  (select count(*)::int from public.gdpr_erasure_requests
    where profile_id in ('73300000-0000-0000-0000-0000000000aa', '73300000-0000-0000-0000-0000000000bb')),
  2, 'exactly the two requests exist');

select * from finish();
rollback;
