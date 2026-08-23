-- #127 follow-up — two producer defects found in review of 20260823121934.
--
-- ── 1. The milestone trigger could never fire for cycle one's first contribution ────────────
--
-- 20260823121934 bound the trigger AFTER UPDATE only, on the assumption that fund_aggregates is
-- updated. Its sole writer, public.recompute_fund_aggregate() (20260618153032, current body
-- 20260815131925:142-155), is an UPSERT: `insert … on conflict (edition_id) do update`. A
-- fund_aggregates row is pre-created only for a ROLLOVER successor cycle (20260815193158:146);
-- nothing bootstraps one for the first cycle of all, and no seed inserts one.
--
-- So on cycle one the first settled contribution takes the INSERT branch and the trigger never
-- runs. Any threshold that first contribution already clears is then announced NEVER — not late,
-- never — because the crossing test compares against the previous row, and after that the total
-- only grows. A single €250 first gift against a €1.000 goal silently swallows the 25 % moment,
-- and the only way back is a refund below the line and a re-crossing.
--
-- Fixed by binding AFTER INSERT as well and treating an absent previous row as zero, which is
-- what it means: before the row existed, nothing had been raised. TG_OP is what distinguishes
-- them — OLD is not merely zero on INSERT, it is unbound, so `old.raised_cents` cannot be read.
--
-- ── 2. The ballot countdown could tell people to vote when voting is impossible ─────────────
--
-- The `due` CTE filtered on `e.phase <> 'closed'` alone. But voting_ends_at is DECLARED before
-- the cycle enters 'voting' — fund_editions_ballot_open_check (20260815090015:60) requires the
-- window to exist as a precondition of opening the ballot — so a cycle sitting in 'candidacy' or
-- 'screening' with a short declared window matches the d3/d1 bands and broadcasts «Il voto
-- chiude domani. Se non hai ancora votato, è il momento.» to every member while cast_vote
-- rejects all of them. Telling the whole community to do something the app forbids is a worse
-- failure than saying nothing, and it is unrecoverable: the marker is claimed, so the real
-- warning never goes out either.
--
-- The ballot rows now require phase = 'voting'. The announcement rows keep the looser predicate
-- deliberately: an announcement countdown is an invitation to watch, not to act, so it stays
-- true in any phase that still leads to that announcement.

create or replace function public.on_fund_aggregate_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_thresholds constant integer[] := array[25, 50, 75, 100];
  -- An absent previous row means nothing had been raised yet. OLD is unbound on INSERT, so this
  -- must be decided from TG_OP rather than by reading old.raised_cents and coalescing.
  v_old  bigint := case when tg_op = 'INSERT' then 0 else old.raised_cents end;
  v_goal bigint;
  v_id   uuid;
  v_pct  integer;
begin
  -- Only meaningful on UPDATE: an INSERT is by definition a change from nothing.
  if tg_op = 'UPDATE' and new.raised_cents is not distinct from old.raised_cents then
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
    -- Crossed on THIS write: below before, at-or-above now. A refund that drops the total back
    -- under and a later contribution that re-crosses would enqueue again; notifications.dedupe_key
    -- absorbs that, which is why this needs no marker table of its own.
    if v_old * 100 < v_goal * v_pct
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
  'Fund milestone broadcasts (#127): AFTER INSERT OR UPDATE on fund_aggregates, enqueues one '
  'audience notification per 25/50/75/100 % threshold crossed by this write. INSERT counts as a '
  'crossing from zero — recompute_fund_aggregate() is an upsert, so cycle one''s first '
  'contribution creates the row rather than updating it. READS the money cache and never writes '
  'it (rule 6). DEFINER to reach athanor.enqueue_audience_notification; search_path locked; '
  'execute revoked (trigger-only).';

-- Rebind: the old trigger is UPDATE-only, and a trigger''s event list cannot be altered in place.
drop trigger fund_aggregates_milestone_broadcast on public.fund_aggregates;

create trigger fund_aggregates_milestone_broadcast
  after insert or update on public.fund_aggregates
  for each row execute function public.on_fund_aggregate_milestone();

-- The revoke does not survive `create or replace`ing a function that already had it, but state
-- it again rather than rely on that: 0121 asserts no trigger function is executable by a client
-- role, and this is cheaper than the reader having to know which way it goes.
revoke execute on function public.on_fund_aggregate_milestone() from public, anon, authenticated;

-- ── the countdown sweep, with the ballot gated on an open ballot ─────────────────────────────
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
            -- Announcement: the cycle's own target_at. 7/3/1. Applies in any non-closed phase —
            -- an announcement countdown invites you to watch, which stays true throughout.
            ('announce'::text, 'd7'::text, e.target_at,
             'notif.tpl.fundAnnounceCountdown'::text, 7, true),
            ('announce'::text, 'd3'::text, e.target_at,
             'notif.tpl.fundAnnounceCountdown'::text, 3, true),
            ('announce'::text, 'd1'::text, e.target_at,
             'notif.tpl.fundAnnounceLastDay'::text,  1, true),
            -- Ballot close: 3/1, and ONLY while the ballot is actually open. The window is
            -- declared before 'voting' is entered (fund_editions_ballot_open_check), so without
            -- this predicate a cycle in candidacy/screening would tell everyone to vote while
            -- cast_vote refuses them.
            ('ballot'::text,   'd3'::text, e.voting_ends_at,
             'notif.tpl.fundBallotCountdown'::text, 3, e.phase = 'voting'),
            ('ballot'::text,   'd1'::text, e.voting_ends_at,
             'notif.tpl.fundBallotLastDay'::text,   1, e.phase = 'voting')
          ) as s(kind, slot, at, template_key, days, applies)
       -- Only the one non-closed cycle (fund_editions_one_active, D2). A closed cycle counts
       -- down to nothing.
       where e.phase <> 'closed'
         and s.applies
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
  'notification 7/3/1 days before target_at, and 3/1 days before voting_ends_at while the cycle '
  'is in ''voting'' — the ballot slots are gated on an open ballot so nobody is told to vote '
  'while cast_vote would refuse them. Once per (cycle, window, slot) via '
  'athanor.fund_broadcast_sends. Bands are disjoint by construction. Cron-only (postgres ctx). '
  'Prunes 90-day-old markers every tick; claims nothing while fan-out is unconfigured.';

revoke execute on function public.fund_countdown_sweep() from public, anon, authenticated;
