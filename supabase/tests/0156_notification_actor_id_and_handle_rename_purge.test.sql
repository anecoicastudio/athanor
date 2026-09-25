-- 0156_notification_actor_id_and_handle_rename_purge.test.sql
-- Issue #800 (20260925124457) — a renamed handle stops living on by value.
--
-- Asserts:
--   (A) each of the SIX producers that name an actor — the five athanor.notify_* functions and
--       public.on_momento_proposal_push — writes that actor's profile id as params.actor_id,
--       beside the `name` push still renders from. Read off the outbox payload
--       (athanor.notification_dispatches), which 0133 pins as byte-identical to the body POSTed
--       to notification-fan-out, which in turn writes it verbatim as notifications.params.
--       Driven through the real write paths, as 0065 and 0093 do.
--   (B) the rename purge: a trigger on profiles that posts the OLD handle, and only the old
--       handle, to handle-rename-purge on a change FROM a handle — never on the first choice,
--       never on an update that leaves the handle alone. Security posture as every trigger fn.
--
-- Not asserted here: the "old row still parses" half of the ruling. params is jsonb and rows
-- written before this migration are untouched by it, so the property lives where it can fail —
-- packages/schemas notification.test.ts and packages/api notifications.test.ts.
--
-- Like 0133, net.http_request_queue is the in-txn witness: pg_net's worker never sees
-- uncommitted rows, so nothing leaves the database when this file runs. Every read is scoped to
-- this file's fixture uuids, because the outbox and the queue are live tables on a hosted project.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- txn-local GUCs: runtime_setting reads the GUC before Vault, and these roll back with the txn.
select set_config('app.settings.notification_fanout_url',
                  'http://fanout.invalid/functions/v1/notification-fan-out', true);
select set_config('app.settings.notification_fanout_key', 'sb_secret_pgtap_dummy_key', true);
select set_config('app.settings.handle_rename_purge_url',
                  'http://purge.invalid/functions/v1/handle-rename-purge', true);
select set_config('app.settings.handle_rename_purge_key', 'sb_secret_pgtap_dummy_key', true);

-- fixture: a = dream owner / momento recipient, b = helper / requester, c = addressee / candidate
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '80080000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'p800_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80080000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'p800_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80080000-0000-4000-8000-00000000000c',
   'authenticated', 'authenticated', 'p800_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select set_config('test.a', '80080000-0000-4000-8000-00000000000a', false);
select set_config('test.b', '80080000-0000-4000-8000-00000000000b', false);
select set_config('test.c', '80080000-0000-4000-8000-00000000000c', false);

-- First choice of handle (NULL → handle, #782). As postgres, so the cooldown passes untouched.
update public.profiles set handle = 'p800_owner'     where id = current_setting('test.a')::uuid;
update public.profiles set handle = 'p800_helper'    where id = current_setting('test.b')::uuid;
update public.profiles set handle = 'p800_addressee' where id = current_setting('test.c')::uuid;

-- (B0) the first choice purged nothing: there was no /@old to purge.
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge.invalid/functions/v1/handle-rename-purge'),
  0, 'choosing a first handle (NULL → handle) posts no purge');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (A) producers write actor_id beside name
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- The params of the one outbox row for (recipient, template).
create function pg_temp.p800_params(p_recipient text, p_tpl text) returns jsonb
language sql as $$
  select d.payload -> 'params' from athanor.notification_dispatches d
   where d.payload ->> 'recipient_id' = p_recipient
     and d.payload ->> 'template_key' = p_tpl
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"80080000-0000-4000-8000-00000000000a","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values (current_setting('test.a')::uuid, 'p800 dream');
insert into public.dream_milestones (dream_id, body)
  values ((select id from public.dreams where profile_id = current_setting('test.a')::uuid),
          'p800 tappa');
select set_config(
  'test.m_id',
  (select m.id::text from public.dream_milestones m
     join public.dreams d on d.id = m.dream_id
    where d.profile_id = current_setting('test.a')::uuid and m.body = 'p800 tappa'),
  false);

-- 1a. offer: b helps a → a is told, and the actor is b
set local request.jwt.claims = '{"sub":"80080000-0000-4000-8000-00000000000b","role":"authenticated"}';
insert into public.milestone_helps (milestone_id, helper_id, type)
  values (current_setting('test.m_id')::uuid, current_setting('test.b')::uuid, 'skill');
select set_config(
  'test.help_id',
  (select id::text from public.milestone_helps
    where milestone_id = current_setting('test.m_id')::uuid
      and helper_id = current_setting('test.b')::uuid),
  false);

-- 1b. request: b → c; c is told, and the actor is b
insert into public.connection_requests (requester_id, addressee_id)
  values (current_setting('test.b')::uuid, current_setting('test.c')::uuid);
select set_config(
  'test.req_id',
  (select id::text from public.connection_requests
    where requester_id = current_setting('test.b')::uuid
      and addressee_id = current_setting('test.c')::uuid),
  false);

-- 1c. accepted: c accepts; b is told, and the actor is c
set local request.jwt.claims = '{"sub":"80080000-0000-4000-8000-00000000000c","role":"authenticated"}';
select public.respond_to_connection(current_setting('test.req_id')::uuid, true);

