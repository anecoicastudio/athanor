-- #221 — closure and rollover: end a cycle and open its successor in one transaction.
-- FUND-45 · decisions D33, D34, D35 (docs/FUND-DECISIONS.md) · FUND-SPEC §1 ("A cycle ends
-- in one of two ways"), §5 (deferred per-cycle declarations).
--
-- The two entry points, mirroring the #219/#220 pattern (atomic SQL transition, INVOKER,
-- service_role-only grant, refusals before any write, audit rows in the same transaction):
--
--   • close_cycle() — ends an open cycle from 'announcement'/'realization' with a declared
--     outcome and opens the successor in the same transaction. Two outcomes:
--       'realized' — the dream was delivered against its published plan; an admin act with
--         evidence (D26 publication), never a second community vote — the community chose
--         the dream, it cannot audit delivery. Candidacy statuses stay as they ended
--         (winner stays 'winner': the historical record of a delivered dream).
--       'realization_failed' — D33's post-tranche-one branch: «the realization is declared
--         failed», published with evidence. This is the fifth closure_reason value — the
--         #216 migration header deferred the vocabulary choice here, and a closure_reason
--         (not a realization-side state) is the choice: the failure ENDS the cycle, exactly
--         like the three voids, so it belongs in the same column the ticker and the §20
--         report already read. The CHECK widens by the established drop → re-add. The live
--         candidacy field (winner included) goes terminal 'voided', as on a decline.
--   • rollover_voided() — the missing half for the #220 voids: enter_announcement() and
--     record_winner_decision('decline') already close the cycle at its named end-state,
--     so for a voided predecessor only the successor remains to create. Refuses on a
--     predecessor that is not closed, not voided (realized/failed cycles roll over inside
--     close_cycle — a second rollover would carry the same money twice), already rolled
--     over, or while any cycle is open.
--
-- Carry arithmetic (D34/D35, FUND-SPEC §1) — no branch refunds contributors, no branch
-- drops money:
--
--     carried_in_{N+1} = greatest(carried_in_N + raised_N − disbursed_N, 0)
--
--   where raised_N is the live sum of succeeded contributions (rule 6: source rows, the
--   sum fund_aggregates caches) and disbursed_N is confirmed_pool_cents on 'realized'
--   (the winner is funded at the snapshot figure — D34: «that frozen figure», never
--   re-costed upward), the operator-supplied released amount on 'realization_failed'
--   (D33: the unreleased remainder carries; there is no tranche ledger yet — #228/#229
--   own realization plans, and tightening this parameter to a ledger read is theirs),
--   and 0 on any void (FUND-SPEC §1: «the whole pool carries into the successor»).
--   carried_in_N joins the sum because the #220 snapshot deliberately excludes it
--   (enter_announcement sums contributions only), so money carried into N was never part
--   of what the winner confirmed — at closure it must move on, not vanish.
--   The greatest(…, 0) clamp: a post-snapshot refund can sink raised_N below the
--   snapshot the winner was already promised; the shortfall is Athanor's to absorb
--   (contributors are refunded in no branch, and carried_in_cents is CHECKed >= 0).
--
-- The successor: phase 'candidacy', both windows shut, contributions disabled (the legal
-- flag stays an operator act, PRD §4.11), and every deferred declaration supplied by the
-- operator at this moment — the min_* trio and the declared economics are NOT NULL with
-- no default precisely so a cycle cannot open without someone choosing them (FUND-SPEC §5,
-- #232). Its fund_aggregates row is inserted at zero in the same transaction: the counter
-- resets on every rollover; carried_in_cents renders as a distinct amount, never folded
-- into raised_cents (FUND-45).
--
-- fund_editions_one_active (a partial unique index, enforced per row at write time, never
-- deferrable) is satisfied by ordering alone: the predecessor's UPDATE to 'closed' runs
-- before the successor's INSERT in both functions.
--
-- carried_from_edition_id records provenance and makes "one successor per predecessor"
-- a unique-index fact rather than a convention.
--
-- Zero Aura anywhere in this file (rule #1).

-- ── 1. closure_reason gains D33's post-tranche failure (drop → re-add) ──────────────────
alter table public.fund_editions drop constraint fund_editions_closure_reason_check;
alter table public.fund_editions
  add constraint fund_editions_closure_reason_check check (
    closure_reason in ('realized','voided_underfunded','voided_quorum','voided_declined',
                       'realization_failed')
  );

comment on column public.fund_editions.closure_reason is
  '#216/#221/D33: why the cycle closed — realized, voided below the FUND-42 floor / below the FUND-43 quorum / winner declined, or realization_failed (D33 post-tranche-one: declared failed with evidence, unreleased remainder carries forward). Present exactly when phase = ''closed'' (fund_editions_closure_reason_shape).';

-- ── 2. carried_from_edition_id — rollover provenance, one successor per predecessor ─────
alter table public.fund_editions
  add column carried_from_edition_id uuid references public.fund_editions (id);

create unique index fund_editions_one_rollover
  on public.fund_editions (carried_from_edition_id)
  where carried_from_edition_id is not null;

comment on column public.fund_editions.carried_from_edition_id is
  '#221/FUND-45: the predecessor cycle this one''s carried_in_cents moved from. NULL on a cycle opened from nothing. Unique where present (fund_editions_one_rollover): a predecessor rolls over exactly once.';

-- ── 3. audit_log: the closure actions (drop → re-add, the 20260815183252 pattern) ───────
-- 'close_cycle' — the closure declaration (reason text: outcome, evidence, the figures);
-- 'rollover_cycle' — the successor opened (edition_id is the SUCCESSOR; reason names the
-- predecessor and the carried amount). The #220 voids keep their 'void_cycle' rows.
alter table public.audit_log
  drop constraint audit_log_action_check,
  drop constraint audit_log_fund_shape;
alter table public.audit_log
  add constraint audit_log_action_check check (
    action in ('dismiss','warn','penalty','suspend','ban','declare_winner',
               'screen_start','screen_pass','screen_reject','screen_reopen',
               'announce','void_cycle','winner_confirm','winner_decline',
               'close_cycle','rollover_cycle')
  ),
  add constraint audit_log_fund_shape check (
    action not in ('declare_winner','screen_start','screen_pass','screen_reject','screen_reopen',
                   'announce','void_cycle','winner_confirm','winner_decline',
                   'close_cycle','rollover_cycle')
    or (edition_id is not null and report_id is null and penalty_points is null)
  );

-- ── 4. create_successor(): the shared rollover half ─────────────────────────────────────
-- Not an entry point (no grants beyond the two callers' own): inserts the successor row
-- and its zero aggregates row, writes the 'rollover_cycle' audit row, returns the new id.
-- Called with the predecessor already 'closed', so fund_editions_one_active accepts the
-- insert; a concurrent open cycle from elsewhere still violates the index (23505) and
-- rolls the whole transaction back — the belt under both callers' named refusals.
create function public.fund_rollover_successor(
  p_predecessor_id uuid,
  p_carried_in_cents bigint,
  p_target_at timestamptz,
  p_goal_cents bigint,
  p_min_funding_cents bigint,
  p_min_voters integer,
  p_min_candidacies integer,
  p_split_pct integer,
  p_cost_fee_statement text,
  p_equity_declared text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_successor_id uuid;
begin
  insert into public.fund_editions
    (target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
     min_funding_cents, min_voters, min_candidacies,
     split_pct, cost_fee_statement, equity_declared,
     carried_in_cents, carried_from_edition_id)
  values
    (p_target_at, p_goal_cents, 'candidacy', false, false,
     p_min_funding_cents, p_min_voters, p_min_candidacies,
     p_split_pct, p_cost_fee_statement, p_equity_declared,
     p_carried_in_cents, p_predecessor_id)
  returning id into v_successor_id;

  -- The counter resets: a fresh zero row (edition_id is the PK — FUND-SPEC §1's "reset"
  -- is this row, on every branch; the carry is the distinct carried_in_cents amount).
  insert into public.fund_aggregates (edition_id, raised_cents, contributor_count)
  values (v_successor_id, 0, 0);

  insert into public.audit_log (actor_id, action, edition_id, reason)
  values (null, 'rollover_cycle', v_successor_id,
          format('opened from %s, carried_in %s cents', p_predecessor_id, p_carried_in_cents));

  return v_successor_id;
end;
$$;

comment on function public.fund_rollover_successor(uuid, bigint, timestamptz, bigint, bigint, integer, integer, integer, text, text) is
  '#221/FUND-45: shared rollover half of close_cycle()/rollover_voided() — inserts the successor cycle (phase candidacy, windows shut, contributions disabled, operator-declared minimums and economics), its zero fund_aggregates row, and the rollover_cycle audit row. Not an entry point on its own.';

revoke execute on function public.fund_rollover_successor(uuid, bigint, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.fund_rollover_successor(uuid, bigint, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  to service_role;

-- ── 5. close_cycle(): realized / realization_failed, successor in the same transaction ──
-- Refusal order: identity → outcome vocabulary → phase → winner declared → viability
-- confirmed → evidence → released-amount shape. All refusals P0001 before any write.
create function public.close_cycle(
  p_edition_id uuid,
  p_outcome text,
  p_evidence text,
  p_released_cents bigint,
  p_target_at timestamptz,
  p_goal_cents bigint,
  p_min_funding_cents bigint,
  p_min_voters integer,
  p_min_candidacies integer,
  p_split_pct integer,
  p_cost_fee_statement text,
  p_equity_declared text
) returns table (successor_id uuid, closure_reason text, carried_in_cents bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
  v_raised bigint;
  v_disbursed bigint;
  v_carry bigint;
  v_successor uuid;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: two concurrent closures serialize here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if p_outcome not in ('realized','realization_failed') then
    raise exception 'unknown outcome' using errcode = 'P0001';
  end if;
  -- Only an announced-or-realizing cycle can be declared over: nothing enters
  -- 'realization' until #228's plan transition, so 'announcement' with a confirmed winner
  -- is the working window for cycle 1 (the runbook order: confirm → deliver → close).
  if v_edition.phase not in ('announcement','realization') then
    raise exception 'closure out of phase' using errcode = 'P0001';
  end if;
  if v_edition.winner_candidacy_id is null then
    raise exception 'no winner declared' using errcode = 'P0001';
  end if;
  -- Realization never began without the winner's confirmation (#220): a cycle whose
  -- winner declined already closed voided_declined; one that never answered has nothing
  -- to realize or to fail.
  if v_edition.winner_confirmed_at is null then
    raise exception 'viability not confirmed' using errcode = 'P0001';
  end if;
  -- The admin act carries its evidence (D26 publication, against the published plan —
  -- recorded as text here; the plan linkage tightens when #228/#229 give plans a table).
  if p_evidence is null or btrim(p_evidence) = '' then
    raise exception 'evidence required' using errcode = 'P0001';
  end if;
  if p_outcome = 'realized' then
    -- Realized disburses the snapshot figure by definition; a released amount would
    -- contradict it, so its presence is refused rather than ignored.
    if p_released_cents is not null then
      raise exception 'released not applicable' using errcode = 'P0001';
    end if;
    v_disbursed := v_edition.confirmed_pool_cents;
  else
    -- D33: the unreleased remainder carries. No tranche ledger exists yet (#228/#229),
    -- so the operator supplies what was actually released, bounded by the snapshot.
    if p_released_cents is null then
      raise exception 'released required' using errcode = 'P0001';
    end if;
    if p_released_cents < 0 or p_released_cents > v_edition.confirmed_pool_cents then
      raise exception 'released out of range' using errcode = 'P0001';
    end if;
    v_disbursed := p_released_cents;
  end if;

  -- rule 6: money truth from source rows; fund_aggregates is the derived cache.
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';
  v_carry := greatest(v_edition.carried_in_cents + v_raised - v_disbursed, 0);

  -- Close first: fund_editions_one_active frees the non-closed slot before the successor
  -- claims it. Same statement writes the reason (fund_editions_closure_reason_shape).
  update public.fund_editions e
     set phase = 'closed', closure_reason = p_outcome
   where e.id = p_edition_id;

  if p_outcome = 'realization_failed' then
    -- The failed cycle ends without a delivered dream: the live field, winner included,
    -- goes terminal 'voided' — the record_winner_decision decline set. On 'realized' the
    -- statuses stand as the historical record (the winner delivered).
    update public.dream_candidacies c
       set status = 'voided'
     where c.edition_id = p_edition_id
       and c.status in ('submitted','screening','shortlisted','winner');
  end if;

  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (null, 'close_cycle', p_edition_id, v_edition.winner_candidacy_id,
          format('%s: %s — raised %s cents, carried_in %s, disbursed %s, carry %s',
                 p_outcome, btrim(p_evidence), v_raised, v_edition.carried_in_cents,
                 v_disbursed, v_carry));

  v_successor := public.fund_rollover_successor(
    p_edition_id, v_carry, p_target_at, p_goal_cents,
    p_min_funding_cents, p_min_voters, p_min_candidacies,
    p_split_pct, p_cost_fee_statement, p_equity_declared);

  return query select v_successor, p_outcome, v_carry;
end;
$$;

comment on function public.close_cycle(uuid, text, text, bigint, timestamptz, bigint, bigint, integer, integer, integer, text, text) is
  'FUND-45/D33/D35 (#221): ends an open cycle (''realized'' — delivered against the published plan, an admin act with evidence; or ''realization_failed'' — D33''s post-tranche branch, operator supplies the released amount) and opens the successor in the same transaction with carried_in = greatest(carried_in + raised − disbursed, 0). Contributors are refunded in no branch. Refuses (P0001, no write) out of phase, without a declared+confirmed winner, without evidence, or on a malformed released amount. Service-role only. Zero Aura (rule #1).';

revoke execute on function public.close_cycle(uuid, text, text, bigint, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.close_cycle(uuid, text, text, bigint, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  to service_role;

-- ── 6. rollover_voided(): the successor for a cycle the #220 voids already closed ───────
create function public.rollover_voided(
  p_edition_id uuid,
  p_target_at timestamptz,
  p_goal_cents bigint,
  p_min_funding_cents bigint,
  p_min_voters integer,
  p_min_candidacies integer,
  p_split_pct integer,
  p_cost_fee_statement text,
  p_equity_declared text
) returns table (successor_id uuid, carried_in_cents bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
  v_raised bigint;
  v_carry bigint;
  v_successor uuid;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: two concurrent rollovers of the same predecessor serialize here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_edition.phase <> 'closed' then
    raise exception 'cycle not closed' using errcode = 'P0001';
  end if;
  -- Only the three #220 voids arrive here without a successor; realized and failed
  -- closures create theirs inside close_cycle — rolling one of those over again would
  -- carry the same money twice.
  if v_edition.closure_reason not in ('voided_underfunded','voided_quorum','voided_declined') then
    raise exception 'predecessor not voided' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.fund_editions s
              where s.carried_from_edition_id = p_edition_id) then
    raise exception 'already rolled over' using errcode = 'P0001';
  end if;
  -- Named refusal in front of the fund_editions_one_active 23505 belt.
  if exists (select 1 from public.fund_editions o where o.phase <> 'closed') then
    raise exception 'another cycle is open' using errcode = 'P0001';
  end if;

  -- The whole pool carries (FUND-SPEC §1): nothing was disbursed on a void.
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';
  v_carry := v_edition.carried_in_cents + v_raised;

  v_successor := public.fund_rollover_successor(
    p_edition_id, v_carry, p_target_at, p_goal_cents,
    p_min_funding_cents, p_min_voters, p_min_candidacies,
    p_split_pct, p_cost_fee_statement, p_equity_declared);

  return query select v_successor, v_carry;
end;
$$;

comment on function public.rollover_voided(uuid, timestamptz, bigint, bigint, integer, integer, integer, text, text) is
  'FUND-45 (#221): opens the successor of a cycle the #220 voids closed — carried_in = the predecessor''s whole pool (carried_in + raised; nothing was disbursed). Refuses (P0001, no write) on a predecessor not closed, not voided, already rolled over, or while any cycle is open. Service-role only. Zero Aura (rule #1).';

revoke execute on function public.rollover_voided(uuid, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.rollover_voided(uuid, timestamptz, bigint, bigint, integer, integer, integer, text, text)
  to service_role;
