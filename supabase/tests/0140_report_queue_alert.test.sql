-- 0140_report_queue_alert.test.sql
-- Issue #602 — nothing told the watcher a report existed. 20260831123550 adds
-- public.report_queue_alert_sweep() (pg_cron, every 15 minutes), athanor.report_alert_sends
-- (the idempotency marker) and the 'reportQueue' notification type.
--
-- Asserts: catalog shape (cron-only function, marker off the client grant surface, the */15
-- schedule, both type CHECKs widened and still closed) · fan-out unconfigured → NOTHING is
-- claimed, so no report is burned unannounced, while retention still runs · retention is
-- PREDICATED: a 31-day-old marker whose report is still unresolved SURVIVES, because reaping
-- it would re-announce the report · the recipient set comes from the admin flag, so a member
-- never receives one · a sweep that claims two reports enqueues ONE notification, not two ·
-- a second sweep enqueues nothing · a new report enqueues exactly one more, and the number in
-- it is the QUEUE DEPTH, not the count of new arrivals · a quiet tick is silent · the singular
-- template key is used exactly when one report waits.
--
-- pg_net's worker never sees uncommitted queue rows, so net.http_request_queue is a safe
-- in-txn witness of the exact enqueued payload (0064 K, 0094 D, 0130).
--
-- Every assertion is scoped to this file's own fixture ids — BOTH halves: the 'dd140000-%'
-- reports AND the 'a0140000-…0001' watcher. Scoping the marker reads by report alone is not
-- enough and the staging smoke proved it: that project carries its own admin, so every fixture
-- report is legitimately claimed twice and a report-scoped count reads 6 where it means 3. An
-- unscoped assertion passes only on an empty database; a half-scoped one passes only on a
-- single-watcher database, which is a thinner promise than this feature makes.
--
-- ONE assertion cannot hold outside CI, and it is the same one 0130 flags: the unconfigured
-- claim (B, "an unconfigured sweep claims no marker"). athanor.runtime_setting falls through an
-- empty GUC to Vault, which every hosted project has and no CI stack does, so on staging
-- fan-out is genuinely configured and the sweep will have claimed. That is the environment
-- differing, not the sweep.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

-- ── fixtures: one watcher (app_metadata role) and two ordinary members ────────────────────
-- The admin flag lives ONLY in auth.users.raw_app_meta_data (rule #2 — never user_metadata),
-- which is the whole reason the sweep cannot reuse athanor.is_admin(): that one reads
-- auth.jwt(), and a cron job has none. handle_new_user auto-creates the profiles.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a0140000-0000-0000-0000-000000000001',
   'authenticated','authenticated','watcher140@test.athanor',
   '{"locale":"it"}'::jsonb, '{"role":"admin"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a0140000-0000-0000-0000-000000000002',
   'authenticated','authenticated','reporter140@test.athanor',
   '{"locale":"it"}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a0140000-0000-0000-0000-000000000003',
   'authenticated','authenticated','target140@test.athanor',
   '{"locale":"it"}'::jsonb, '{}'::jsonb, now(), now());

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (A) catalog shape — cron-only, marker unreachable from any client, type set widened
-- ─────────────────────────────────────────────────────────────────────────────────────────

select has_function('public', 'report_queue_alert_sweep', array[]::text[],
  'public.report_queue_alert_sweep() exists');

select ok(not has_function_privilege('anon', 'public.report_queue_alert_sweep()', 'execute'),
  'anon cannot execute the queue alert sweep');

select ok(not has_function_privilege('authenticated', 'public.report_queue_alert_sweep()', 'execute'),
  'authenticated cannot execute the queue alert sweep');

select has_table('athanor', 'report_alert_sends',
  'athanor.report_alert_sends exists (the marker lives off the client grant surface)');

select is(
  (select c.relrowsecurity from pg_class c
     where c.oid = 'athanor.report_alert_sends'::regclass),
  true, 'the marker table has RLS enabled (deny-all: it carries no policies)');

-- The reason the marker is not a `reports.alerted_at` column: reports holds a client INSERT
-- grant, so a column there rides a row the reporter writes.
select is_empty(
  $$ select r.role || ' / ' || pv.priv
       from (values ('anon'), ('authenticated')) as r(role)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pv(priv)
      where has_table_privilege(r.role, 'athanor.report_alert_sends', pv.priv) $$,
  'no client role holds any privilege on the marker table');

-- The cadence IS the rate limit (reports carries no throttle of its own), so the schedule is
-- an assertion and not a detail: at */15 the worst a flooder can force is four buzzes an hour.
select results_eq(
  $$ select schedule from cron.job where jobname = 'report-queue-alert-sweep' $$,
  $$ values ('*/15 * * * *') $$,
  'report-queue-alert-sweep runs every fifteen minutes');

select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       values ('a0140000-0000-0000-0000-000000000001', 'reportQueue', 'notif.tpl.reportQueue') $$,
  'notifications_type_check admits reportQueue (#602)');

