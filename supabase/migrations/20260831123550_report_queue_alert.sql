-- Moderation report alert (#602) — the watcher learns a report exists without polling /admin.
--
-- The #97 ruling (2026-08-30) makes Marco the launch moderator: a daily queue check, 48h
-- target turnaround. Nothing carried that cadence a signal. `public.reports` has exactly one
-- trigger (`reports_touch_updated_at`, a before-update touch, 20260620011307:31-33) and no
-- cron job in this repo reads it, so a burst arriving between two checks was invisible until
-- the next one. The daily check WAS the mechanism.
--
-- ── Why a sweep and not a row trigger ────────────────────────────────────────────────────
--
-- An AFTER INSERT trigger on `reports` is the shorter patch and the wrong one. `reports`
-- carries no rate limit, no unique constraint and no per-reporter cap — the only throttle in
-- this schema is athanor.waitlist_throttle on email_waitlist — so a per-row producer hands any
-- authenticated member a button that buzzes the moderator's phone as fast as they can POST.
-- That is the same defect that deleted the product's one operator-alert email (the Resend send
-- on waitlist signup, apps/web/app/api/waitlist/route.ts): an unauthenticated actor could
-- mailbomb the operator with fresh addresses. Re-creating it one surface over, aimed at a
-- phone, is worse.
--
-- A scheduled sweep makes the CADENCE the rate limit. Whatever a flooder files inside a
-- quarter hour arrives as one notification carrying one number. The worst case a member can
-- force is four buzzes an hour, and that ceiling does not depend on anyone remembering to add
-- a throttle later.
--
-- ── Why 15 minutes ───────────────────────────────────────────────────────────────────────
--
-- The ruling's own cadence is daily. */15 is ~96× tighter than the mechanism it replaces,
-- which is far inside the 48h turnaround with room to spare, and it is the coarsest interval
-- that still feels like "someone told me" rather than "I found it tomorrow". The minute
-- cadence event_reminder_sweep uses would buy nothing here — no report is time-critical to the
-- minute — and would cost the aggregation that makes the flood ceiling hold.
--
-- ── Zero noise on a quiet day, and no repeat for a report already alerted ────────────────
--
-- The sweep notifies on NEWLY CLAIMED reports only, never on "the queue is non-empty". That
-- distinction is the whole acceptance line. A digest keyed on queue depth re-fires every
-- interval until the queue is cleared — `reports.status` has no acknowledged state between
-- 'open' and a verdict, so a backlog Marco has already seen would produce exactly the noise
-- this is supposed to avoid. Keyed on the claim, an empty tick enqueues nothing and a report
-- is announced once.
--
-- The NUMBER in the copy is still the queue depth, not the count of new arrivals: what the
-- watcher needs from a push is how much is waiting, and «1 nuova, 9 in coda» is two numbers
-- where the useful one is the second.
--
-- ── Who "the watcher" is ─────────────────────────────────────────────────────────────────
--
-- Derived from the data, never a hardcoded profile id: the admin role lives only in
-- auth.users.raw_app_meta_data->>'role' (rule #2 — app_metadata, never user_metadata), which
-- is where athanor.is_admin() reads it from too.
--
-- BUT athanor.is_admin() CANNOT be reused here, and the trap is worth stating because it fails
-- silently: it reads `auth.jwt()`, and a cron job has no JWT, so inside this function it would
-- return false for everyone and the sweep would notify nobody while looking correct. The
-- recipient set is therefore read from auth.users directly. `postgres` — the role pg_cron runs
-- as — holds SELECT on auth.users (verified against staging before this migration), so
-- security invoker is enough and no DEFINER escalation is introduced for it.
--
-- Zero admins is a valid state, not an error: the cross join yields no rows, nothing is
-- claimed, and the reports stay unannounced until an admin exists — at which point that admin
-- gets ONE aggregate notification, not one per historical report.
--
-- ── Rule 1 ──────────────────────────────────────────────────────────────────────────────
-- No aura_events, no aura_scores, nothing score-adjacent. Watching a queue earns nothing.

-- ── 1. the type ─────────────────────────────────────────────────────────────────────────
-- The sixth migration to restate both CHECKs, after 20260620025158, 20260813135602,
-- 20260813162227, 20260822115759 and 20260823121933. Ten types.
--
-- A NEW TYPE rather than a second template key on 'moderation', which is the reuse the type
-- set's own rule points away from: packages/schemas/src/notification.ts admits several keys
-- under one type only when they "share a lead, a glyph, a route and a prefs toggle, and only
-- the sentence differs" (the eventReminder trio, the fund's five). This shares none of it.
-- 'moderation' is a notice TO a sanctioned member — its lead is «Un richiamo» and its glyph
-- the warning triangle — and hanging a queue alert off it would title the moderator's push
-- with a reprimand.
--
-- Deliberately NO PREF_ROWS entry in apps/native's notif-prefs, the same stance 'moderation'
-- and 'gdprExport' take. It is added to notification_preferences' CHECK anyway, because the
-- two sets are kept identical by convention, but nothing writes a row for it: push-dispatch
-- treats an absent preference as enabled, so the alert obeys only the master push toggle. A
-- watcher must not be able to silence the moderation queue from a preferences screen — and
-- this type never reaches a member who is not one.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation','gdprExport','reportQueue'));

alter table public.notification_preferences drop constraint notification_preferences_type_check;
alter table public.notification_preferences add constraint notification_preferences_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation','gdprExport','reportQueue'));

-- ── 2. the marker ───────────────────────────────────────────────────────────────────────
-- CONVENTION EXEMPTION (#180): no updated_at and no touch trigger, exactly as
-- athanor.event_reminder_sends and athanor.fund_broadcast_sends. A send marker is an
-- append-only fact — this report was announced to this watcher — and is never revised, so
-- updated_at would be a column nothing maintains. The composite (report_id, recipient_id) PK
-- IS the identity: a surrogate uuid would let two rows claim one report and announce it twice,
-- which is the single thing this table exists to prevent. sent_at is the created_at.
--
-- In `athanor` rather than as a `reports.alerted_at` column, and the reason is not symmetry
-- with the sweep above it: `reports` carries a client INSERT grant, so a column there would
-- travel with the row a member writes. It also belongs to nobody in the report — the fact
-- recorded is about a WATCHER, and a second watcher needs a second row.
create table athanor.report_alert_sends (
  report_id    uuid        not null references public.reports  (id) on delete cascade,
  recipient_id uuid        not null references public.profiles (id) on delete cascade,
  sent_at      timestamptz not null default now(),
  primary key (report_id, recipient_id)
);

comment on table athanor.report_alert_sends is
  'CONVENTION EXEMPTION (#180). Idempotency markers for the moderation queue alert (#602): '
  'one row per (report, watcher), written by public.report_queue_alert_sweep() in the same '
  'statement that selects the work. Append-only, never revised. Lives in `athanor` — off the '
  'client grant surface — because a marker on `reports` would ride a row the reporter writes.';

-- The reaper filters on sent_at alone, which the PK (report_id first) cannot serve.
create index report_alert_sends_sent_at on athanor.report_alert_sends (sent_at);

-- No policies and no grants: `athanor` is not in config.toml's exposed `schemas`, so PostgREST
-- cannot see this table, and RLS with zero policies is deny-all for anyone who reached it
-- anyway. Since 20260816164834 a new table is born with no client privileges at all — stated
-- here rather than relied upon.
alter table athanor.report_alert_sends enable row level security;
revoke all on table athanor.report_alert_sends from public, anon, authenticated;
grant all on table athanor.report_alert_sends to service_role;

-- ── 3. the sweep ────────────────────────────────────────────────────────────────────────
-- security invoker, like event_reminder_sweep and live_window_sweep: cron runs it as postgres,
-- which bypasses RLS by design and can read auth.users. Execute is revoked below, so no client
-- role reaches it either way.
create function public.report_queue_alert_sweep() returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
begin
  -- Retention runs FIRST and is not gated on delivery, as in event_reminder_sweep — but it is
  -- predicated, which that one does not need to be. A plain `sent_at < now() - 30 days` reap
  -- would drop the marker of a report that is 30 days old and STILL unresolved, and the next
  -- tick would re-announce it: the exact repeat the acceptance line forbids. A marker is
  -- meaningless once its report is resolved; while the report waits, the marker is the memory.
  delete from athanor.report_alert_sends s
   where s.sent_at < now() - interval '30 days'
     and not exists (
       select 1 from public.reports rp
        where rp.id = s.report_id
          and rp.status in ('open', 'reviewing'));

  -- fan-out unconfigured → announce nothing rather than mark everything announced. Claiming
  -- markers against a guarded no-op enqueue would spend each report's one announcement and
  -- deliver silence (athanor.enqueue_notification, 20260810103721 / 20260824070529).
  if coalesce(athanor.runtime_setting('notification_fanout_url'), '') = ''
     or coalesce(athanor.runtime_setting('notification_fanout_key'), '') = '' then
    return;
  end if;

  for r in
    with watchers as (
      -- The recipient set, derived from the flag and never from an id typed into this file.
      -- Joined through profiles because notifications.recipient_id is a profile: an admin
      -- whose auth user exists without a profile row is simply not a recipient.
      select p.id as recipient_id
        from public.profiles p
        join auth.users u on u.id = p.id
       where u.raw_app_meta_data ->> 'role' = 'admin'
    ),
    unresolved as (
      -- Served by reports_admin_queue (status, created_at) where status in ('open','reviewing')
      -- — the partial index the admin panel's own queue read already built.
      select rp.id
        from public.reports rp
       where rp.status in ('open', 'reviewing')
    ),
    -- Claim and select in one statement: a concurrent tick either inserts the marker or is
    -- skipped by the conflict, so only the winner sees the report and it is announced once.
    -- Deduping on public.notifications instead would look safer and races —
    -- enqueue_notification POSTs through pg_net and returns before the row exists, and it
    -- mints its own dedupe_key per call, so the caller has no key to dedupe on at all.
    claimed as (
      insert into athanor.report_alert_sends (report_id, recipient_id)
      select un.id, w.recipient_id
        from unresolved un
        cross join watchers w
      on conflict (report_id, recipient_id) do nothing
      returning recipient_id
    )
    -- One row per WATCHER, not per report: the notification aggregates. `open_count` is the
    -- depth of the queue at send time, deliberately uncorrelated with the claim — a watcher
    -- added today is told what is waiting, not how much of it is new to them.
    select c.recipient_id,
           (select count(*)::int
              from public.reports rp
             where rp.status in ('open', 'reviewing')) as open_count
      from claimed c
     group by c.recipient_id
  loop
    -- `t()` does plain {name} interpolation with no plural support (the reason #127's fund
    -- countdown needed a *LastDay key), so the singular gets its own sentence rather than
    -- rendering «1 segnalazioni».
    --
    -- entity_ref is NULL and params carry a COUNT and nothing else. Not an oversight: #97's
    -- ruling scopes the admin read path to reported content only, and a notification's params
    -- are rendered on a lock screen by buildPushMessages. A handle, a note excerpt or even a
    -- report id would put the reported member on a screen anyone standing nearby can read.
    -- The alert says how many and where; the content lives behind the admin login.
    perform athanor.enqueue_notification(
      r.recipient_id,
      'reportQueue',
      case when r.open_count = 1 then 'notif.tpl.reportQueueOne' else 'notif.tpl.reportQueue' end,
      jsonb_build_object('count', r.open_count),
      null::jsonb
    );
  end loop;
end;
$$;

comment on function public.report_queue_alert_sweep() is
  'Moderation queue alert (#602): every 15 minutes, claims each unresolved report for each '
  'admin (auth.users app_metadata role) in athanor.report_alert_sends and enqueues ONE '
  'reportQueue notification per watcher carrying the queue depth — never one per report, and '
  'never a second time for a report already announced. Silent when nothing new is waiting. '
  'Cron-only (postgres ctx; athanor.is_admin() cannot answer here — it reads auth.jwt()). '
  'No-ops while fan-out is unconfigured, so no marker is burned undelivered.';

-- cron-only: not a client API
revoke execute on function public.report_queue_alert_sweep() from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'report-queue-alert-sweep',
  '*/15 * * * *',
  $$ select public.report_queue_alert_sweep() $$
);
