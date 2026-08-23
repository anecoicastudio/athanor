-- 0131_fund_broadcast_notifications.test.sql
-- Issue #127 — fund milestone and countdown notifications had no mechanism, not just no producer.
-- 20260823121933 adds notifications.dedupe_key + athanor.enqueue_audience_notification and
-- re-admits 'fundMilestone'; 20260823121934 adds the milestone trigger, the countdown sweep and
-- athanor.fund_broadcast_sends.
--
-- Asserts: catalog shape (dedupe key + partial index, marker off the client grant surface,
-- cron-only function, trigger function unreachable, schedule) · the dedupe key dedupes per
-- recipient and ONLY when set, so every existing one-recipient producer keeps writing two
-- identical rows · the milestone trigger fires once per threshold CROSSED on one update, fires
-- for several at once, and stays silent when raised_cents does not move · the countdown sweep
-- claims the right slots, claims nothing twice, and prunes regardless of configuration ·
-- rule 1: none of it writes Aura · rule 6: none of it writes the money cache.
--
-- pg_net's worker never sees uncommitted queue rows, so net.http_request_queue is a safe in-txn
-- witness of the exact enqueued payload (0064 K, 0094 D, 0130).
--
-- Assertions are scoped to this file's own fixture ids rather than to whole-table counts: an
-- unscoped count passes only on an empty database and would go red against any seeded world.
--
-- As in 0130, the two "unconfigured" assertions CANNOT hold outside CI — they need fan-out to be
-- genuinely unconfigured, and athanor.runtime_setting falls back to Vault, which every hosted
-- project has and no CI stack does. Running this file against staging fails those and only those.

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- ── fixtures: two members (handle_new_user auto-creates profiles) ─────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa1111-0000-0000-0000-000000000131',
   'authenticated','authenticated','member131a@test.athanor','{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb1111-0000-0000-0000-000000000131',
   'authenticated','authenticated','member131b@test.athanor','{"locale":"it"}'::jsonb, now(), now());

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (A) catalog shape
-- ─────────────────────────────────────────────────────────────────────────────────────────

select has_column('public', 'notifications', 'dedupe_key',
  'notifications.dedupe_key exists (#521: idempotency at the row)');

-- PARTIAL on purpose: only a keyed row is deduped. Asserted through pg_index.indpred rather than
-- by name alone, because an index created without the predicate would still match the name.
select ok(
  (select i.indpred is not null
     from pg_index i where i.indexrelid = 'public.notifications_recipient_dedupe'::regclass),
  'the dedupe index is PARTIAL (unkeyed rows are never deduped against each other)');

select has_table('athanor', 'fund_broadcast_sends',
  'athanor.fund_broadcast_sends exists (the marker lives off the client grant surface)');

select is(
  (select c.relrowsecurity from pg_class c
     where c.oid = 'athanor.fund_broadcast_sends'::regclass),
  true, 'the marker table has RLS enabled (deny-all: it carries no policies)');

select is_empty(
  $$ select r.role || ' / ' || pv.priv
       from (values ('anon'), ('authenticated')) as r(role)
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pv(priv)
      where has_table_privilege(r.role, 'athanor.fund_broadcast_sends', pv.priv) $$,
  'no client role holds any privilege on the marker table');

select ok(not has_function_privilege('anon', 'public.fund_countdown_sweep()', 'execute'),
  'anon cannot execute the countdown sweep');
select ok(not has_function_privilege('authenticated', 'public.fund_countdown_sweep()', 'execute'),
  'authenticated cannot execute the countdown sweep');

-- The trigger function: 0121 states the rule for the whole schema; this pins THIS one, so the
-- failure names the function rather than the sweep.
select ok(not has_function_privilege('authenticated', 'public.on_fund_aggregate_milestone()', 'execute'),
  'authenticated cannot execute the milestone trigger function');

select has_trigger('public', 'fund_aggregates', 'fund_aggregates_milestone_broadcast',
  'the milestone trigger is bound to fund_aggregates');

-- The broadcast enqueue is a DB-producer API, never a client one.
select ok(
  not has_function_privilege('authenticated',
    'athanor.enqueue_audience_notification(text, text, text, jsonb, jsonb, text)', 'execute'),
  'authenticated cannot enqueue a broadcast to everybody');

select results_eq(
  $$ select schedule from cron.job where jobname = 'fund-countdown-sweep' $$,
  $$ values ('*/15 * * * *') $$,
  'fund-countdown-sweep runs every 15 minutes');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (B) the dedupe key: per recipient, and only when set
-- ─────────────────────────────────────────────────────────────────────────────────────────

