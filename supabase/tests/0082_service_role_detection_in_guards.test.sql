-- milestone_helps_guard / favor_offers_guard detect the service path by ROLE.
--
-- Both guards opened with `(select auth.role()) = 'service_role'`, which reads a request-scoped
-- JWT claim. 20260809032504 switches them to `current_user`, the role PostgREST actually
-- SET LOCAL ROLEs to. That is a hardening, not a repair: measured over the local REST path, a
-- `sb_secret_…` caller arrives carrying `{"role":"service_role"}`, so both forms agreed. The
-- point is that current_user is a session property rather than a parsed request value.
--
-- What this file pins is the BEHAVIOUR either form has to produce, so the swap cannot have
-- changed it: service_role may do what a member may not, a member is restricted exactly as
-- before, and postgres is not the service role. The last one matters because it is the failure
-- mode of the obvious wrong fix — pg_has_role('postgres','service_role','MEMBER') is true, so
-- a pg_has_role check would hand the bypass to postgres and quietly loosen 0081.
--
-- Side effect worth naming: the service-role bypass is now TESTABLE here at all. pgTAP sets a
-- role but no claims, so under auth.role() the bypass could never fire in this context — the
-- assertions below would have been asserting the opposite of production. Under current_user
-- the test context and the request path agree, which is why restoring the old form fails
-- assertions 12-14.
begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- ── the guards no longer read a claim that the new keys do not carry ─────────
select is_empty(
  $$ select p.proname::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('milestone_helps_guard', 'favor_offers_guard')
        and p.prosrc like '%auth.role()%' $$,
  'neither guard reads auth.role() any more'
);

-- Matched on the comparison, not on the bare identifier: `prosrc like '%current_user%'` would
-- be satisfied by a comment mentioning it.
select is_empty(
  $$ select p.proname::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('milestone_helps_guard', 'favor_offers_guard')
        and p.prosrc not like '%current_user = ''service_role''%' $$,
  'both guards compare current_user against service_role'
);

-- A locked search_path is what makes the unqualified current_user safe to rely on.
select is_empty(
  $$ select p.proname::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('milestone_helps_guard', 'favor_offers_guard')
        and 'search_path=""' <> all(coalesce(p.proconfig, array[]::text[])) $$,
  'both guards keep a locked (empty) search_path'
);

-- SECURITY INVOKER matters: under DEFINER, current_user would be the owner, and every caller
-- would look like the service role.
select is_empty(
  $$ select p.proname::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('milestone_helps_guard', 'favor_offers_guard')
        and p.prosecdef $$,
  'both guards stay SECURITY INVOKER, so current_user is the caller'
);

-- create-or-replace must not have detached the triggers.
select has_trigger('public', 'milestone_helps', 'milestone_helps_guard',
  'milestone_helps guard trigger intact');
select has_trigger('public', 'favor_offers', 'favor_offers_guard',
  'favor_offers guard trigger intact');

-- ── fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'guard_owner@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'guard_helper@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

insert into public.dreams (id, profile_id, text, status)
values ('dddddddd-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
        'Aprire uno studio di ceramica', 'active');

insert into public.dream_milestones (id, dream_id, body, status, position)
values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'dddddddd-0000-0000-0000-0000000000d1',
        'Trovare il forno', 'open', 1);

insert into public.milestone_helps (id, milestone_id, helper_id, type, message, status)
values ('bbbbbbbb-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000a1',
        '22222222-2222-2222-2222-222222222222', 'skill', 'Ne ho uno', 'offered');

insert into public.favor_offers (id, actor_id, target_id, need)
values ('cccccccc-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'Un contatto in fonderia');

-- ── the member path is unchanged ─────────────────────────────────────────────
-- Everything here held before this migration too; it is asserted so the fix cannot have
-- loosened the client-facing rules while fixing the service one.
select throws_ok(
  $$ update public.milestone_helps set helper_id = '11111111-1111-1111-1111-111111111111'
       where id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  '42501', null, 'a non-service caller still cannot re-point a help at another helper'
);

select throws_ok(
  $$ update public.milestone_helps set status = 'completed'
       where id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  '23514', null, 'a non-service caller still cannot skip offered -> accepted -> completed'
);

select lives_ok(
  $$ update public.milestone_helps set status = 'accepted'
       where id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  'the legal offered -> accepted transition still succeeds'
);

-- Pins the "backwards" half of the rule, which the service-role assertion below relies on.
select throws_ok(
  $$ update public.milestone_helps set status = 'offered'
       where id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  '23514', null, 'a non-service caller cannot walk a help backwards to offered'
);

select throws_ok(
  $$ update public.favor_offers set target_id = '22222222-2222-2222-2222-222222222222'
       where id = 'cccccccc-0000-0000-0000-0000000000c1' $$,
  '42501', null, 'a non-service caller still cannot re-target a favor'
);

-- ── the service path is now actually detected ────────────────────────────────
-- THIS is the regression the migration fixes. Under auth.role() these three raised, because a
-- secret-key caller has no JWT claims and the bypass silently never fired.
set local role service_role;

-- Deliberately a BACKWARDS transition: accepted -> offered is illegal for a member (asserted
-- below), so this passes only if the bypass actually fires. Asserting accepted -> completed
-- here would prove nothing — that transition is legal for members too.
select lives_ok(
  $$ update public.milestone_helps set status = 'offered'
       where id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  'service_role may make a transition the guard forbids members (unrestricted engine path)'
);

select lives_ok(
  $$ update public.milestone_helps set message = 'redacted'
       where id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  'service_role may edit a column the guard locks down for members'
);

select lives_ok(
  $$ update public.favor_offers set need = 'redacted'
       where id = 'cccccccc-0000-0000-0000-0000000000c1' $$,
  'service_role may edit a locked-down favor column'
);

reset role;

-- postgres is deliberately NOT the service role: it was restricted before (auth.role() was
-- NULL for it too) and stays restricted, which the other pgTAP suites rely on.
select throws_ok(
  $$ update public.favor_offers set actor_id = '11111111-1111-1111-1111-111111111111'
       where id = 'cccccccc-0000-0000-0000-0000000000c1' $$,
  '42501', null, 'postgres is still restricted — the bypass is service_role only'
);

select * from finish();
rollback;
