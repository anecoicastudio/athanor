-- #219 — declare_winner: the ballot-window gate must FAIL CLOSED on a NULL voting_ends_at.
-- 20260815093035 wrote `if not (now() > voting_ends_at)` and claimed NULL bounds fail closed.
-- They do not: `now() > NULL` is NULL, `not NULL` is NULL, and plpgsql IF treats NULL as
-- false — so an edition with an UNDECLARED window sailed PAST the gate (caught by a staging
-- smoke: the refusal came back 'funding floor not met', two gates deeper than it should
-- have reached). cast_vote's shape survives NULL because its NULL lands inside a WHERE that
-- then fails an EXISTS; an IF needs the null arm spelled out. See MIGRATIONS-ERRATA.md;
-- pgTAP 0103 now asserts both window refusals. Body otherwise verbatim from 20260815093035
-- (invoker, locked search_path; grants preserved by CREATE OR REPLACE).
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