select lives_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel)
       values ('a0140000-0000-0000-0000-000000000001', 'reportQueue', 'push') $$,
  'notification_preferences_type_check admits reportQueue (#602)');

-- Widening a closed set must not open it.
select throws_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       values ('a0140000-0000-0000-0000-000000000001', 'somethingElse', 'notif.tpl.generic') $$,
  '23514', null, 'the notification type set stays closed after the tenth value');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- fixtures: five reports, one per branch of the unresolved predicate
-- ─────────────────────────────────────────────────────────────────────────────────────────
insert into public.reports (id, reporter_id, target_type, target_id, category, note, status) values
  ('dd140000-0000-0000-0000-000000000001','a0140000-0000-0000-0000-000000000002',
   'person','a0140000-0000-0000-0000-000000000003','harassment','r1','open'),
  ('dd140000-0000-0000-0000-000000000002','a0140000-0000-0000-0000-000000000002',
   'person','a0140000-0000-0000-0000-000000000003','spam','r2','open'),
  ('dd140000-0000-0000-0000-000000000003','a0140000-0000-0000-0000-000000000002',
   'behavior',null,'mlm','r3','reviewing'),
  ('dd140000-0000-0000-0000-000000000004','a0140000-0000-0000-0000-000000000002',
   'person','a0140000-0000-0000-0000-000000000003','selling','r4','upheld'),
  ('dd140000-0000-0000-0000-000000000005','a0140000-0000-0000-0000-000000000002',
   'person','a0140000-0000-0000-0000-000000000003','other','r5','dismissed');

-- Two 31-day-old markers planted before any sweep. R1 is still OPEN and R4 is resolved: the
-- reaper must tell them apart, which is the difference between this retention clause and
-- event_reminder_sweep's unpredicated one.
insert into athanor.report_alert_sends (report_id, recipient_id, sent_at) values
  ('dd140000-0000-0000-0000-000000000001','a0140000-0000-0000-0000-000000000001', now() - interval '31 days'),
  ('dd140000-0000-0000-0000-000000000004','a0140000-0000-0000-0000-000000000001', now() - interval '31 days');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (B) fan-out unconfigured → claim NOTHING, but still reap. Claiming against a guarded no-op
--     enqueue would spend each report's one announcement and deliver silence.
-- ─────────────────────────────────────────────────────────────────────────────────────────

select lives_ok(
  $$ select public.report_queue_alert_sweep() $$,
  'the sweep runs clean with fan-out unconfigured');

-- CI-ONLY (see header): on a hosted project Vault configures fan-out and this will have claimed.
select bag_eq(
  $$ select report_id::text from athanor.report_alert_sends
      where report_id::text like 'dd140000-%'
        and recipient_id = 'a0140000-0000-0000-0000-000000000001' $$,
  $$ values ('dd140000-0000-0000-0000-000000000001'::text) $$,
  'an unconfigured sweep claims no marker (no report is burned unannounced)');

-- Retention is not gated on delivery — but it IS gated on the report. R4 is resolved, so its
-- 31-day-old marker goes; R1 is still open, so its equally old marker STAYS. A plain age reap
-- would drop R1's and re-announce a report the watcher has already been told about.
select is(
  (select count(*)::int from athanor.report_alert_sends
    where report_id = 'dd140000-0000-0000-0000-000000000004'),
  0, 'a 31-day-old marker whose report is resolved is reaped');

select is(
  (select count(*)::int from athanor.report_alert_sends
    where report_id = 'dd140000-0000-0000-0000-000000000001'
      and recipient_id = 'a0140000-0000-0000-0000-000000000001'),
  1, 'a 31-day-old marker whose report is STILL unresolved survives (reaping it would re-announce)');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (C) configured → the watcher is claimed for every unresolved report, and told ONCE
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- txn-local GUCs: runtime_setting reads the GUC before Vault, and these roll back with the txn.
select set_config('app.settings.notification_fanout_url',
                  'http://fanout.invalid/functions/v1/notification-fan-out', true);
select set_config('app.settings.notification_fanout_key', 'sb_secret_pgtap_dummy_key', true);

select public.report_queue_alert_sweep();

select bag_eq(
  $$ select report_id::text || '/' || recipient_id::text
       from athanor.report_alert_sends
      where report_id::text like 'dd140000-%'
        and recipient_id = 'a0140000-0000-0000-0000-000000000001' $$,
  $$ values ('dd140000-0000-0000-0000-000000000001/a0140000-0000-0000-0000-000000000001'::text),
            ('dd140000-0000-0000-0000-000000000002/a0140000-0000-0000-0000-000000000001'),
            ('dd140000-0000-0000-0000-000000000003/a0140000-0000-0000-0000-000000000001') $$,
  'the two open reports and the reviewing one are claimed for the watcher; the upheld and dismissed ones are not');

-- The recipient comes from the flag, never from an id typed into the migration.
select is(
  (select count(*)::int from athanor.report_alert_sends
    where recipient_id in ('a0140000-0000-0000-0000-000000000002',
                           'a0140000-0000-0000-0000-000000000003')),
  0, 'a member without the admin flag is never a recipient');

