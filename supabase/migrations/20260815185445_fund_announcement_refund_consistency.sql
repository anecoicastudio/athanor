-- #220 — the pool does NOT only grow, and both announcement-family functions must survive
-- that. 20260815183252's header claimed "voters are fixed once the ballot closes and the
-- pool only grows"; the second half is false — reverseContribution
-- (stripe-webhook/handlers.ts, charge.refunded / dispute) flips a fund_contributions row
-- from 'succeeded' to 'refunded' at any moment, with no phase gate, so a live-sum floor
-- comparison can fail AFTER an earlier one passed (caught by athanor-reviewer on the #220
-- diff; see MIGRATIONS-ERRATA.md). Two consequences, one fix each, bodies otherwise
-- verbatim (the 20260815094157 precedent — invoker, locked search_path; grants preserved
-- by CREATE OR REPLACE):
--
--   1. enter_announcement — in the declare-then-enter order the runbook sanctions, a
--      refund can drag the pool below the floor after declare_winner() already wrote a
--      'winner' row. The void branch only reassigned ('submitted','screening',
--      'shortlisted'), so a voided cycle could retain a live 'winner' candidacy. The
--      filter now includes 'winner' — the same terminal set record_winner_decision's
--      decline path uses; fund_editions.winner_candidacy_id deliberately keeps the
--      historical record, as on a decline.
--
--   2. declare_winner — in the enter-then-declare order, a refund landing after the
--      snapshot made its live-sum floor check refuse a cycle the entry gate had already
--      passed, stranding an announced cycle with no declarable winner and no void path.
--      D34 is explicit: «that frozen figure is what FUND-42's floor is evaluated
--      against» — so once confirmed_pool_cents exists, the floor reads it; before the
--      snapshot, source rows as ever (rule 6: fund_aggregates is a derived cache).
--      Quorum keeps its live count: votes have no reversal path (cast_vote is sealed
--      outside 'voting'), so turnout genuinely is fixed at ballot close.
--
-- pgTAP 0109 editions 5 and 6 walk both refund orders. Zero Aura (rule #1).

-- ── 1. enter_announcement: the void reaches a pre-declared winner ───────────────────────
create or replace function public.enter_announcement(p_edition_id uuid)
returns table (outcome text, pool_cents bigint, voters integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
  v_voters integer;
  v_raised bigint;
  v_reason text;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: a concurrent entry or declaration serializes here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  -- Only from 'voting'. This is also the snapshot's write-once guarantee at the function
  -- level: a cycle already in 'announcement' cannot re-enter and re-snapshot (the freeze
  -- trigger is the belt under it).
  if v_edition.phase <> 'voting' then
    raise exception 'announcement out of phase' using errcode = 'P0001';
  end if;
  -- An undeclared window cannot close; the NULL arm is explicit because IF NULL is false.
  if v_edition.voting_ends_at is null or now() <= v_edition.voting_ends_at then
    raise exception 'ballot not closed' using errcode = 'P0001';
  end if;

  select count(distinct v.voter_id) into v_voters
    from public.candidacy_votes v where v.edition_id = p_edition_id;
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';

  if v_voters < v_edition.min_voters then
    v_reason := 'voided_quorum';
  elsif v_raised < v_edition.min_funding_cents then
    v_reason := 'voided_underfunded';
  end if;

  if v_reason is not null then
    -- The void: named end-state, published reason, funds carry forward at #221's rollover.
    -- The counter does not reset (FUND-SPEC §1: only realization resets it). 'winner' is
    -- reachable here — declare_winner() may legally have run during 'voting', and a refund
    -- since then can have sunk the pool — so the whole live field goes terminal 'voided',
    -- the same set the decline path voids. winner_candidacy_id stays: it is the historical
    -- record of who was declared, exactly as on a decline.
    update public.fund_editions e
       set phase = 'closed', closure_reason = v_reason
     where e.id = p_edition_id;
    update public.dream_candidacies c
       set status = 'voided'
     where c.edition_id = p_edition_id
       and c.status in ('submitted','screening','shortlisted','winner');
    insert into public.audit_log (actor_id, action, edition_id, reason)
    values (null, 'void_cycle', p_edition_id,
            format('%s: distinct voters %s (min %s), pool %s cents (min %s)',
                   v_reason, v_voters, v_edition.min_voters, v_raised, v_edition.min_funding_cents));
    return query select v_reason, v_raised, v_voters;
    return;
  end if;

  -- The snapshot: phase and figure in one statement, so fund_editions_snapshot_presence
  -- can never observe 'announcement' without it.
  update public.fund_editions e
     set phase = 'announcement', confirmed_pool_cents = v_raised
   where e.id = p_edition_id;
  insert into public.audit_log (actor_id, action, edition_id, reason)
  values (null, 'announce', p_edition_id,
          format('snapshot %s cents (floor %s), distinct voters %s (min %s)',
                 v_raised, v_edition.min_funding_cents, v_voters, v_edition.min_voters));
  return query select 'announced'::text, v_raised, v_voters;
end;
$$;

-- ── 2. declare_winner: the floor reads the snapshot once one exists (D34) ───────────────
create or replace function public.declare_winner(p_edition_id uuid)
returns table (candidacy_id uuid, vote_count bigint, weighted_total numeric, is_winner boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_edition public.fund_editions%rowtype;
  v_winner uuid;
  v_voters integer;
  v_raised bigint;
begin
  select * into v_edition from public.fund_editions e
   where e.id = p_edition_id
   for update;   -- row lock: two concurrent declarations serialize here
  if not found then
    raise exception 'edition not found' using errcode = 'P0001';
  end if;
  if v_edition.winner_candidacy_id is not null then
    raise exception 'winner already declared' using errcode = 'P0001';
  end if;
  if v_edition.phase not in ('voting', 'announcement') then
    raise exception 'declaration out of phase' using errcode = 'P0001';
  end if;
  -- An undeclared window cannot close; the NULL arm is explicit because IF NULL is false.
  if v_edition.voting_ends_at is null or now() <= v_edition.voting_ends_at then
    raise exception 'ballot not closed' using errcode = 'P0001';
  end if;

  -- FUND-43 quorum. count(*) would equal count(distinct) under candidacy_votes_one_per_edition;
  -- distinct states the rule being enforced. Live on purpose: votes have no reversal path,
  -- so turnout is genuinely fixed at ballot close.
  select count(distinct v.voter_id) into v_voters
    from public.candidacy_votes v where v.edition_id = p_edition_id;
  if v_voters < v_edition.min_voters then
    raise exception 'quorum not met' using errcode = 'P0001';
  end if;

  -- FUND-42 funding floor. Once the announcement snapshot exists it is the basis (D34:
  -- the frozen figure is what the floor is evaluated against) — a refund landing after
  -- the snapshot must not strand an announced cycle behind a floor it already cleared.
  -- Before the snapshot: source rows as ever (rule 6: fund_aggregates is a derived cache).
  if v_edition.confirmed_pool_cents is not null then
    v_raised := v_edition.confirmed_pool_cents;
  else
    select coalesce(sum(c.amount_cents), 0) into v_raised
      from public.fund_contributions c
     where c.edition_id = p_edition_id and c.status = 'succeeded';
  end if;
  if v_raised < v_edition.min_funding_cents then
    raise exception 'funding floor not met' using errcode = 'P0001';
  end if;

  -- Top eligible ballot row: on the ballot, minus the deliberate exception — 'winner'
  -- cannot win again (#383; the already-declared refusal above fires first anyway).
  select t.candidacy_id into v_winner
    from public.candidacy_tally(p_edition_id) with ordinality as t(candidacy_id, vote_count, weighted_total, rank)
    join public.dream_candidacies c on c.id = t.candidacy_id
   where public.is_on_ballot(c) and c.status <> 'winner'
   order by t.rank
   limit 1;
  if v_winner is null then
    raise exception 'no votable candidacy' using errcode = 'P0001';
  end if;

  -- The atomic pair + the audit row — one transaction, so a failure in any statement
  -- (e.g. the one-winner index) rolls back all three. Edition first: pgTAP 0103 forces the
  -- candidacy write to fail and asserts the edition write did not survive it.
  update public.fund_editions e
     set winner_candidacy_id = v_winner
   where e.id = p_edition_id;
  update public.dream_candidacies c
     set status = 'winner'
   where c.id = v_winner;
  insert into public.audit_log (actor_id, action, edition_id, candidacy_id, reason)
  values (null, 'declare_winner', p_edition_id, v_winner,
          format('distinct voters %s (min %s), pool %s cents (min %s)',
                 v_voters, v_edition.min_voters, v_raised, v_edition.min_funding_cents));

  -- FUND-38/D9: the full ballot ordering, winner flagged. Aggregates only (rule #3).
  return query
    select t.candidacy_id, t.vote_count, t.weighted_total, t.candidacy_id = v_winner
      from public.candidacy_tally(p_edition_id) with ordinality
             as t(candidacy_id, vote_count, weighted_total, rank)
     order by t.rank;
end;
$$;
