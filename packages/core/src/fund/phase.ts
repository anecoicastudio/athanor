import { fundPhaseSchema, type FundEdition, type FundPhase } from '@athanor/schemas';

/**
 * The fund cycle's rulebook (#382): one place that answers «is the ballot open», «may this
 * contribution be accepted», «may a candidacy be submitted», «may a winner be declared».
 *
 * These rules ALREADY existed — three times for the ballot window (`cast_vote`, the ballot-open
 * trigger, `declare_winner`) and four times for the phase vocabulary (the CHECK constraint, the
 * zod enum, the edge function's literal, `PhaseList`). SQL remains the enforcer: nothing here
 * gates anything, and every predicate below is re-asserted server-side. What this module buys is
 * that the CLIENT stops guessing — `annual.tsx` derived ballot openness from the phase alone and
 * never read the window it had already fetched, so a `voting` cycle outside its window rendered
 * «Vota», `cast_vote` raised `P0001 'voting closed'`, and nothing reached the member.
 *
 * Pure, clock injected (core rule: no inline `Date.now()`). Every function takes the narrowest
 * `Pick` of `FundEdition` it actually reads, so a caller cannot pass the wrong row shape and a
 * test fixture stays three fields wide.
 *
 * **Fail closed, always.** A missing or unparseable bound is an UNDECLARED window, never an open
 * one. That is not defensiveness for its own sake: the predecessor of
 * `20260815094157_declare_winner_window_fail_closed.sql` wrote `if not (now() > voting_ends_at)`
 * and sailed straight past on a NULL, because plpgsql treats `IF NULL` as false
 * (`supabase/MIGRATIONS-ERRATA.md`). Staging then sat in `phase = 'voting'` with both bounds NULL
 * for real (#414). The trap is live on both sides of the boundary, so the TypeScript side spells
 * its null arm out exactly as the SQL had to.
 */

/** The six phases of the cycle, in order — the zod enum itself, never a second list. */
export const FUND_PHASES: readonly FundPhase[] = fundPhaseSchema.options;

/**
 * Phases that render as a step in the cycle trail (`PhaseList`) — every phase but the terminal
 * one, because a closed cycle is not a step someone is standing on.
 */
export const OPEN_CYCLE_PHASES: readonly FundPhase[] = FUND_PHASES.filter((p) => p !== 'closed');

/**
 * Phases that accept contributions (D34 / PRD §4.11): from cycle open through closure,
 * realization included — post-snapshot money lands in the same cycle and carries forward.
 *
 * Its own filter rather than an alias of `OPEN_CYCLE_PHASES`, even though the two sets are
 * currently identical: «where money is accepted» and «what the trail draws» are two rules that
 * agree today, and writing one as the other would make narrowing D34 silently redraw the trail.
 * Both derive from the enum, so neither can drift from the vocabulary — which is the duplication
 * that actually cost something (#382).
 *
 * `supabase/functions/create-contribution-session/logic.ts` carries the same five values BY
 * VALUE: it is outside the pnpm workspace and cannot import this. A mirror test there reads the
 * zod enum off disk and fails if the two drift (the `config-invariants` idiom).
 */
export const CONTRIBUTION_PHASES: readonly FundPhase[] = FUND_PHASES.filter((p) => p !== 'closed');

/**
 * Why the ballot is or is not accepting votes. `open` is the only state that votes; the other
 * four name the refusal, in the same order `cast_vote` and the ballot-open trigger apply them,
 * so a surface that wants «il voto apre il 3 marzo» rather than «voto chiuso» already has the
 * distinction it needs.
 */
export type BallotState =
  | 'open'
  | 'outOfPhase'
  | 'windowUndeclared'
  | 'beforeWindow'
  | 'afterWindow';

export type BallotEdition = Pick<FundEdition, 'phase' | 'voting_starts_at' | 'voting_ends_at'>;

/**
 * Parse a timestamptz string into an instant, or `null` if it does not name one.
 *
 * An absent bound and a garbled bound collapse to the same answer deliberately: neither one
 * declares a window, and `Date.parse` returning NaN would otherwise make every comparison
 * silently false — which is exactly the shape of the plpgsql trap, a gate that lets everything
 * through while looking like it checks something.
 *
 * The null guard is an **equivalent mutant** for Stryker (`if (false) return null` survives) and
 * is not a missing test. It is there because `Date.parse` takes a `string`, so the type system
 * requires it; behaviourally it cannot be distinguished, because `Date.parse(null)` stringifies
 * to `'null'` and yields NaN, which the finite check below already turns into the same `null`.
 * No input separates the two, so a test that killed it would be asserting a coercion rather than
 * a rule. Do not remove the guard to chase the mutant: relying on that coercion is precisely the
 * accidental correctness this module refuses everywhere else.
 */
