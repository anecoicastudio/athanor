-- #217 — cast_vote enforces the ballot window; the ballot does not open under-provisioned.
-- FUND-15 (window), D7 tie order (docs/FUND-DECISIONS.md). Quorum (min_voters) is deliberately
-- NOT enforced here: it gates declaration (#219), so a below-quorum cycle still accepts votes —
-- it just cannot declare. No schema change; three function-level replacements.
--
-- "Screened candidacies" (FUND-15's ballot minimum): a literal 'screened' status does not exist
-- (statuses: submitted|screening|shortlisted|rejected|winner) and screening transitions are
-- #218's scope, unlanded. The gate therefore counts the VOTABLE set — status in
-- ('submitted','screening','shortlisted','winner'), not deleted — the same predicate cast_vote
-- applies per candidacy, i.e. what is actually on the ballot. When #218 lands and screening
-- moves statuses, this set converges on the screened set with no change here.

-- ── 1. cast_vote: the ballot window (FUND-15) ────────────────────────────────────────────
-- Body verbatim from 20260815075408 except the edition gate, which now also requires
-- now() ∈ [voting_starts_at, voting_ends_at] (closed interval). NULL bounds fail closed —
-- the SQL null-propagates to NOT TRUE, so a 'voting' cycle without a published window is
-- unvotable; the trigger below refuses to enter 'voting' in that state in the first place.
-- Security posture unchanged: invoker, locked search_path, grants preserved by CREATE OR REPLACE.
create or replace function public.cast_vote(p_edition_id uuid, p_candidacy_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.fund_editions e
    where e.id = p_edition_id and e.phase = 'voting'
      and now() >= e.voting_starts_at
      and now() <= e.voting_ends_at
  ) then
    raise exception 'voting closed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.dream_candidacies c
    where c.id = p_candidacy_id and c.edition_id = p_edition_id
      and c.deleted_at is null
      and c.status in ('submitted','screening','shortlisted','winner')
  ) then
    raise exception 'candidacy not votable' using errcode = 'P0001';
  end if;
  delete from public.candidacy_votes where voter_id = v_uid and edition_id = p_edition_id;
  insert into public.candidacy_votes (edition_id, candidacy_id, voter_id)
  values (p_edition_id, p_candidacy_id, v_uid);   -- weight defaults 0 → RLS ok → trigger snapshots the constant 1.000
end;
$$;

-- ── 2. entering 'voting' requires a declared window and the ballot minimum ───────────────
-- fund_editions is service-role write only, so this trigger only ever runs for privileged
-- writers — it is an integrity gate, not an access gate. INVOKER: service_role reads
-- dream_candidacies unrestricted; no definer privilege needed.
-- UPDATE-only, deliberately: the staging seed bootstraps its fake world by INSERTing the
-- edition already in 'voting' before its candidacies exist (seed-staging.sql §12). Every
-- real transition is an UPDATE.
create function public.fund_editions_ballot_open_check()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.voting_starts_at is null or new.voting_ends_at is null then
    raise exception 'ballot window not declared' using errcode = 'P0001';
  end if;
  if (
    select count(*)
    from public.dream_candidacies c
    where c.edition_id = new.id
      and c.deleted_at is null
      and c.status in ('submitted','screening','shortlisted','winner')
  ) < new.min_candidacies then
    raise exception 'ballot minimum not met' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.fund_editions_ballot_open_check() from public, anon, authenticated;

create trigger fund_editions_ballot_open
  before update of phase on public.fund_editions
  for each row
  when (new.phase = 'voting' and old.phase is distinct from 'voting')
  execute function public.fund_editions_ballot_open_check();

comment on trigger fund_editions_ballot_open on public.fund_editions is
  'FUND-15/#217: a cycle cannot enter voting without a declared ballot window and at least min_candidacies votable candidacies. Quorum (min_voters) is #219''s declaration gate, not this one.';

-- ── 3. candidacy_tally: deterministic D7 order — signature and posture unchanged ─────────
-- Ties break on raw distinct-voter count, then earliest submission (D7; the voting_ends_at
-- column comment declared this in 20260815075408). vote_count IS the raw distinct-voter
-- count — one vote per voter per edition (candidacy_votes_one_per_edition). created_at ties
-- (same-transaction inserts share now()) fall through to id for a stable order. DEFINER
-- rationale still holds (reads ALL votes cross-RLS, returns aggregates only — never
-- voter_id); grants preserved by CREATE OR REPLACE (authenticated only, from 20260618131250).
create or replace function public.candidacy_tally(p_edition_id uuid)
returns table (candidacy_id uuid, vote_count bigint, weighted_total numeric)
language sql
security definer
set search_path = ''
stable
as $$
  select v.candidacy_id, count(*)::bigint as vote_count, coalesce(sum(v.weight), 0)
  from public.candidacy_votes v
  join public.dream_candidacies c on c.id = v.candidacy_id
  where v.edition_id = p_edition_id
  group by v.candidacy_id, c.created_at, c.id
  order by vote_count desc, c.created_at asc, c.id asc
$$;