-- TWO reports newly claimed, ONE notification. This is the aggregate rule: a burst is a number,
-- not a queue of buzzes.
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'),
  1, 'two newly claimed reports enqueue ONE notification, not one per report');

select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'template_key'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
    order by q.id desc limit 1),
  'notif.tpl.reportQueue', 'more than one waiting → the plural key');

-- The number is the DEPTH of the queue, not the size of the claim.
select is(
  (select convert_from(q.body, 'utf8')::jsonb #>> '{params,count}'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
    order by q.id desc limit 1),
  (select count(*)::text from public.reports where status in ('open', 'reviewing')),
  'the count is the unresolved queue depth at send time');

-- #97 scopes the admin read path to reported content; a push payload renders on a lock screen.
-- entity_ref is NULL and params hold a count — no report id, no handle, no note text.
select is(
  (select jsonb_typeof(convert_from(q.body, 'utf8')::jsonb -> 'entity_ref')
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
    order by q.id desc limit 1),
  'null', 'the payload carries no entity reference — a count and nothing from the report');

select is(
  (select count(*)::int
     from net.http_request_queue q,
          lateral jsonb_object_keys(convert_from(q.body, 'utf8')::jsonb -> 'params') as k
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
      and k <> 'count'),
  0, 'params hold the count and nothing else');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (D) a second sweep on the same queue says nothing — the marker, not the notification, dedupes
-- ─────────────────────────────────────────────────────────────────────────────────────────

select public.report_queue_alert_sweep();

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'),
  1, 'a second sweep over an already-announced queue enqueues nothing');

select is(
  (select count(*)::int from athanor.report_alert_sends
    where report_id::text like 'dd140000-%'
      and recipient_id = 'a0140000-0000-0000-0000-000000000001'),
  3, 'and claims no further marker');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (E) a new report → exactly one more notification, carrying the DEEPER queue
-- ─────────────────────────────────────────────────────────────────────────────────────────

insert into public.reports (id, reporter_id, target_type, target_id, category, note) values
  ('dd140000-0000-0000-0000-000000000006','a0140000-0000-0000-0000-000000000002',
   'person','a0140000-0000-0000-0000-000000000003','impersonation','r6');

select public.report_queue_alert_sweep();

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'),
  2, 'one new report → exactly one more notification');

-- ONE report was claimed on this tick and the count says four (or more, on a seeded project).
-- That gap is the assertion: a count of new arrivals would read 1 here.
select is(
  (select convert_from(q.body, 'utf8')::jsonb #>> '{params,count}'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
    order by q.id desc limit 1),
  (select count(*)::text from public.reports where status in ('open', 'reviewing')),
  'the second notification names the whole queue, not the one report that triggered it');

select cmp_ok(
  (select (convert_from(q.body, 'utf8')::jsonb #>> '{params,count}')::int
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
    order by q.id desc limit 1),
  '>', 1,
  'and that number is greater than the single claim behind it');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (F) a quiet day produces zero noise — the acceptance line's second half
-- ─────────────────────────────────────────────────────────────────────────────────────────

update public.reports set status = 'dismissed'
 where id::text like 'dd140000-%' and status in ('open', 'reviewing');

select public.report_queue_alert_sweep();

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'),
  2, 'an empty queue enqueues nothing: a quiet day is silent');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (G) one waiting report reads as one, not as «1 segnalazioni»
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Clears the whole board rather than only this file's rows, so the GLOBAL depth is exactly one
-- on a seeded project too. Inside begin/rollback, so nothing survives the test.
update public.reports set status = 'dismissed' where status in ('open', 'reviewing');

insert into public.reports (id, reporter_id, target_type, target_id, category, note) values
  ('dd140000-0000-0000-0000-000000000007','a0140000-0000-0000-0000-000000000002',
   'person','a0140000-0000-0000-0000-000000000003','income','r7');

select public.report_queue_alert_sweep();

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'),
  3, 'a report arriving after the queue emptied is announced');

select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'template_key'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
    order by q.id desc limit 1),
  'notif.tpl.reportQueueOne', 'exactly one waiting → the singular key (t() has no plural support)');

select is(
  (select convert_from(q.body, 'utf8')::jsonb #>> '{params,count}'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
      and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
    order by q.id desc limit 1),
  '1', 'and it carries the count anyway, so the two keys stay interchangeable at the boundary');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (H) the invariant over every body this file produced: singular key ⟺ a queue of one
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Stated as an equivalence rather than two examples, so a future edit that flips the branch
-- one way (always plural, always singular) fails here even if it keeps the example cases green.
select is_empty(
  $$ select q.id::text
       from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'reportQueue'
        and convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' = 'a0140000-0000-0000-0000-000000000001'
        and ((convert_from(q.body, 'utf8')::jsonb #>> '{params,count}')::int = 1)
          is distinct from
            (convert_from(q.body, 'utf8')::jsonb ->> 'template_key' = 'notif.tpl.reportQueueOne') $$,
  'the singular key is used exactly when one report waits, on every body enqueued here');

select * from finish();
rollback;
