-- 0130_event_reminder_sweep.test.sql
-- Issue #126 — event reminders had every consumer and no producer. 20260823103624 adds
-- public.event_reminder_sweep() (pg_cron, every minute) plus athanor.event_reminder_sends,
-- the idempotency marker; 20260823110358 adds the online guard band and unconditional
-- retention; 20260825085916 gives the t1 slot its own copy (#523).
--
-- Asserts: catalog shape (cron-only function, marker table off the client grant surface,
-- schedule) · fan-out unconfigured → NOTHING is claimed, so no reminder is burned undelivered,
-- but 30-day-old markers are STILL pruned · a configured sweep enqueues one eventReminder per
-- going RSVP with the right body · a SECOND sweep enqueues nothing (the marker, not the
-- notification, is what dedupes) · the slots: t24 for every event, t1 for online only, and an
-- online event inside the 3h guard band claims NEITHER t24 nor (yet) t1 · cancelled RSVPs,
-- soft-deleted events and events beyond the window are all silent · «N partecipano» counts
-- going RSVPs at send time.
--
-- pg_net's worker never sees uncommitted queue rows, so net.http_request_queue is a safe
-- in-txn witness of the exact enqueued payload (0064 K, 0094 D).
--
-- Every assertion is scoped to this file's own fixture ids ('e1300000-%') rather than to
-- whole-table counts. That is not tidiness: an unscoped count passes only on an empty
-- database, so it would go red the moment any other fixture — or a hosted project's seeded
-- world — held an event inside a reminder window.
--
-- Test 9 is the one assertion that CANNOT hold outside CI. It needs fan-out to be genuinely
-- unconfigured, and athanor.runtime_setting falls back to Vault, which every hosted project
-- has and no CI stack does. Running this file against staging as a smoke will therefore fail
-- test 9 and only test 9; that is the environment differing, not the sweep.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- ── fixtures: an organizer and three attendees (handle_new_user auto-creates profiles) ────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000130',
   'authenticated','authenticated','organizer130@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaa1111-0000-0000-0000-000000000130',
   'authenticated','authenticated','attendee130a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb1111-0000-0000-0000-000000000130',
   'authenticated','authenticated','attendee130b@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccc1111-0000-0000-0000-000000000130',
   'authenticated','authenticated','attendee130c@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (A) catalog shape — cron-only, and the marker is unreachable from any client
-- ─────────────────────────────────────────────────────────────────────────────────────────

select has_function('public', 'event_reminder_sweep', array[]::text[],
  'public.event_reminder_sweep() exists');

select ok(not has_function_privilege('anon', 'public.event_reminder_sweep()', 'execute'),
  'anon cannot execute the reminder sweep');

select ok(not has_function_privilege('authenticated', 'public.event_reminder_sweep()', 'execute'),
  'authenticated cannot execute the reminder sweep');

select has_table('athanor', 'event_reminder_sends',
  'athanor.event_reminder_sends exists (the marker lives off the client grant surface)');

select is(
  (select c.relrowsecurity from pg_class c
     where c.oid = 'athanor.event_reminder_sends'::regclass),
  true, 'the marker table has RLS enabled (deny-all: it carries no policies)');

-- The whole reason the marker is not a column on rsvps (#446's defect one table over):
-- rsvps holds table-level UPDATE with no column ACL, so a marker there is owner-forgeable.
select is_empty(
  $$ select r.role || ' / ' || pv.priv
       from (values ('anon'), ('authenticated')) as r(role)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pv(priv)
      where has_table_privilege(r.role, 'athanor.event_reminder_sends', pv.priv) $$,
  'no client role holds any privilege on the marker table');

select results_eq(
  $$ select schedule from cron.job where jobname = 'event-reminder-sweep' $$,
  $$ values ('* * * * *') $$,
  'event-reminder-sweep runs every minute');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- fixtures: six events, each probing one branch of the window logic
-- ─────────────────────────────────────────────────────────────────────────────────────────

insert into public.events (id, organizer_id, title, category, is_online, venue, city, geo, starts_at) values
  -- E1: physical, 5h out → t24 for every going RSVP (physical events never get a t1)
  ('e1300000-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000130',
   'Cerchio in presenza','networking',false,'Sala','Milano',
   extensions.st_point(9.19, 45.46)::extensions.geography, now() + interval '5 hours');

insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at) values
  -- E2: online, 30m out → t1 ONLY. The t24 floor is what stops a late RSVP getting both.
  ('e1300000-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000130',
   'Diretta imminente','formazione',true,'https://stream.athanor.test/130-2', now() + interval '30 minutes'),
  -- E3: online, 30h out → outside every window, silent
  ('e1300000-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000130',
   'Troppo presto','formazione',true,'https://stream.athanor.test/130-3', now() + interval '30 hours'),
  -- E5: online, 2h out → inside the guard band: NO t24 (floor is 3h) and not yet t1 (lead 1h).
  --     This is the boundary that used to yield two identical reminders a minute apart.
  ('e1300000-0000-0000-0000-000000000005','11111111-0000-0000-0000-000000000130',
   'Nella banda di guardia','formazione',true,'https://stream.athanor.test/130-5', now() + interval '2 hours'),
  -- E6: online, 5h out → t24 now; t1 later (≥2h apart by construction)
  ('e1300000-0000-0000-0000-000000000006','11111111-0000-0000-0000-000000000130',
   'Diretta stasera','formazione',true,'https://stream.athanor.test/130-6', now() + interval '5 hours');

insert into public.events (id, organizer_id, title, category, is_online, venue, city, geo, starts_at, deleted_at) values
  -- E4: physical, 5h out, soft-deleted → silent
  ('e1300000-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000130',
   'Annullato','musica',false,'Teatro','Roma',
   extensions.st_point(12.49, 41.90)::extensions.geography, now() + interval '5 hours', now());

insert into public.rsvps (event_id, user_id, status) values
  -- E1: two going, one cancelled → two reminders, and «2 partecipano»
  ('e1300000-0000-0000-0000-000000000001','aaaa1111-0000-0000-0000-000000000130','going'),
  ('e1300000-0000-0000-0000-000000000001','bbbb1111-0000-0000-0000-000000000130','going'),
  ('e1300000-0000-0000-0000-000000000001','cccc1111-0000-0000-0000-000000000130','cancelled'),
  ('e1300000-0000-0000-0000-000000000002','aaaa1111-0000-0000-0000-000000000130','going'),
  ('e1300000-0000-0000-0000-000000000003','aaaa1111-0000-0000-0000-000000000130','going'),
  ('e1300000-0000-0000-0000-000000000004','aaaa1111-0000-0000-0000-000000000130','going'),
  ('e1300000-0000-0000-0000-000000000005','bbbb1111-0000-0000-0000-000000000130','going'),
  ('e1300000-0000-0000-0000-000000000006','bbbb1111-0000-0000-0000-000000000130','going');

-- A stale marker from a past life of E1, planted before any sweep: retention must reap it
-- whether or not fan-out is configured (20260823110358 §2).
insert into athanor.event_reminder_sends (event_id, user_id, slot, sent_at) values
  ('e1300000-0000-0000-0000-000000000001','cccc1111-0000-0000-0000-000000000130','t1',
   now() - interval '31 days');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (B) fan-out unconfigured → claim NOTHING. The point of the early return: burning a marker
--     against a no-op enqueue would spend each attendee's one reminder and deliver silence.
-- ─────────────────────────────────────────────────────────────────────────────────────────

select lives_ok(
  $$ select public.event_reminder_sweep() $$,
  'the sweep runs clean with fan-out unconfigured');

select is(
  (select count(*)::int from athanor.event_reminder_sends
    where event_id::text like 'e1300000-%' and sent_at > now() - interval '1 day'),
  0, 'an unconfigured sweep claims no marker (no reminder is burned undelivered)');

-- …but retention is not gated on delivery: the 31-day-old marker is gone.
select is(
  (select count(*)::int from athanor.event_reminder_sends
    where event_id = 'e1300000-0000-0000-0000-000000000001'
      and user_id  = 'cccc1111-0000-0000-0000-000000000130'),
  0, 'an unconfigured sweep still prunes 30-day-old markers (retention runs before the guard)');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (C) configured → one enqueue per going RSVP inside a window
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- txn-local GUCs: runtime_setting reads the GUC before Vault, and these roll back with the txn.
select set_config('app.settings.notification_fanout_url',
                  'http://fanout.invalid/functions/v1/notification-fan-out', true);
select set_config('app.settings.notification_fanout_key', 'sb_secret_pgtap_dummy_key', true);

select public.event_reminder_sweep();

select bag_eq(
  $$ select event_id::text || '/' || user_id::text || '/' || slot
       from athanor.event_reminder_sends where event_id::text like 'e1300000-%' $$,
  $$ values ('e1300000-0000-0000-0000-000000000001/aaaa1111-0000-0000-0000-000000000130/t24'::text),
            ('e1300000-0000-0000-0000-000000000001/bbbb1111-0000-0000-0000-000000000130/t24'),
            ('e1300000-0000-0000-0000-000000000002/aaaa1111-0000-0000-0000-000000000130/t1'),
            ('e1300000-0000-0000-0000-000000000006/bbbb1111-0000-0000-0000-000000000130/t24') $$,
  'exactly four markers: t24 per going RSVP on the physical event, t1 on the imminent stream, t24 on the 5h stream');

-- The guard band: an online event 2h out is past the t24 floor (3h) and short of the t1 lead
-- (1h). It claims nothing on this tick; its t1 will fire at 1h. Before 20260823110358 this
-- window claimed t24, and an event 1h+30s out then claimed t1 on the NEXT tick.
select is(
  (select count(*)::int from athanor.event_reminder_sends
    where event_id = 'e1300000-0000-0000-0000-000000000005'),
  0, 'an online event inside the 3h guard band claims neither slot (no two reminders a minute apart)');

-- E2 is 30 minutes out, so it satisfies the 24h window too — the floor is what keeps it to one.
select is(
  (select count(*)::int from athanor.event_reminder_sends
    where event_id = 'e1300000-0000-0000-0000-000000000002' and slot = 't24'),
  0, 'an online event inside the t1 lead does NOT also claim t24 (no double reminder)');

select is(
  (select count(*)::int from athanor.event_reminder_sends
    where user_id = 'cccc1111-0000-0000-0000-000000000130'),
  0, 'a cancelled RSVP is never reminded');

select is(
  (select count(*)::int from athanor.event_reminder_sends
    where event_id in ('e1300000-0000-0000-0000-000000000003',
                       'e1300000-0000-0000-0000-000000000004')),
  0, 'an event beyond the window and a soft-deleted event are both silent');

-- ── the queue witness: what fan-out actually receives ────────────────────────────────────

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'eventReminder'
      and convert_from(q.body, 'utf8')::jsonb #>> '{entity_ref,id}' like 'e1300000-%'),
  4, 'four eventReminder bodies were enqueued, one per claimed marker');

