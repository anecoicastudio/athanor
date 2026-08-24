-- 0133_notification_dispatch_outbox.test.sql
-- Issue #521 — athanor.enqueue_notification was fire-and-forget: it `perform`ed net.http_post,
-- threw the request id away, and returned before any response existed. A fan-out 5xx therefore
-- wrote no notification row and left no trace, while the producer's marker (event_reminder_sends)
-- had already been claimed. 20260824070529 adds athanor.notification_dispatches (the outbox) and
-- athanor.notification_dispatch_reconcile() (the cron sweep that reads net._http_response).
--
-- Asserts: catalog shape (outbox off the client grant surface, cron-only function, schedule) ·
-- both producers record the exact body they POSTed · enqueue_notification mints a FRESH
-- dedupe_key per call, so two identical notifications stay two rows while a retry of one stays
-- one · a 2xx retires the outbox row and re-POSTs nothing · a 5xx past the grace window is
-- re-POSTed with the IDENTICAL payload (same dedupe_key — that is what makes the retry
-- exactly-once) · a response that has vanished is treated as a failure · a request still inside
-- the grace window is left alone · the retry budget ends in abandoned_at rather than in silence ·
-- a 400 is abandoned on sight, because the same body would be rejected the same way, while
-- every other 4xx is the platform (a key mid-rotation, a function not yet deployed) and takes
-- the full retry budget · abandoned rows are reaped after 30 days.
--
-- net._http_response is an ordinary unlogged table owned by supabase_admin that `postgres` can
-- read and write, so a response can be planted in-txn. Its ids here are deliberately far above
-- anything pg_net will have issued, so the sweep's own re-POSTs cannot collide with a fixture.
--
-- Like 0130, net.http_request_queue is the in-txn witness of what was actually POSTed: pg_net's
-- worker never sees uncommitted rows, so nothing leaves the database when this file runs.
--
-- Every assertion is scoped to this file's own fixtures (template_key 'notif.tpl.pgtap0133', or
-- the 9133xxxx recipient uuids) rather than to whole-table counts — the outbox is a live table on
-- a hosted project, and an unscoped count would pass only on an empty database. The sweep itself
-- is NOT scoped: it runs over everything, which is exactly why the fixtures have to be.
--
-- NOT asserted here: the "fan-out unconfigured → no-op" branch. athanor.runtime_setting falls
-- back to Vault, which every hosted project has and no CI stack does, so an unconfigured
-- assertion is only true in CI — 0130's test 9 already carries that caveat for one file, and one
-- is enough. The guard is the same three lines as every sibling producer's.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (A) catalog shape — the outbox is unreachable from any client, the sweep is cron-only
-- ─────────────────────────────────────────────────────────────────────────────────────────

select has_table('athanor', 'notification_dispatches',
  'athanor.notification_dispatches exists (the outbox lives off the client grant surface)');

select is(
  (select c.relrowsecurity from pg_class c
     where c.oid = 'athanor.notification_dispatches'::regclass),
  true, 'the outbox has RLS enabled (deny-all: it carries no policies)');

-- The payload holds a recipient id and rendered params. A client privilege here would publish
-- one member's notification body to another, before the notification itself is even written.
select is_empty(
  $$ select r.role || ' / ' || pv.priv
       from (values ('anon'), ('authenticated')) as r(role)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pv(priv)
      where has_table_privilege(r.role, 'athanor.notification_dispatches', pv.priv) $$,
  'no client role holds any privilege on the outbox');

select has_function('athanor', 'notification_dispatch_reconcile', array[]::text[],
  'athanor.notification_dispatch_reconcile() exists');

-- #409: a new function is born executable by PUBLIC, anon and authenticated. 0121's function
-- block covers `public` only, so an `athanor` function has to revoke for itself.
select is_empty(
  $$ select r.role
       from (values ('anon'), ('authenticated'), ('public')) as r(role)
      where has_function_privilege(r.role, 'athanor.notification_dispatch_reconcile()', 'execute') $$,
  'no client role can execute the reconciler');

select results_eq(
  $$ select schedule from cron.job where jobname = 'notification-dispatch-reconcile' $$,
  $$ values ('* * * * *') $$,
  'notification-dispatch-reconcile runs every minute');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (B) the producers record what they POST
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- txn-local GUCs: runtime_setting reads the GUC before Vault, and these roll back with the txn.
select set_config('app.settings.notification_fanout_url',
                  'http://fanout.invalid/functions/v1/notification-fan-out', true);
select set_config('app.settings.notification_fanout_key', 'sb_secret_pgtap_dummy_key', true);

