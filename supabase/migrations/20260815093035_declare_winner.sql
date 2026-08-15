-- #219 — declare_winner: one atomic service-role path that can refuse.
-- FUND-12, FUND-16, FUND-42, FUND-43 · decision D9 (docs/FUND-DECISIONS.md).
-- Three parts: (1) audit_log grows a fund shape — its moderation-only columns cannot record
-- a winner declaration as built; (2) a partial unique index makes "at most one winner per
-- cycle" (FUND-12) a database invariant, not a function's good intention; (3) the
-- declare_winner() function — both writes in one transaction, refusals before any write.
-- Quorum (min_voters) and the funding floor (min_funding_cents) gate HERE, deliberately not
-- in cast_vote (#217, see 20260815090015): a below-quorum cycle still accepts votes — it
-- just cannot declare.

-- ── 1. audit_log: from moderation-only to moderation + fund ─────────────────────────────
-- As created (20260622142242) every column was moderation-shaped: report_id NOT NULL → a
-- winner declaration has no report; actor_id NOT NULL → declare-winner is an internal
-- service-role function with no user (rule 8 — profile_id from nowhere); action was a
-- closed five-verb moderation enum. Relax each, then pin the old tightness back per-action
-- with CHECKs, so a moderation row is exactly as constrained as before.
alter table public.audit_log
  alter column report_id drop not null,
  alter column actor_id drop not null;

alter table public.audit_log
  add column edition_id uuid references public.fund_editions (id),
  add column candidacy_id uuid references public.dream_candidacies (id) on delete set null;
-- candidacy_id is SET NULL, not restrict: a GDPR hard-delete of the winner's profile
-- cascades away their candidacy (dream_candidacies.profile_id → profiles ON DELETE CASCADE),
-- and an audit row must never block an erasure. fund_editions rows are never deleted; the
-- plain FK stands. For the same reason the fund-shape CHECK below must NOT require
-- candidacy_id — ON DELETE SET NULL re-checks constraints, so requiring it would turn an
-- erasure into a constraint violation.

alter table public.audit_log
  drop constraint audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check check (
    action in ('dismiss','warn','penalty','suspend','ban','declare_winner')
  ),
  add constraint audit_log_moderation_shape check (
    action not in ('dismiss','warn','penalty','suspend','ban')
    or (report_id is not null and actor_id is not null)
  ),
  add constraint audit_log_fund_shape check (
    action <> 'declare_winner'
    or (edition_id is not null and report_id is null and penalty_points is null)
  );

create index audit_log_edition on public.audit_log (edition_id, created_at desc)
  where edition_id is not null;

comment on table public.audit_log is
  'Append-only audit. Moderation rows written only by resolve_report (DEFINER); fund rows (declare_winner) written only by declare_winner() as service_role. Admin-read only (athanor.is_admin). Zero Aura (rule #1).';

-- ── 2. FUND-12 as an index: at most one winner per cycle ────────────────────────────────
-- Unconditional on deleted_at on purpose: a soft-deleted winner still selected this cycle's
-- dream — FUND-44 voids the cycle when a winner falls away, it never re-runs the ballot.
create unique index dream_candidacies_one_winner_per_edition
  on public.dream_candidacies (edition_id) where status = 'winner';

-- ── 3. declare_winner(): both writes or neither, refusals touch nothing ─────────────────
-- INVOKER, not DEFINER: the only granted caller is service_role (the declare-winner edge
-- function), which already reads and writes every table involved. Refusal order: identity →
-- already-declared → phase → ballot closed → quorum (FUND-43) → floor (FUND-42) — every
-- refusal raises BEFORE the first write, so a refused call leaves both columns untouched.
-- The winner is the top ELIGIBLE row of candidacy_tally() — consumed WITH ORDINALITY so
-- #217's D7 tie order (vote_count desc, created_at asc, id asc) is read from the one place
-- it is defined, never re-derived here. Returns the full ballot ordering (aggregates only —
-- candidacy_tally never exposes voter_id, rule #3), because FUND-38's published «risultati»
-- come from this declaration (D9).
create function public.declare_winner(p_edition_id uuid)
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
  -- NULL bounds fail closed, as in cast_vote: an undeclared window cannot close.
  if not (now() > v_edition.voting_ends_at) then
    raise exception 'ballot not closed' using errcode = 'P0001';
  end if;

  -- FUND-43 quorum. count(*) would equal count(distinct) under candidacy_votes_one_per_edition;
  -- distinct states the rule being enforced.
  select count(distinct v.voter_id) into v_voters
    from public.candidacy_votes v where v.edition_id = p_edition_id;
  if v_voters < v_edition.min_voters then
    raise exception 'quorum not met' using errcode = 'P0001';
  end if;

  -- FUND-42 funding floor, from source rows (rule 6: fund_aggregates is a derived cache).
  select coalesce(sum(c.amount_cents), 0) into v_raised
    from public.fund_contributions c
   where c.edition_id = p_edition_id and c.status = 'succeeded';
  if v_raised < v_edition.min_funding_cents then
    raise exception 'funding floor not met' using errcode = 'P0001';
  end if;

  -- Top eligible ballot row. Eligible = still on the ballot: not soft-deleted, not rejected.
  -- 'winner' is excluded from eligibility (a re-declaration cannot land) but the
  -- already-declared refusal above fires first in every reachable path.
  select t.candidacy_id into v_winner
    from public.candidacy_tally(p_edition_id) with ordinality as t(candidacy_id, vote_count, weighted_total, rank)
    join public.dream_candidacies c on c.id = t.candidacy_id
   where c.deleted_at is null and c.status in ('submitted','screening','shortlisted')
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

comment on function public.declare_winner(uuid) is
  'FUND-16/D9 (#219): declares the cycle''s winner — fund_editions.winner_candidacy_id + dream_candidacies.status + audit_log in ONE transaction. Refuses (P0001, no write) below min_voters (FUND-43) or min_funding_cents (FUND-42), out of phase, before ballot close, or on re-declaration. Service-role only.';

revoke execute on function public.declare_winner(uuid) from public, anon, authenticated;
grant execute on function public.declare_winner(uuid) to service_role;

-- candidacy_tally was granted to authenticated only (20260618131250 revoked PUBLIC);
-- declare_winner runs as service_role and calls it, so the grant must exist explicitly.
grant execute on function public.candidacy_tally(uuid) to service_role;
