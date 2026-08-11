-- Equal vote: every member's voice weighs the same (PRD §4.11 "Selection").
--
-- WHY. `set_candidacy_vote_weight` used to snapshot `aura_scores.score / 1000` into
-- candidacy_votes.weight, and `consensusPercent` prefers the weighted share whenever the
-- weighted denominator is non-zero. Three facts made that untenable once the vote became
-- DECISIVE rather than advisory:
--
--   1. No migration ever inserts an aura_scores row — the score-engine upserts it on the
--      first award — and the staging seed deliberately writes none. A member who has never
--      earned Aura has no row, so `coalesce(..., 0)` gave them weight 0: a vote that counts
--      for literally nothing, not merely less.
--   2. The client-side fallback is all-or-nothing per edition. The FIRST voter with any Aura
--      flips the whole tally into weighted mode and silently zeroes every other voter.
--   3. The weight was uncapped score/1000, so a score-1 member and a score-1000 member
--      differed by 1000x. At launch density one founder-tier voter would out-decide a cohort
--      of hundreds — "ATHANOR decides" wearing a costume, which the concept doc §5 disclaims.
--
-- This was also a time bomb rather than a live bug: every weight is 0 today because the Aura
-- engine is dormant, so the fallback yields the count share. The day the engine's Vault
-- secrets are set, the displayed consensus would have changed meaning with no code change,
-- no deploy and no signal. Hence a standalone fix, sequenced BEFORE that deploy.
--
-- WHAT CHANGES. The trigger writes a constant 1.000. Nothing else moves: the column, the
-- tamper guard, candidacy_tally's signature and consensusPercent all stay as they are, so
-- weighted_total now simply equals vote_count. Aura keeps a role in voting — it gates
-- ELIGIBILITY (who may cast a ballot) rather than WEIGHT (how much a ballot counts) — but
-- that floor cannot ship until the engine deploys, or it would lock out every member.
-- See docs/FUND-SPEC-AUDIT.md R-C and FUND-13.

create or replace function public.set_candidacy_vote_weight()
returns trigger
language plpgsql
security definer
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

-- `create or replace` preserves existing ACLs; re-issued for explicitness so the privilege
-- posture is readable in one place rather than inferred from the 2026-06-18 migration.
revoke execute on function public.set_candidacy_vote_weight() from public, anon, authenticated;
