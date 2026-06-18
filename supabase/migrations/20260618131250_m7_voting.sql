-- M7 voting — Aura-weighted candidacy votes (backend 06 §2.5).
-- One vote per member per edition; weight = SERVER-written Aura snapshot (trigger).
-- Per-voter data never exposed (rule #3); voting awards ZERO Aura (rule #1).

-- ── 1. candidacy_votes table (OWN, server-written weight) ───────────────────────────
create table public.candidacy_votes (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.fund_editions (id) on delete cascade,
  candidacy_id uuid not null references public.dream_candidacies (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  weight numeric(6,3) not null default 0,   -- Aura snapshot — SERVER-written (trigger), never client
  created_at timestamptz not null default now()
);

comment on table public.candidacy_votes is
  'One vote per member per edition. weight = voter Aura snapshot, written server-side by trigger (client never sends it). Own-row read only; aggregates via candidacy_tally(). Zero Aura (rule #1).';

create unique index candidacy_votes_one_per_edition
  on public.candidacy_votes (edition_id, voter_id);   -- one vote per member per edition
create index candidacy_votes_tally
  on public.candidacy_votes (candidacy_id);

revoke all on table public.candidacy_votes from anon;
grant select, insert, delete on table public.candidacy_votes to authenticated;  -- no UPDATE grant
grant all on table public.candidacy_votes to service_role;

alter table public.candidacy_votes enable row level security;

create policy "candidacy_votes_select_own"
  on public.candidacy_votes for select
  to authenticated
  using ((select auth.uid()) = voter_id);

create policy "candidacy_votes_insert_own"
  on public.candidacy_votes for insert
  to authenticated
  with check ((select auth.uid()) = voter_id);
-- weight is NOT constrained in this WITH CHECK: the BEFORE-INSERT trigger overwrites it with the
-- server Aura snapshot, and RLS WITH CHECK runs AFTER the trigger — it could only ever see the
-- snapshot (e.g. 0.700), never the client's original value, so `weight = 0` here would reject
-- every Aura-holding voter. Client tampering is blocked in the trigger instead (it still sees the
-- ORIGINAL NEW.weight): a client-supplied non-zero weight raises 42501; the snapshot is authoritative.

create policy "candidacy_votes_delete_own"
  on public.candidacy_votes for delete
  to authenticated
  using ((select auth.uid()) = voter_id);
-- no UPDATE policy/grant: a vote is immutable; changing it = delete + insert.

-- ── 2. server-written weight trigger (DEFINER — reads aura_scores cross-RLS) ─────────
create function public.set_candidacy_vote_weight()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Tamper guard: the client must NOT supply a weight (column default is 0). We can still see the
  -- ORIGINAL submitted value here, before we overwrite it — this is where "client never sets weight"
  -- is enforced (a RLS WITH CHECK runs too late, after this trigger has rewritten the row).
  if new.weight is distinct from 0 then
    raise exception 'weight is server-written' using errcode = '42501';
  end if;
  new.weight := coalesce(
    (select s.score::numeric / 1000 from public.aura_scores s where s.profile_id = new.voter_id),
    0
  );  -- normalized 0–1 from the 0–1000 Aura (07); display weighting only, never awards points
  return new;
end;
$$;

revoke execute on function public.set_candidacy_vote_weight() from public, anon, authenticated;

create trigger candidacy_votes_set_weight
  before insert on public.candidacy_votes
  for each row execute function public.set_candidacy_vote_weight();

-- ── 3. public aggregate tally (DEFINER — reads ALL votes, returns aggregates only) ───
create function public.candidacy_tally(p_edition_id uuid)
returns table (candidacy_id uuid, vote_count bigint, weighted_total numeric)
language sql
security definer
set search_path = ''
stable
as $$
  select v.candidacy_id, count(*)::bigint, coalesce(sum(v.weight), 0)
  from public.candidacy_votes v
  where v.edition_id = p_edition_id
  group by v.candidacy_id;
$$;  -- aggregates only — never voter_id. % computed client-side: weighted_total / sum(weighted_total).

revoke execute on function public.candidacy_tally(uuid) from public, anon;
grant execute on function public.candidacy_tally(uuid) to authenticated;

-- ── 4. atomic cast/move RPC (INVOKER — RLS + weight trigger still apply) ─────────────
-- One vote per edition with MOVE semantics: delete any existing vote for (edition, voter),
-- then insert the new one in ONE transaction (no lost-vote window). Server-authoritative
-- eligibility: edition must be in the 'community' phase; candidacy must be votable in it.
create function public.cast_vote(p_edition_id uuid, p_candidacy_id uuid)
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
    where e.id = p_edition_id and e.phase = 'community'
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
  values (p_edition_id, p_candidacy_id, v_uid);   -- weight defaults 0 → RLS ok → trigger snapshots Aura
end;
$$;

revoke execute on function public.cast_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;

-- ── 5. fund_candidate_cards — candidate list read view (INVOKER) ─────────────────────
-- Title = the author's active dream text (dream_candidacies has no title column).
-- security_invoker so caller RLS on dream_candidacies (visible statuses) + dreams
-- (members-read) governs visibility — rejected/own-hidden candidacies + private dreams never leak.
create view public.fund_candidate_cards
with (security_invoker = true)
as
  select
    c.id          as candidacy_id,
    c.edition_id,
    c.profile_id,
    p.handle,
    d.text        as title,     -- author's active dream (left join → null if none)
    c.city,
    c.category,
    c.status,
    c.video_url,
    c.created_at
  from public.dream_candidacies c
  join public.profiles p on p.id = c.profile_id
  left join public.dreams d
    on d.profile_id = c.profile_id and d.status = 'active' and d.deleted_at is null
  where c.deleted_at is null;

revoke all on public.fund_candidate_cards from anon;
grant select on public.fund_candidate_cards to authenticated;

comment on view public.fund_candidate_cards is
  'Candidate cards: visible dream_candidacies + author handle + active dream text (title). security_invoker — underlying RLS governs visibility (rule #3).';