select is(
  (select convert_from(q.body, 'utf8')::jsonb -> 'entity_ref'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'eventReminder'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id'
          = 'aaaa1111-0000-0000-0000-000000000130'
      and convert_from(q.body, 'utf8')::jsonb #>> '{params,title}' = 'Diretta imminente'),
  '{"kind": "event", "id": "e1300000-0000-0000-0000-000000000002"}'::jsonb,
  'entity_ref carries the event id the route arm reads (lib/notification-route.ts)');

-- Per SLOT, not `limit 1` (#523): the two reminders carry different copy now, and a single
-- unfiltered row would have gone on passing whichever key it happened to draw. t24 keeps
-- «è tra poco»; t1 says the hour. Both keys are rendered by _shared/notif-templates.ts and
-- both are in packages/schemas' closed NOTIFICATION_TEMPLATE_KEYS — a key missing from that
-- list degrades to notif.tpl.generic in the in-app list (#113).
select bag_eq(
  $$ select (convert_from(q.body, 'utf8')::jsonb #>> '{entity_ref,id}') || ' → ' ||
            (convert_from(q.body, 'utf8')::jsonb ->> 'template_key')
       from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'eventReminder'
        and convert_from(q.body, 'utf8')::jsonb #>> '{entity_ref,id}' like 'e1300000-%' $$,
  $$ values ('e1300000-0000-0000-0000-000000000001 → notif.tpl.eventReminder'::text),
            ('e1300000-0000-0000-0000-000000000001 → notif.tpl.eventReminder'),
            ('e1300000-0000-0000-0000-000000000002 → notif.tpl.eventReminderSoon'),
            ('e1300000-0000-0000-0000-000000000006 → notif.tpl.eventReminder') $$,
  'each slot enqueues its own template_key: t24 the neutral copy, t1 the one that says the hour');

-- «N partecipano» counts going RSVPs only — the cancelled third seat must not inflate it.
select is(
  (select distinct convert_from(q.body, 'utf8')::jsonb #>> '{params,count}'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'eventReminder'
      and convert_from(q.body, 'utf8')::jsonb #>> '{params,title}' = 'Cerchio in presenza'),
  '2', 'the count is going RSVPs at send time (the cancelled RSVP is not counted)');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (D) the whole point: a second sweep on the same minute enqueues nothing
-- ─────────────────────────────────────────────────────────────────────────────────────────

select public.event_reminder_sweep();

select is(
  (select count(*)::int from athanor.event_reminder_sends where event_id::text like 'e1300000-%'),
  4, 'a second sweep claims no new marker (the ON CONFLICT claim is the dedupe)');

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'eventReminder'
      and convert_from(q.body, 'utf8')::jsonb #>> '{entity_ref,id}' like 'e1300000-%'),
  4, 'a second sweep enqueues nothing — two sweeps remind once');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (E) rule 1: reminding somebody is worth zero Aura
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Deliberately unfiltered by type: `where type = 'eventReminder'` would pass for the trivial
-- reason that no such aura type exists. What has to hold is that reminding somebody wrote
-- NOTHING to the ledger (0094 F asserts the same shape for the star sweep).
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('aaaa1111-0000-0000-0000-000000000130',
                         'bbbb1111-0000-0000-0000-000000000130')),
  0, 'the reminder writes no aura_events row (rule 1 — the sweep never touches the ledger)');

select * from finish();
rollback;