function instant(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The ballot window (FUND-15), mirroring `cast_vote`
 * (`20260815090015_cast_vote_window.sql:31-38`): phase `voting`, and `now` within
 * `[voting_starts_at, voting_ends_at]` — a CLOSED interval on both ends, so the first and last
 * millisecond both vote.
 *
 * The phase is read before the window, matching the SQL's own order, so a cycle in
 * `announcement` reports its phase rather than the window it happens to have outgrown.
 */
export function ballotState(edition: BallotEdition, nowMs: number): BallotState {
  if (edition.phase !== 'voting') return 'outOfPhase';
  const startsMs = instant(edition.voting_starts_at);
  const endsMs = instant(edition.voting_ends_at);
  if (startsMs === null || endsMs === null) return 'windowUndeclared';
  if (nowMs < startsMs) return 'beforeWindow';
  if (nowMs > endsMs) return 'afterWindow';
  return 'open';
}

/** Whether a vote may be cast right now — the one thing a vote CTA needs to know. */
export function isBallotOpen(edition: BallotEdition, nowMs: number): boolean {
  return ballotState(edition, nowMs) === 'open';
}

export type ContributionEdition = Pick<FundEdition, 'phase' | 'contributions_enabled'>;

/**
 * Whether the cycle accepts contributions, mirroring `create-contribution-session`'s two
 * independent gates: the legal flag (`contributions_enabled`) AND the D34 phase window. Neither
 * one alone is the rule, and both are re-asserted server-side before Stripe is ever called.
 *
 * No clock: the contribution window is a phase, not an interval.
 */
export function canContribute(edition: ContributionEdition): boolean {
  return edition.contributions_enabled && CONTRIBUTION_PHASES.includes(edition.phase);
}

export type CandidacyEdition = Pick<FundEdition, 'phase' | 'candidacy_window_open'>;

/**
 * Whether a candidacy may be submitted, mirroring `public.fund_edition_open()`
 * (`20260813170840_fund_edition_open_invoker.sql`), which is what actually gates the
 * candidacy-videos bucket: `candidacy_window_open = true and phase <> 'closed'`.
 */
export function canSubmitCandidacy(edition: CandidacyEdition): boolean {
  return edition.candidacy_window_open && edition.phase !== 'closed';
}

/**
 * Why a winner may or may not be declared. Only the gates that are pure over the edition row —
 * `declare_winner` also enforces the FUND-43 quorum and the FUND-42 funding floor, and both of
 * those need row counts this module has no business fetching. `ready` therefore means «nothing
 * on the edition refuses», never «the declaration will succeed».
 */
export type DeclareState =
  | 'ready'
  | 'alreadyDeclared'
  | 'outOfPhase'
  | 'windowUndeclared'
  | 'ballotOpen';

export type DeclareEdition = Pick<FundEdition, 'phase' | 'voting_ends_at' | 'winner_candidacy_id'>;

/**
 * The edition-local half of `declare_winner`'s gates
 * (`20260815094157_declare_winner_window_fail_closed.sql:28-37`), in the SQL's own order:
 * an existing winner, then the phase, then the closed ballot.
 *
 * The window arm is `voting_ends_at is null or now() <= voting_ends_at` → refuse, which means
 * the final millisecond of the window still votes and still cannot be declared. The two rules
 * meet at that millisecond; they never overlap.
 */
export function declareState(edition: DeclareEdition, nowMs: number): DeclareState {
  if (edition.winner_candidacy_id !== null) return 'alreadyDeclared';
  if (edition.phase !== 'voting' && edition.phase !== 'announcement') return 'outOfPhase';
  const endsMs = instant(edition.voting_ends_at);
  if (endsMs === null) return 'windowUndeclared';
  if (nowMs <= endsMs) return 'ballotOpen';
  return 'ready';
}

/** Whether nothing on the edition row refuses a declaration. Quorum and floor are not read here. */
export function mayDeclare(edition: DeclareEdition, nowMs: number): boolean {
  return declareState(edition, nowMs) === 'ready';
}