-- 1d/1e. a accepts b's help, then confirms it; b is told both times, and the actor is a
set local request.jwt.claims = '{"sub":"80080000-0000-4000-8000-00000000000a","role":"authenticated"}';
update public.milestone_helps set status = 'accepted'
 where id = current_setting('test.help_id')::uuid;
select public.confirm_milestone_help(current_setting('test.help_id')::uuid);

-- 1f. momento proposal: matcher-only (service_role); a is told, and the actor is c
set local role service_role;
insert into public.momento_proposals (user_id, candidate_id)
  values (current_setting('test.a')::uuid, current_setting('test.c')::uuid);

reset role;

select is(pg_temp.p800_params(current_setting('test.a'), 'notif.tpl.dreamMilestone'),
  jsonb_build_object('name', 'p800_helper', 'actor_id', current_setting('test.b')),
  'help offer: params carry the helper''s id beside their handle');

select is(pg_temp.p800_params(current_setting('test.c'), 'notif.tpl.connection'),
  jsonb_build_object('name', 'p800_helper', 'actor_id', current_setting('test.b')),
  'connection request: params carry the requester''s id beside their handle');

select is(pg_temp.p800_params(current_setting('test.b'), 'notif.tpl.connectionAccepted'),
  jsonb_build_object('name', 'p800_addressee', 'actor_id', current_setting('test.c')),
  'connection accepted: params carry the addressee''s id beside their handle');

select is(pg_temp.p800_params(current_setting('test.b'), 'notif.tpl.helpAccepted'),
  jsonb_build_object('name', 'p800_owner', 'actor_id', current_setting('test.a')),
  'help accepted: params carry the dream owner''s id beside their handle');

select is(pg_temp.p800_params(current_setting('test.b'), 'notif.tpl.helpConfirmed'),
  jsonb_build_object('name', 'p800_owner', 'actor_id', current_setting('test.a')),
  'help confirmed: params carry the dream owner''s id beside their handle');

select is(pg_temp.p800_params(current_setting('test.a'), 'notif.tpl.moment'),
  jsonb_build_object('name', 'p800_addressee', 'actor_id', current_setting('test.c')),
  'momento proposal: params carry the candidate''s id beside their handle');

-- #637's routing survived the redefinition (0093 pins the same text; this is the runtime half).
select is(
  (select d.payload -> 'entity_ref' from athanor.notification_dispatches d
    where d.payload ->> 'recipient_id' = current_setting('test.b')
      and d.payload ->> 'template_key' = 'notif.tpl.helpAccepted'),
  jsonb_build_object('kind', 'profile', 'id', current_setting('test.a')),
  'help accepted still routes the helper to the dream owner''s profile');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (B) the rename purge
-- ─────────────────────────────────────────────────────────────────────────────────────────

select has_trigger('public', 'profiles', 'profiles_handle_rename_purge',
  'profiles carries the rename-purge trigger');

select is(
  (select p.prosecdef from pg_proc p
    where p.proname = 'enqueue_handle_rename_purge' and p.pronamespace = 'athanor'::regnamespace),
  true, 'enqueue_handle_rename_purge is SECURITY DEFINER (the renaming member cannot read Vault)');

select is_empty(
  $$ select r.role
       from (values ('anon'), ('authenticated'), ('public')) as r(role)
      where has_function_privilege(r.role, 'athanor.enqueue_handle_rename_purge()', 'execute') $$,
  'no client role can execute the rename-purge trigger function');

-- An update that leaves the handle alone posts nothing (the WHEN clause, not the body).
update public.profiles set display_name = 'P800 Owner' where id = current_setting('test.a')::uuid;
update public.profiles set handle = 'p800_owner' where id = current_setting('test.a')::uuid;

select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge.invalid/functions/v1/handle-rename-purge'),
  0, 'an update that does not change the handle posts no purge');

-- The member's own rename, through the member's own path: a PostgREST UPDATE as authenticated.
-- handle_changed_at is NULL after a first choice, so the cooldown lets it through.
set local role authenticated;
set local request.jwt.claims = '{"sub":"80080000-0000-4000-8000-00000000000a","role":"authenticated"}';
update public.profiles set handle = 'p800_renamed' where id = current_setting('test.a')::uuid;
reset role;

select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge.invalid/functions/v1/handle-rename-purge'),
  1, 'a member''s rename posts exactly one purge');

select is(
  (select convert_from(q.body, 'utf8')::jsonb from net.http_request_queue q
    where q.url = 'http://purge.invalid/functions/v1/handle-rename-purge'),
  '{"handle":"p800_owner"}'::jsonb,
  'the purge names the OLD handle and nothing else — no profile id, not the new handle');

-- rule 8: the key rides `apikey`, never Authorization (athanor.edge_auth_headers).
select is(
  (select q.headers ->> 'apikey' from net.http_request_queue q
    where q.url = 'http://purge.invalid/functions/v1/handle-rename-purge'),
  'sb_secret_pgtap_dummy_key',
  'the purge presents the key on the apikey header');

select is(
  (select q.headers ? 'Authorization' from net.http_request_queue q
    where q.url = 'http://purge.invalid/functions/v1/handle-rename-purge'),
  false, 'the purge sends no Authorization header');

select finish();
rollback;
