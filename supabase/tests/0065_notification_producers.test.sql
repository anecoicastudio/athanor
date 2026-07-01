-- M9 notification-fan-out DB producers (task A2, docs/superpowers/T0-parallel-tasks.md) —
-- asserts: the 3 new triggers exist · their fn bodies are SECURITY DEFINER ·
-- athanor.enqueue_notification exists and is revoked from clients (42501 on direct call) ·
-- every wired producer body (milestone_helps offer, connection_requests insert + accept,
-- momento_proposals insert — the last consolidated onto enqueue_notification, no longer a bare
-- public.enqueue_push call) runs clean with app.settings.notification_fanout_url/_key unset
-- (guarded no-op) · rule "fan-out is the sole writer" holds: zero notifications rows land for
-- this fixture since the no-op returns before any net.http_post is ever issued.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- fixture: three profiles (auto-created by handle_new_user) — a = dream owner / momento
-- recipient, b = helper / connection requester, c = connection addressee / momento candidate.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'notif_producer_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88888888-8888-8888-8888-888888888888',
   'authenticated', 'authenticated', 'notif_producer_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999999',
   'authenticated', 'authenticated', 'notif_producer_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select set_config('test.a', '77777777-7777-7777-7777-777777777777', false);
select set_config('test.b', '88888888-8888-8888-8888-888888888888', false);
select set_config('test.c', '99999999-9999-9999-9999-999999999999', false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

insert into public.dreams (profile_id, text)
  values (current_setting('test.a')::uuid, 'notif producer sanity dream');

insert into public.dream_milestones (dream_id, body)
  values ((select id from public.dreams where profile_id = current_setting('test.a')::uuid), 'tappa notif sanity');

select set_config(
  'test.m_id',
  (select m.id::text from public.dream_milestones m
     join public.dreams d on d.id = m.dream_id
    where d.profile_id = current_setting('test.a')::uuid and m.body = 'tappa notif sanity'),
  false);

-- (A) the 3 new triggers exist
select has_trigger('public'::name, 'milestone_helps'::name, 'milestone_helps_notify_offer'::name);
select has_trigger('public'::name, 'connection_requests'::name, 'connection_requests_notify_insert'::name);
select has_trigger('public'::name, 'connection_requests'::name, 'connection_requests_notify_accepted'::name);

-- (B) the 3 new trigger fns are SECURITY DEFINER (must run as owner to reach the guarded enqueue)
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'notify_milestone_help_offer' and p.pronamespace = 'athanor'::regnamespace),
  true, 'notify_milestone_help_offer is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'notify_connection_request' and p.pronamespace = 'athanor'::regnamespace),
  true, 'notify_connection_request is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'notify_connection_accepted' and p.pronamespace = 'athanor'::regnamespace),
  true, 'notify_connection_accepted is SECURITY DEFINER');

-- (C) athanor.enqueue_notification exists and is revoked from clients (defense in depth — a
-- direct call bypassing the trigger path must 42501, mirroring enqueue_push/enqueue_score_award).
select has_function('athanor', 'enqueue_notification',
  array['uuid', 'text', 'text', 'jsonb', 'jsonb'],
  'athanor.enqueue_notification(uuid,text,text,jsonb,jsonb) exists');

select throws_ok(
  $$ select athanor.enqueue_notification(
       current_setting('test.a')::uuid, 'moment', 'notif.tpl.moment', '{}'::jsonb, null) $$,
  '42501', null, 'authenticated cannot call athanor.enqueue_notification directly (execute revoked)');

-- (D) no-op-clean: each wired producer body runs without error while the fan-out GUCs are unset.
set local role authenticated;
set local request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';
select lives_ok(
  $$ insert into public.milestone_helps (milestone_id, helper_id, type)
     values (current_setting('test.m_id')::uuid, current_setting('test.b')::uuid, 'skill') $$,
  'milestone_helps offer insert runs clean (no-op enqueue, exercises owner join)');

select lives_ok(
  $$ insert into public.connection_requests (requester_id, addressee_id)
     values (current_setting('test.b')::uuid, current_setting('test.c')::uuid) $$,
  'connection_requests insert runs clean (no-op enqueue)');

select set_config(
  'test.req_id',
  (select id::text from public.connection_requests
     where requester_id = current_setting('test.b')::uuid and addressee_id = current_setting('test.c')::uuid),
  false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
select lives_ok(
  $$ select public.respond_to_connection(current_setting('test.req_id')::uuid, true) $$,
  'respond_to_connection accept runs clean (no-op enqueue, exercises connection-accepted trigger)');

-- momento_proposals is matcher-only (no INSERT grant to authenticated) — service_role seeds it,
-- exercising the CONSOLIDATED on_momento_proposal_push body (now athanor.enqueue_notification
-- instead of a bare public.enqueue_push call — see migration header).
set local role service_role;
select lives_ok(
  $$ insert into public.momento_proposals (user_id, candidate_id)
     values (current_setting('test.a')::uuid, current_setting('test.c')::uuid) $$,
  'momento_proposals insert runs clean (consolidated on_momento_proposal_push -> enqueue_notification, no-op)');

-- (E) with fan-out unconfigured, enqueue_notification returns before any net.http_post is
-- issued, so no fan-out invocation ever happens → notifications (written only by the edge fn
-- on receipt) stays empty for this fixture's 3 profiles.
select is(
  (select count(*)::int from public.notifications
     where recipient_id in (
       current_setting('test.a')::uuid,
       current_setting('test.b')::uuid,
       current_setting('test.c')::uuid
     )),
  0, 'all 4 producer bodies ran with fan-out unconfigured and wrote zero notifications (guarded no-op)');

reset role;

select finish();
rollback;
