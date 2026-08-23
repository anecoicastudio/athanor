-- #127 — the two fund broadcast producers, on the one mechanism 20260823121933 built.
--
-- (1) MILESTONES: fund_aggregates.raised_cents crossing 25/50/75/100 % of fund_editions.goal_cents.
-- (2) COUNTDOWN: a scheduled sweep over the active cycle's published windows —
--     announcement (target_at) at 7/3/1 days, ballot close (voting_ends_at) at 3/1 days.
--
-- Both call athanor.enqueue_audience_notification, so both are ONE POST regardless of audience
-- size, and both carry a dedupe_key so a re-send is safe (#521).
--
-- ── Why the milestone is a trigger and the countdown is a sweep ──────────────────────────────
--
-- A milestone is a STATE TRANSITION with a row to hang it on: raised_cents changes, and the old
-- and new values in an AFTER UPDATE trigger are exactly the two numbers needed to say whether a
-- threshold was crossed. There is nothing to poll for.
--
-- A countdown is the ABSENCE of a transition — nothing happens in the database when an event
-- becomes three days away — so it can only be discovered by looking at the clock. That is the
-- same reasoning 20260701160235:38-41 gave for deferring event reminders to a scheduled job, and
-- 20260823103624 is the shape this follows.
--
-- ── Money stays webhook-written (rule 6) ─────────────────────────────────────────────────────
--
-- The trigger READS fund_aggregates and writes nothing to it. recompute_fund_aggregate()
-- (20260618153032), called only from stripe-webhook, remains the single writer of the money
-- cache. This adds an observer, not a second author.
--
-- On production fund_surfaces_enabled is off and no cycle is open, so no contribution settles,
-- so raised_cents never moves and the trigger is inert by construction — no extra kill-switch is
-- needed for it. The countdown sweep is the half with value at launch, since candidacy and
-- voting run independently of contributions.

-- ── 1. the broadcast marker ──────────────────────────────────────────────────────────────────
-- One row per BROADCAST — not per recipient. Its job is narrow: stop the once-a-minute sweep
-- from re-POSTing a full audience scan on every tick for the whole width of a window. Row-level
-- idempotency is the dedupe_key's job (20260823121933), and that split is what makes this table
-- safe to re-arm: deleting a row here re-sends, and the dedupe_key means the re-send inserts
-- only the rows that are genuinely missing. That is the property #521 asks for and the reason
-- this marker does not inherit athanor.event_reminder_sends' lose-on-5xx defect.
--
-- CONVENTION EXEMPTION (#180): no updated_at, no touch trigger, no surrogate uuid — same
-- reasoning as athanor.event_reminder_sends (20260823103624). A send marker is an append-only
-- fact and the composite key IS the identity; a surrogate would let two rows claim one slot.
create table athanor.fund_broadcast_sends (
  edition_id uuid        not null references public.fund_editions (id) on delete cascade,
  kind       text        not null check (kind in ('announce', 'ballot')),
  slot       text        not null check (slot in ('d7', 'd3', 'd1')),
  sent_at    timestamptz not null default now(),
  primary key (edition_id, kind, slot)
);

comment on table athanor.fund_broadcast_sends is
  'CONVENTION EXEMPTION (#180). One row per fund countdown broadcast (#127): (cycle, window, '
  'slot), claimed by public.fund_countdown_sweep() before it enqueues. Append-only. Lives in '
  '`athanor` — off the client grant surface — like athanor.event_reminder_sends. Deleting a row '
  're-arms that broadcast, which is SAFE here because notifications.dedupe_key dedupes at the '
  'row (#521): the re-send inserts only what is missing. Milestones use no marker — an AFTER '
  'UPDATE crossing fires once by construction.';

-- The reaper filters on sent_at alone, which the PK (edition_id first) cannot serve.
create index fund_broadcast_sends_sent_at on athanor.fund_broadcast_sends (sent_at);

-- No policies and no grants: `athanor` is not an exposed schema, so PostgREST cannot see this
-- table, and RLS with zero policies is deny-all for anyone who reached it anyway.
alter table athanor.fund_broadcast_sends enable row level security;
revoke all on table athanor.fund_broadcast_sends from public, anon, authenticated;
grant all on table athanor.fund_broadcast_sends to service_role;

-- ── 2. milestone producer ────────────────────────────────────────────────────────────────────
-- Thresholds are named once, here, rather than repeated at the comparison sites. They are not
-- mirrored into packages/core: nothing in TypeScript reads them — the app's fund surfaces render
-- raised/goal directly and never name a threshold — so a core module would be a constant with no
-- consumer, and core carries a 90 % coverage gate plus the mutation gate.
create or replace function public.on_fund_aggregate_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_thresholds constant integer[] := array[25, 50, 75, 100];
  v_goal   bigint;
  v_id     uuid;
  v_pct    integer;
begin
  -- raised_cents did not move → nothing to announce. Guards the touch-trigger's own no-op
  -- updates and any recompute that lands on an unchanged total.
  if new.raised_cents is not distinct from old.raised_cents then
    return new;
  end if;

  select e.id, e.goal_cents into v_id, v_goal
    from public.fund_editions e
   where e.id = new.edition_id;

  -- A goal of zero or NULL has no percentage. `if <null> then` is FALSE, not NULL-propagating,
  -- so this gate fails closed on a NULL goal — which is the safe direction: announce nothing.
  if v_goal is null or v_goal <= 0 then
    return new;
  end if;

  foreach v_pct in array c_thresholds loop
    -- Crossed on THIS update: below before, at-or-above now. A refund that drops the total back
    -- under and a later contribution that re-crosses would enqueue again; notifications.dedupe_key
    -- absorbs that, which is why this needs no marker table of its own.
    if old.raised_cents * 100 < v_goal * v_pct
       and new.raised_cents * 100 >= v_goal * v_pct then
      perform athanor.enqueue_audience_notification(
        'all_members',
        'fundMilestone',
        'notif.tpl.fundMilestone',
        jsonb_build_object('pct', v_pct),
        jsonb_build_object('kind', 'fund', 'id', v_id::text),
        'fund:' || v_id::text || ':milestone:' || v_pct::text
      );
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.on_fund_aggregate_milestone() is
  'Fund milestone broadcasts (#127): AFTER UPDATE on fund_aggregates, enqueues one audience '
  'notification per 25/50/75/100 % threshold crossed on this update. READS the money cache and '
  'never writes it — recompute_fund_aggregate() via stripe-webhook stays its only author '
  '(rule 6). DEFINER to reach athanor.enqueue_audience_notification; search_path locked; execute '
  'revoked below (trigger-only).';

revoke execute on function public.on_fund_aggregate_milestone() from public, anon, authenticated;

create trigger fund_aggregates_milestone_broadcast
  after update on public.fund_aggregates
  for each row execute function public.on_fund_aggregate_milestone();

-- ── 3. countdown producer ────────────────────────────────────────────────────────────────────
-- security invoker, like event_reminder_sweep and live_window_sweep: cron runs it as postgres,
-- which bypasses RLS by design. Execute is revoked below, so no client role reaches it either.
create or replace function public.fund_countdown_sweep() returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- The lead times, named once so the five slots read as one decision. Announcement gets a
  -- 7-day slot; the ballot does not, because a cycle's ballot window is shorter than the run-up
  -- to its announcement and a 7-day ballot warning would frequently predate the ballot opening.
  c_d7 constant interval := interval '7 days';
  c_d3 constant interval := interval '3 days';
  c_d1 constant interval := interval '1 day';
  v_due record;
begin
  -- Retention first and unconditionally — the lesson of 20260823110358 §2: a reaper below a
  -- configuration guard stops running exactly when the table is already accumulating. The FK
  -- drops these when the cycle goes, so this only catches long-lived cycles.
  delete from athanor.fund_broadcast_sends where sent_at < now() - interval '90 days';

  -- fan-out unconfigured → tell nobody rather than mark everybody told (20260823103624's rule)
  if coalesce(athanor.runtime_setting('notification_fanout_url'), '') = ''
     or coalesce(athanor.runtime_setting('notification_fanout_key'), '') = '' then
    return;
  end if;

  for v_due in
    with due as (
      select e.id as edition_id, s.kind, s.slot, s.at, s.template_key, s.days
        from public.fund_editions e
        cross join lateral (values
            -- Announcement: the cycle's own target_at. 7/3/1.
            ('announce'::text, 'd7'::text, e.target_at, 'notif.tpl.fundAnnounceCountdown'::text, 7),
            ('announce'::text, 'd3'::text, e.target_at, 'notif.tpl.fundAnnounceCountdown'::text, 3),
            ('announce'::text, 'd1'::text, e.target_at, 'notif.tpl.fundAnnounceLastDay'::text,  1),
            -- Ballot close: 3/1 only (see c_d7 note above).
            ('ballot'::text,   'd3'::text, e.voting_ends_at, 'notif.tpl.fundBallotCountdown'::text, 3),
            ('ballot'::text,   'd1'::text, e.voting_ends_at, 'notif.tpl.fundBallotLastDay'::text,   1)
          ) as s(kind, slot, at, template_key, days)
       -- Only the one non-closed cycle (fund_editions_one_active, D2). A closed cycle counts
       -- down to nothing.
       where e.phase <> 'closed'
         and s.at is not null
         -- Slots are disjoint by construction: each fires only inside its own band, and the
         -- bands do not overlap. d1 = (0, 1d], d3 = (1d, 3d], d7 = (3d, 7d].
         and s.at > now() + case s.slot when 'd7' then c_d3 when 'd3' then c_d1
                                        else interval '0' end
         and s.at <= now() + case s.slot when 'd7' then c_d7 when 'd3' then c_d3
                                         else c_d1 end
    ),
    -- Claim and select in one statement: a concurrent tick either inserts the marker or is
    -- skipped by the conflict, and only the winner gets a row back to broadcast on.
    claimed as (
      insert into athanor.fund_broadcast_sends (edition_id, kind, slot)
      select edition_id, kind, slot from due
      on conflict (edition_id, kind, slot) do nothing
      returning edition_id, kind, slot
    )
    select c.edition_id, c.kind, c.slot, d.template_key, d.days
      from claimed c
      join due d
        on d.edition_id = c.edition_id and d.kind = c.kind and d.slot = c.slot
  loop
    perform athanor.enqueue_audience_notification(
      'all_members',
      'fundMilestone',
      v_due.template_key,
      jsonb_build_object('days', v_due.days),
      jsonb_build_object('kind', 'fund', 'id', v_due.edition_id::text),
      'fund:' || v_due.edition_id::text || ':' || v_due.kind || ':' || v_due.slot
    );
  end loop;
end;
$$;

comment on function public.fund_countdown_sweep() is
  'Fund countdown broadcasts (#127): for the one non-closed cycle, enqueues an audience '
  'notification 7/3/1 days before target_at and 3/1 days before voting_ends_at, once per '
  '(cycle, window, slot) via athanor.fund_broadcast_sends. Bands are disjoint by construction, '
  'so a slot cannot double-fire on consecutive ticks. Cron-only (postgres ctx). Prunes 90-day-old '
  'markers every tick; claims nothing while fan-out is unconfigured.';

-- cron-only: not a client API
revoke execute on function public.fund_countdown_sweep() from public, anon, authenticated;

-- ── 4. schedule ──────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

-- Every 15 minutes, not every minute: the bands are days wide, so minute resolution buys nothing
-- and the marker makes a missed tick harmless — the next one inside the band still claims it.
select cron.schedule(
  'fund-countdown-sweep',
  '*/15 * * * *',
  $$ select public.fund_countdown_sweep() $$
);