select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key, dedupe_key)
       values ('aaaa1111-0000-0000-0000-000000000131', 'fundMilestone',
               'notif.tpl.fundMilestone', 'fund:test:milestone:50') $$,
  'a keyed broadcast row inserts');

select throws_ok(
  $$ insert into public.notifications (recipient_id, type, template_key, dedupe_key)
       values ('aaaa1111-0000-0000-0000-000000000131', 'fundMilestone',
               'notif.tpl.fundMilestone', 'fund:test:milestone:50') $$,
  '23505', null,
  'the same key twice for one recipient is a unique violation (a re-send inserts nothing)');

-- The audience is many members sharing one key — the index must be per RECIPIENT, not global.
select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key, dedupe_key)
       values ('bbbb1111-0000-0000-0000-000000000131', 'fundMilestone',
               'notif.tpl.fundMilestone', 'fund:test:milestone:50') $$,
  'the same key for a DIFFERENT recipient inserts (one broadcast, one row per member)');

-- The regression that a non-partial index would cause: «Hai un Momento» twice is two Momenti.
select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       select 'aaaa1111-0000-0000-0000-000000000131', 'moment', 'notif.tpl.moment'
         from generate_series(1, 2) $$,
  'two unkeyed rows still insert (every existing one-recipient producer is unaffected)');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- fixture: one open cycle, far enough out that no countdown slot is due yet
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- fund_editions_one_active (D2) permits ONE non-closed cycle GLOBALLY, so this fixture cannot
-- simply insert one: it passes on a from-zero CI stack and fails against any database that
-- already holds an open cycle — staging's seeded world does, and that is where this file is
-- smoked before CI ever sees it. Closing whatever is open first makes the fixture deterministic
-- in both. Rolled back with the rest of the transaction, so the seeded world is untouched.
-- closure_reason is required by fund_editions_closure_reason_shape whenever phase = 'closed'.
update public.fund_editions
   set phase = 'closed',
       closure_reason = coalesce(closure_reason, 'voided_quorum')
 where phase <> 'closed';

insert into public.fund_editions
  (id, phase, target_at, goal_cents, voting_starts_at, voting_ends_at,
   min_funding_cents, min_voters, min_candidacies, split_pct, cost_fee_statement, equity_declared)
values
  ('fd310000-0000-0000-0000-000000000001', 'voting',
   now() + interval '60 days', 100000,
   now() - interval '1 day', now() + interval '50 days',
   10000, 5, 3, 10, 'Costi dichiarati per il test.', 'Nessuna partecipazione.');

insert into public.fund_aggregates (edition_id, raised_cents, contributor_count)
values ('fd310000-0000-0000-0000-000000000001', 0, 0);

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (C) unconfigured: the guarded no-op reaches all the way through the producers
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Every queue assertion below is a DELTA against this snapshot, never a whole-table count:
-- net.http_request_queue is shared, and a hosted project's own traffic would make an absolute
-- count environment-dependent. Snapshot → act → assert on the rows that are new.
create temporary table q_seen as select id from net.http_request_queue;

update public.fund_aggregates set raised_cents = 50000
 where edition_id = 'fd310000-0000-0000-0000-000000000001';

-- THIS assertion cannot hold outside CI (see header): it needs fan-out genuinely unconfigured,
-- and runtime_setting falls back to Vault, which every hosted project has. Against staging this
-- one fails and — because of the delta scoping — nothing else does.
select is(
  (select count(*)::int from net.http_request_queue q
    where q.id not in (select id from q_seen)
      and convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'fundMilestone'),
  0, 'an unconfigured project broadcasts nothing rather than believing it did');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (D) configured: one enqueue per threshold CROSSED on a single update
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- txn-local GUCs: runtime_setting reads the GUC before Vault, and these roll back with the txn.
select set_config('app.settings.notification_fanout_url',
                  'http://fanout.invalid/functions/v1/notification-fan-out', true);
select set_config('app.settings.notification_fanout_key', 'sb_secret_pgtap_dummy_key', true);

-- 50 % → 100 % in one update crosses BOTH 75 and 100. A per-update trigger that only compared
-- against the new value would announce one of them and silently drop the other.
-- Re-snapshot, so what follows is exactly what THIS update enqueued.
truncate q_seen;
insert into q_seen select id from net.http_request_queue;

update public.fund_aggregates set raised_cents = 100000
 where edition_id = 'fd310000-0000-0000-0000-000000000001';

select bag_eq(
  $$ select convert_from(q.body, 'utf8')::jsonb #>> '{params,pct}'
       from net.http_request_queue q
      where q.id not in (select id from q_seen)
        and convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'fundMilestone'
        and convert_from(q.body, 'utf8')::jsonb ->> 'template_key' = 'notif.tpl.fundMilestone' $$,
  $$ values ('75'::text), ('100') $$,
  'one update crossing two thresholds enqueues both (75 and 100)');

