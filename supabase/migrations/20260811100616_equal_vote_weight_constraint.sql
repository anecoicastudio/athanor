-- Equal vote, part 3: make the invariant an invariant.
--
-- 20260811091835 and 20260811094524 both claim pgTAP 0044 "turns this from a convention into an
-- enforced invariant". That overstated it, and the errata records the overstatement. What those
-- two migrations actually guarantee is the INSERT path: the BEFORE INSERT trigger writes 1.000 and
-- raises 42501 on a client-supplied weight. Nothing guarded UPDATE.
--
-- 20260618131250:25 grants `all` on candidacy_votes to service_role, which includes UPDATE, and no
-- UPDATE trigger exists. So a migration, an admin script, or an edge function holding the secret
-- key could still write a non-1.000 weight — and one such row is enough to do real damage, because
-- consensusPercent (packages/core/src/fund/consensus.ts) prefers the weighted share the moment
-- sumWeighted is non-zero. A single stray 0.5 flips the whole edition back into weighted mode and
-- zeroes every 1.000 ballot in the displayed consensus. That is precisely the failure this branch
-- exists to remove, reachable by accident rather than by design.
--
-- A table CHECK closes it. This is not a guard against a hostile service key — anything holding
-- that key can drop the constraint too — it is a guard against a mistake, which is the realistic
-- failure mode. Postgres evaluates a table CHECK *after* the BEFORE INSERT trigger has already
-- written 1.000, so the tamper guard's 42501 still fires first on a client-supplied weight and the
-- normal default-0 insert path still succeeds untouched.
--
-- Safe to add now: 20260811094524 backfilled every existing row, so validation passes on staging
-- (7 rows, all 1.000) and trivially on production and on any replay from zero (empty table).

alter table public.candidacy_votes
  add constraint candidacy_votes_weight_equal check (weight = 1.000);

comment on constraint candidacy_votes_weight_equal on public.candidacy_votes is
  'Equal vote (PRD §4.11): one member, one voice. Aura gates who may vote, never how much a vote '
  'counts. Revisiting weighting means dropping this constraint in a new migration — deliberately, '
  'not by a stray UPDATE.';
