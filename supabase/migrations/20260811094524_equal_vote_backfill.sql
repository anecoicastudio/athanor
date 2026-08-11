-- Equal vote, part 2: backfill the ballots already cast, fix the live table comment, and drop a
-- privilege the trigger no longer needs.
--
-- WHY A SECOND MIGRATION. 20260811091835 changed the trigger going forward, and by the time the
-- gap below was found it was already recorded in staging's schema_migrations. Editing it would
-- have reached only fresh CI databases — the one environment that was already correct — while
-- leaving the rows that actually needed fixing untouched. (Rule #7 forbids the edit regardless.)
--
-- THE GAP. Weight was written at INSERT time, so existing ballots keep whatever the old
-- Aura-snapshot trigger gave them. On staging that is seven votes at 0.000 against fourteen
-- profiles, three of which hold an aura_scores row. Without this backfill the tally there would
-- go MIXED after the trigger change — old ballots at 0, new at 1 — which is worse than uniform
-- zero, because it disenfranchises specifically the earliest voters and every QA pass would
-- render a wrong consensus number.
--
-- Correcting the record on 20260811091835's header, which called this a dormant-engine "time
-- bomb": the Aura engine is live on both projects (8 Vault secrets, 5 cron jobs including
-- aura-nightly-decay). Staging has already produced three aura_events. With the active edition in
-- the community phase and all three scored members yet to vote, the first of them to cast a
-- ballot would have taken 100% of the displayed consensus while the other seven read 0% —
-- consensusPercent switches to the weighted share the moment sumWeighted is non-zero. One vote
-- away, not one deploy away. Logged in supabase/MIGRATIONS-ERRATA.md.

-- ── 1. backfill ───────────────────────────────────────────────────────────────────────
-- Idempotent and self-limiting: seven rows on staging, zero on production (replayed from zero on
-- 2026-08-10, no votes), zero on a fresh CI database (the trigger has written 1.000 from the
-- first insert). Deliberately NOT restricted to an edition — every ballot ever cast weighs the
-- same, including those on closed cycles, so the invariant in pgTAP 0044 holds table-wide.
update public.candidacy_votes
   set weight = 1.000
 where weight is distinct from 1.000;

-- ── 2. the live table comment still described Aura weighting ──────────────────────────
-- Set by 20260618131250:15-16 and live on staging AND production, describing exactly the
-- behaviour the previous migration removed. `comment on` is idempotent DDL, so unlike the file
-- prose in that migration this one can simply be corrected.
comment on table public.candidacy_votes is
  'One vote per member per edition. weight is always 1.000 — equal vote (PRD §4.11): Aura gates '
  'who may vote, never how much a vote counts. Server-written by trigger (client never sends it). '
  'Own-row read only; aggregates via candidacy_tally(). Zero Aura (rule #1).';

-- ── 3. security definer is no longer justified ────────────────────────────────────────
-- 20260618131250:50 stated the rationale explicitly — "DEFINER — reads aura_scores cross-RLS".
-- The body no longer reads anything: it assigns a constant. supabase.md allows definer "only when
-- genuinely required", so this reverts to invoker. Low risk either way (execute is revoked from
-- every client role and the function is reachable only as a BEFORE INSERT trigger), but it means
-- that if a table read is ever added back it will be RLS-constrained by default rather than
-- silently privileged. search_path stays locked; no pgTAP asserts prosecdef for this function.
create or replace function public.set_candidacy_vote_weight()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Tamper guard, unchanged: the client must NOT supply a weight (column default is 0). We can
  -- still see the ORIGINAL submitted value here, before we overwrite it — this is where
  -- "client never sets weight" is enforced (a RLS WITH CHECK runs too late, after this trigger
  -- has already rewritten the row).
  if new.weight is distinct from 0 then
    raise exception 'weight is server-written' using errcode = '42501';
  end if;

  -- Equal vote: one member, one voice. Deliberately NOT read from aura_scores. The column is
  -- kept (rather than dropped) so the tamper guard above and the tally's shape survive; pgTAP
  -- 0044 asserts every stored weight is exactly 1.000, which turns this from a convention into
  -- an enforced invariant.
  new.weight := 1.000;
  return new;
end;
$$;

comment on function public.set_candidacy_vote_weight() is
  'Writes the server-side vote weight. Constant 1.000 — equal vote (PRD §4.11). Aura gates who '
  'may vote, never how much a vote counts. Also the tamper guard for client-supplied weights.';

-- `create or replace` preserves both the OID (so the existing candidacy_votes_set_weight trigger
-- keeps binding) and the ACLs. Re-issued so the privilege posture is readable in one place.
revoke execute on function public.set_candidacy_vote_weight() from public, anon, authenticated;
