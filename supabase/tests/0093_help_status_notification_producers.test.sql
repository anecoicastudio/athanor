-- milestone_helps status producers (#125, 20260813062922) — asserts: the 2 new triggers
-- exist · their fns are SECURITY DEFINER (must run as owner to reach the guarded enqueue) ·
-- both transitions run clean through their REAL paths (accept = owner client UPDATE under
-- RLS + guard; complete = public.confirm_milestone_help RPC) while the fan-out URL/key are
-- unresolved (guarded no-op) · zero notifications rows land (fan-out edge fn stays the sole
-- writer; the no-op returns before any net.http_post).
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- fixture: a = dream owner, b = helper (auto-created profiles via handle_new_user)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'help_notif_owner@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'help_notif_helper@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select set_config('test.owner', 'aaaaaaaa-1111-4111-8111-111111111111', false);
select set_config('test.helper', 'bbbbbbbb-2222-4222-8222-222222222222', false);

-- (A) the 2 new triggers exist
select has_trigger('public'::name, 'milestone_helps'::name, 'milestone_helps_notify_accepted'::name);
select has_trigger('public'::name, 'milestone_helps'::name, 'milestone_helps_notify_completed'::name);

-- (B) both trigger fns are SECURITY DEFINER
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'notify_milestone_help_accepted' and p.pronamespace = 'athanor'::regnamespace),
  true, 'notify_milestone_help_accepted is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'notify_milestone_help_completed' and p.pronamespace = 'athanor'::regnamespace),
  true, 'notify_milestone_help_completed is SECURITY DEFINER');

-- (B2) #637: the two HELPER-directed producers carry a routable ref — the owner's profile id —
-- while the OWNER-directed offer keeps the milestone_help ref it always had.
--
-- Asserted on prosrc rather than on a written row, and that is forced rather than lazy: the whole
-- point of (D) below is that the fan-out is an unresolved no-op here, so no notification row ever
-- lands to read an entity_ref off. The producers' own text is the only thing this file can see.
-- (strpos, not LIKE: backslash is LIKE's escape character and these patterns are quote-dense.)
select ok(
  strpos((select prosrc from pg_proc
           where proname = 'notify_milestone_help_accepted'
             and pronamespace = 'athanor'::regnamespace), $x$'kind', 'profile'$x$) > 0,
  'helpAccepted routes the helper to the dream OWNER''s profile, not to their own (#637)');
select ok(
  strpos((select prosrc from pg_proc
           where proname = 'notify_milestone_help_completed'
             and pronamespace = 'athanor'::regnamespace), $x$'kind', 'profile'$x$) > 0,
  'helpConfirmed routes the helper to the dream OWNER''s profile, not to their own (#637)');
-- The asymmetry is the interesting half: the OFFER notifies the owner, and (tabs)/profile — their
-- own dream, its tappe and the offers they accept from — is already the right place. If someone
-- later "makes the three consistent", this is the assertion that should stop them.
select ok(
  strpos((select prosrc from pg_proc
           where proname = 'notify_milestone_help_offer'
             and pronamespace = 'athanor'::regnamespace), $x$'kind', 'milestone_help'$x$) > 0,
  'the owner-directed offer deliberately keeps the milestone_help ref');

-- (C) no-op-clean through the real paths
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.dreams (profile_id, text)
  values (current_setting('test.owner')::uuid, 'help notif producer dream');
insert into public.dream_milestones (dream_id, body)
  values ((select id from public.dreams where profile_id = current_setting('test.owner')::uuid),
          'tappa help notif');
select set_config(
  'test.m_id',
  (select m.id::text from public.dream_milestones m
     join public.dreams d on d.id = m.dream_id
    where d.profile_id = current_setting('test.owner')::uuid and m.body = 'tappa help notif'),
  false);

set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-4222-8222-222222222222","role":"authenticated"}';
insert into public.milestone_helps (milestone_id, helper_id, type)
  values (current_setting('test.m_id')::uuid, current_setting('test.helper')::uuid, 'skill');
select set_config(
  'test.help_id',
  (select id::text from public.milestone_helps
    where milestone_id = current_setting('test.m_id')::uuid
      and helper_id = current_setting('test.helper')::uuid),
  false);

-- accept: the owner's plain client UPDATE (milestone_helps_update_owner + guard legal edge)
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ update public.milestone_helps set status = 'accepted'
      where id = current_setting('test.help_id')::uuid $$,
  'offered->accepted runs clean (no-op enqueue, exercises owner-handle join)');

-- complete: the owner's confirm RPC (accepted->completed; also fires the aura trigger, itself
-- a guarded no-op here — see 0064)
select lives_ok(
  $$ select public.confirm_milestone_help(current_setting('test.help_id')::uuid) $$,
  'confirm_milestone_help runs clean (no-op enqueue on completed)');

-- (D) fan-out unresolved => enqueue returned before net.http_post; nothing wrote notifications
select is(
  (select count(*)::int from public.notifications
     where recipient_id in (
       current_setting('test.owner')::uuid,
       current_setting('test.helper')::uuid
     )),
  0, 'both producers ran with fan-out unresolved and wrote zero notifications (guarded no-op)');

reset role;

select finish();
rollback;