select athanor.enqueue_notification(
  '91330000-0000-0000-0000-000000000001'::uuid,
  'moment', 'notif.tpl.pgtap0133',
  '{"name":"aurora"}'::jsonb,
  '{"kind":"moment","id":"m-133"}'::jsonb);

select is(
  (select count(*)::int from athanor.notification_dispatches
    where payload ->> 'template_key' = 'notif.tpl.pgtap0133'),
  1, 'enqueue_notification records exactly one outbox row for the POST it made');

-- The stored body must be the body on the wire, byte for byte: the retry replays the row, so a
-- payload that merely resembles the request would deliver something else the second time.
select is(
  (select d.payload from athanor.notification_dispatches d
    where d.payload ->> 'template_key' = 'notif.tpl.pgtap0133'),
  (select convert_from(q.body, 'utf8')::jsonb from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'template_key' = 'notif.tpl.pgtap0133'),
  'the stored payload is exactly what was POSTed');

select isnt(
  (select d.payload ->> 'dedupe_key' from athanor.notification_dispatches d
    where d.payload ->> 'template_key' = 'notif.tpl.pgtap0133'),
  null, 'the single-recipient producer mints a dedupe_key (it did not before #521)');

-- The property the minted key must NOT break. «Hai un Momento» twice is two Momenti: a key
-- derived from the arguments would have collapsed them, which is why it is minted per call.
select athanor.enqueue_notification(
  '91330000-0000-0000-0000-000000000001'::uuid,
  'moment', 'notif.tpl.pgtap0133',
  '{"name":"aurora"}'::jsonb,
  '{"kind":"moment","id":"m-133"}'::jsonb);

select is(
  (select count(distinct d.payload ->> 'dedupe_key')::int
     from athanor.notification_dispatches d
    where d.payload ->> 'template_key' = 'notif.tpl.pgtap0133'),
  2, 'two identical enqueues mint two different keys — two real events stay two rows');

select athanor.enqueue_audience_notification(
  'all_members', 'fundMilestone', 'notif.tpl.pgtap0133b',
  '{"pct":50}'::jsonb, '{"kind":"fund","id":"fe-133"}'::jsonb,
  'pgtap0133:fund:fe-133:milestone:50');

select is(
  (select d.payload ->> 'dedupe_key' from athanor.notification_dispatches d
    where d.payload ->> 'template_key' = 'notif.tpl.pgtap0133b'),
  'pgtap0133:fund:fe-133:milestone:50',
  'the broadcast producer records its row too, keeping the CALLER''s stable key');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (C) reconciliation
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Six dispatches, one per branch. request_id values are far above anything pg_net has issued,
-- and updated_at is planted rather than defaulted because the grace window is measured from it.
insert into athanor.notification_dispatches
  (id, request_id, payload, attempts, abandoned_at, created_at, updated_at)
values
  -- D1: delivered → retire the row
  ('d1330000-0000-0000-0000-000000000001', 913300000001,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000011',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-1'),
   1, null, now() - interval '10 minutes', now() - interval '10 minutes'),
  -- D2: 500 with attempts left → re-POST the identical body
  ('d1330000-0000-0000-0000-000000000002', 913300000002,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000012',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-2'),
   1, null, now() - interval '10 minutes', now() - interval '10 minutes'),
  -- D3: 500 with the budget spent → abandon, and say what the last status was
  ('d1330000-0000-0000-0000-000000000003', 913300000003,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000013',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-3'),
   3, null, now() - interval '10 minutes', now() - interval '10 minutes'),
  -- D4: 400 on the first attempt → the one deterministic rejection, abandon on sight
  ('d1330000-0000-0000-0000-000000000004', 913300000004,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000014',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-4'),
   1, null, now() - interval '10 minutes', now() - interval '10 minutes'),
  -- D5: NO response row at all (never answered, or pruned by pg_net's TTL) → treat as failure
  ('d1330000-0000-0000-0000-000000000005', 913300000005,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000015',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-5'),
   1, null, now() - interval '10 minutes', now() - interval '10 minutes'),
  -- D6: no response yet, but POSTed seconds ago → still in flight, leave it alone
  ('d1330000-0000-0000-0000-000000000006', 913300000006,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000016',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-6'),
   1, null, now(), now()),
  -- D9: 401 on the first attempt → the PLATFORM rejecting a key mid-rotation, not the body.
  --     Abandoning this class would drop every pending notification during the one outage the
  --     retry budget exists for.
  ('d1330000-0000-0000-0000-000000000009', 913300000009,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000019',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-9'),
   1, null, now() - interval '10 minutes', now() - interval '10 minutes'),
  -- D7: abandoned 31 days ago → reaped
  ('d1330000-0000-0000-0000-000000000007', 913300000007,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000017',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-7'),
   3, now() - interval '31 days', now() - interval '31 days', now() - interval '31 days'),
  -- D8: abandoned yesterday → kept, because it is the only trace of a lost notification
  ('d1330000-0000-0000-0000-000000000008', 913300000008,
   jsonb_build_object('recipient_id','91330000-0000-0000-0000-000000000018',
     'type','moment','template_key','notif.tpl.pgtap0133c','dedupe_key','k-8'),
   3, now() - interval '1 day', now() - interval '1 day', now() - interval '1 day');

insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created)
values
  (913300000001, 200, 'application/json', '{}'::jsonb, '{"ok":true}', false, null, now()),
  (913300000002, 500, 'application/json', '{}'::jsonb,
   '{"error":"notification insert failed: JWT issued at future"}', false, null, now()),
  (913300000003, 500, 'application/json', '{}'::jsonb,
   '{"error":"notification insert failed: boom"}', false, null, now()),
  (913300000004, 400, 'application/json', '{}'::jsonb, '{"error":"missing fields"}', false, null, now()),
  (913300000009, 401, 'application/json', '{}'::jsonb, '{"message":"Invalid API key"}', false, null, now());

select athanor.notification_dispatch_reconcile();

select is(
  (select count(*)::int from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000001'),
  0, 'a 2xx retires the outbox row — the notification exists, there is nothing to reconcile');

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' = 'k-1'),
  0, 'a delivered dispatch is never re-POSTed');

-- The heart of it: the re-POST carries the SAME dedupe_key, so fan-out's ON CONFLICT DO NOTHING
-- turns the retry into a no-op if the first attempt did land after all. Without this the fix
-- would trade a lost notification for a duplicated one.
select is(
  (select convert_from(q.body, 'utf8')::jsonb from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' = 'k-2'),
  (select payload from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000002'),
  'a 5xx is re-POSTed with the identical body, dedupe_key and all');

select is(
  (select attempts::int from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000002'),
  2, 'the retry is counted');

select isnt(
  (select request_id from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000002'),
  913300000002::bigint,
  'the row now tracks the NEW request id — the next tick reconciles the retry, not the original');

select is(
  (select last_status from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000002'),
  500, 'the status that caused the retry is recorded');

select is(
  (select abandoned_at is not null from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000003'),
  true, 'the retry budget ends in abandoned_at, not in silence (#521: the loss leaves no trace)');

select is(
  (select last_status from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000003'),
  500, 'an abandoned dispatch records the status it died on');

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' = 'k-3'),
  0, 'an abandoned dispatch is not re-POSTed as well as abandoned');

select is(
  (select abandoned_at is not null and last_status = 400
     from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000004'),
  true, 'a 4xx is abandoned on the first attempt — the same body would be rejected identically');

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' = 'k-4'),
  0, 'a 400 is not retried');

-- The distinction the first cut of this migration got wrong. 401 is the fan-out key mid-rotation
-- and 404 is the function not deployed yet — recoverable config failures, and precisely the
-- class the outbox exists to survive. Treating them as deterministic would abandon every pending
-- notification on the first sweep of the outage, which is worse than the bug #521 reported.
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' = 'k-9'),
  1, 'a 401 IS retried — the platform rejected the key, not the body');

select is(
  (select abandoned_at is null and attempts = 2 from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000009'),
  true, 'and it keeps its retry budget rather than being abandoned on sight');

-- pg_net prunes net._http_response on its own TTL, so "no row" is indistinguishable from a
-- failure once the grace window has passed. The dedupe_key is what makes guessing wrong cheap.
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' = 'k-5'),
  1, 'a dispatch whose response never arrived (or was pruned) is re-POSTed');

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' = 'k-6'),
  0, 'a dispatch still inside the grace window is left alone — it is probably just in flight');

select is(
  (select attempts::int from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000006'),
  1, 'and its attempt count is untouched');

select is(
  (select count(*)::int from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000007'),
  0, 'an abandoned dispatch is reaped after 30 days');

select is(
  (select count(*)::int from athanor.notification_dispatches
    where id = 'd1330000-0000-0000-0000-000000000008'),
  1, 'a recently abandoned dispatch is kept — it is the record a human would look at');

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key' in ('k-7', 'k-8')),
  0, 'an already-abandoned dispatch is never re-POSTed');

select * from finish();
rollback;