select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'fundMilestone'
      and convert_from(q.body, 'utf8')::jsonb #>> '{params,pct}' = '100'),
  'fund:fd310000-0000-0000-0000-000000000001:milestone:100',
  'the dedupe key names (cycle, event, slot) so a re-send is safe (#521)');

select is(
  (select convert_from(q.body, 'utf8')::jsonb -> 'entity_ref'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'fundMilestone'
      and convert_from(q.body, 'utf8')::jsonb #>> '{params,pct}' = '100'),
  '{"kind": "fund", "id": "fd310000-0000-0000-0000-000000000001"}'::jsonb,
  'entity_ref carries the cycle id the route arm reads (lib/notification-route.ts)');

select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'audience'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'type' = 'fundMilestone' limit 1),
  'all_members',
  'the body carries an audience SELECTOR, not a predicate (eligibility lives in one place)');

-- An update that does not move raised_cents must not re-announce anything. Asserted as a delta
-- rather than a total, so it says "this update enqueued nothing" instead of "the table holds N".
truncate q_seen;
insert into q_seen select id from net.http_request_queue;

update public.fund_aggregates set contributor_count = 7
 where edition_id = 'fd310000-0000-0000-0000-000000000001';

select is_empty(
  $$ select convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key'
       from net.http_request_queue q
      where q.id not in (select id from q_seen) $$,
  'an update that leaves raised_cents alone announces nothing');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (E) the countdown sweep
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Move the cycle's windows into two DIFFERENT bands: target_at into d7 (3–7 days) and
-- voting_ends_at into d3 (1–3 days). Exactly two slots are due, and they are due for different
-- reasons — which is what proves the bands are per (window, slot) and not per cycle.
update public.fund_editions
   set target_at      = now() + interval '5 days',
       voting_ends_at = now() + interval '2 days'
 where id = 'fd310000-0000-0000-0000-000000000001';

-- A stale marker from a past life of this cycle: retention must reap it.
insert into athanor.fund_broadcast_sends (edition_id, kind, slot, sent_at)
values ('fd310000-0000-0000-0000-000000000001', 'ballot', 'd1', now() - interval '91 days');

select lives_ok(
  $$ select public.fund_countdown_sweep() $$,
  'the countdown sweep runs clean');

select bag_eq(
  $$ select kind || '/' || slot from athanor.fund_broadcast_sends
      where edition_id = 'fd310000-0000-0000-0000-000000000001' $$,
  $$ values ('announce/d7'::text), ('ballot/d3') $$,
  'exactly two slots claimed: announcement at 7 days, ballot close at 3 — and the 91-day-old marker was reaped');

select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'template_key'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key'
        = 'fund:fd310000-0000-0000-0000-000000000001:ballot:d3'),
  'notif.tpl.fundBallotCountdown',
  'the ballot slot enqueues the ballot template _shared/notif-templates.ts renders');

-- 7 and 3 interpolate {days}; the 1-day slot has its own key because `t()` has no plural
-- support and «Mancano 1 giorni» is not Italian.
select is(
  (select convert_from(q.body, 'utf8')::jsonb #>> '{params,days}'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'dedupe_key'
        = 'fund:fd310000-0000-0000-0000-000000000001:announce:d7'),
  '7', 'the announcement slot carries the day count its template interpolates');

select public.fund_countdown_sweep();

select is(
  (select count(*)::int from athanor.fund_broadcast_sends
    where edition_id = 'fd310000-0000-0000-0000-000000000001'),
  2, 'a second sweep claims no new marker (the ON CONFLICT claim is the dedupe)');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (F) rules 1 and 6
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Deliberately unfiltered by type: `where type = 'fundMilestone'` would pass for the trivial
-- reason that no such aura type exists. What has to hold is that announcing the fund wrote
-- NOTHING to the ledger — the fund yields zero Aura, and a broadcast about it yields zero too.
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('aaaa1111-0000-0000-0000-000000000131',
                         'bbbb1111-0000-0000-0000-000000000131')),
  0, 'the broadcast writes no aura_events row (rule 1 — reputation is never bought)');

-- Rule 6: the trigger observes the money cache and never authors it. recompute_fund_aggregate()
-- via stripe-webhook stays its only writer, so the value is exactly what this test last set.
select is(
  (select raised_cents from public.fund_aggregates
    where edition_id = 'fd310000-0000-0000-0000-000000000001'),
  100000::bigint,
  'the milestone trigger never writes back to fund_aggregates (rule 6 — Stripe is the source)');

select * from finish();
rollback;
