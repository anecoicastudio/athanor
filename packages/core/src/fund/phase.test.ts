import { describe, expect, it } from 'vitest';
import { fundPhaseSchema, type FundPhase } from '@athanor/schemas';
import {
  CONTRIBUTION_PHASES,
  FUND_PHASES,
  OPEN_CYCLE_PHASES,
  ballotState,
  canContribute,
  canSubmitCandidacy,
  declareState,
  isBallotOpen,
  mayDeclare,
  type BallotState,
  type DeclareState,
} from './phase';

// One fixed window, so every boundary below is an exact millisecond rather than a relative
// offset the reader has to compute. `nowMs` is injected everywhere (core rule: no inline clock).
const STARTS = '2026-03-01T00:00:00.000Z';
const ENDS = '2026-03-08T00:00:00.000Z';
const STARTS_MS = Date.parse(STARTS);
const ENDS_MS = Date.parse(ENDS);

const ballot = (over: Partial<Parameters<typeof ballotState>[0]> = {}) => ({
  phase: 'voting' as FundPhase,
  voting_starts_at: STARTS as string | null,
  voting_ends_at: ENDS as string | null,
  ...over,
});

describe('FUND_PHASES', () => {
  it('is the zod enum, not a second list', () => {
    expect(FUND_PHASES).toEqual(fundPhaseSchema.options);
  });

  // Pinned by value as well as by identity: the equality above survives any change to the
  // schema, so on its own it would let a phase be added or dropped silently. This is the
  // line that makes a vocabulary change a deliberate edit (#382 — four enumerations, three
  // different subsets).
  it('is the six phases of the cycle, in order', () => {
    expect(FUND_PHASES).toEqual([
      'candidacy',
      'screening',
      'voting',
      'announcement',
      'realization',
      'closed',
    ]);
  });
});

describe('CONTRIBUTION_PHASES', () => {
  // The five values `create-contribution-session/logic.ts` carries by value, in order. Its own
  // mirror test reads the enum off disk; this is the TypeScript side of the same pin.
  it('is every phase but the terminal one', () => {
    expect(CONTRIBUTION_PHASES).toEqual([
      'candidacy',
      'screening',
      'voting',
      'announcement',
      'realization',
    ]);
  });

  it('excludes closed and nothing else', () => {
    expect(CONTRIBUTION_PHASES).not.toContain('closed');
    expect(CONTRIBUTION_PHASES).toHaveLength(FUND_PHASES.length - 1);
  });
});

describe('OPEN_CYCLE_PHASES', () => {
  it('is the five steps the cycle trail draws', () => {
    expect(OPEN_CYCLE_PHASES).toEqual([
      'candidacy',
      'screening',
      'voting',
      'announcement',
      'realization',
    ]);
  });

  // Deliberately asserted as its own list rather than against CONTRIBUTION_PHASES: the two
  // agree today and are two different rules, so if D34 narrows the money window this test keeps
  // passing and the contribution one changes — which is the point of not aliasing them.
  it('excludes closed and nothing else', () => {
    expect(OPEN_CYCLE_PHASES).not.toContain('closed');
    expect(OPEN_CYCLE_PHASES).toHaveLength(FUND_PHASES.length - 1);
  });
});

describe('ballotState', () => {
  it('is open inside the declared window', () => {
    expect(ballotState(ballot(), STARTS_MS + 60_000)).toBe('open');
  });

  // cast_vote is `now() >= starts and now() <= ends` — a CLOSED interval on both ends
  // (20260815090015_cast_vote_window.sql:34-35). Both boundary milliseconds vote.
  it('is open at the first millisecond of the window', () => {
    expect(ballotState(ballot(), STARTS_MS)).toBe('open');
  });

  it('is open at the last millisecond of the window', () => {
    expect(ballotState(ballot(), ENDS_MS)).toBe('open');
  });

  it('is beforeWindow one millisecond early', () => {
    expect(ballotState(ballot(), STARTS_MS - 1)).toBe('beforeWindow');
  });

  it('is afterWindow one millisecond late', () => {
    expect(ballotState(ballot(), ENDS_MS + 1)).toBe('afterWindow');
  });

  // #414, hit live on staging 2026-08-17: phase = 'voting' with BOTH bounds NULL. The SQL
  // fails closed by null-propagation inside an EXISTS; the client had no rule at all and
  // rendered «Vota». A NULL window is an undeclared window, and an undeclared window is shut.
  it('is windowUndeclared when the start is missing', () => {
    expect(ballotState(ballot({ voting_starts_at: null }), STARTS_MS + 60_000)).toBe(
      'windowUndeclared',
    );
  });

  it('is windowUndeclared when the end is missing', () => {
    expect(ballotState(ballot({ voting_ends_at: null }), STARTS_MS + 60_000)).toBe(
      'windowUndeclared',
    );
  });

  it('is windowUndeclared when both bounds are missing', () => {
    expect(
      ballotState(ballot({ voting_starts_at: null, voting_ends_at: null }), STARTS_MS + 60_000),
    ).toBe('windowUndeclared');
  });

  // A timestamptz arrives as a string over the wire, so an unparseable one is reachable
  // without a schema violation. It is treated as undeclared rather than as an epoch-zero
  // window: `Date.parse` yields NaN, every comparison against NaN is false, and a rule that
  // silently answers "not open, for no stated reason" is how the plpgsql IF NULL trap in
  // MIGRATIONS-ERRATA.md read from the outside.
  it('is windowUndeclared when a bound is not a parseable instant', () => {
    expect(ballotState(ballot({ voting_starts_at: 'soon' }), STARTS_MS + 60_000)).toBe(
      'windowUndeclared',
    );
    expect(ballotState(ballot({ voting_ends_at: '' }), STARTS_MS + 60_000)).toBe(
      'windowUndeclared',
    );
  });

  it('is outOfPhase in every phase but voting, window or no window', () => {
    for (const phase of FUND_PHASES.filter((p) => p !== 'voting')) {
      expect(ballotState(ballot({ phase }), STARTS_MS + 60_000)).toBe('outOfPhase');
      expect(
        ballotState(
          ballot({ phase, voting_starts_at: null, voting_ends_at: null }),
          STARTS_MS + 60_000,
        ),
      ).toBe('outOfPhase');
    }
  });

  // Gate order matters as much as the gates: the phase is read before the window, so a
  // non-voting cycle reports the phase rather than the window it happens to be missing.
  it('reports the phase before the window', () => {
    expect(
      ballotState(
        ballot({ phase: 'closed', voting_starts_at: null, voting_ends_at: null }),
        STARTS_MS,
      ),
    ).toBe('outOfPhase');
  });

  // An inverted window admits no instant at all. Nothing forbids one in the schema, and the
  // SQL's conjunction is empty for it too — so the rulebook must not fall through to open.
  it('is never open for an inverted window', () => {
    const inverted = ballot({ voting_starts_at: ENDS, voting_ends_at: STARTS });
    for (const now of [STARTS_MS - 1, STARTS_MS, (STARTS_MS + ENDS_MS) / 2, ENDS_MS, ENDS_MS + 1]) {
      expect(isBallotOpen(inverted, now)).toBe(false);
    }
  });
});

describe('isBallotOpen', () => {
  it('is true for open and false for every other state', () => {
    const cases: Array<[Parameters<typeof ballotState>[0], number, BallotState, boolean]> = [
      [ballot(), STARTS_MS, 'open', true],
      [ballot(), STARTS_MS - 1, 'beforeWindow', false],
      [ballot(), ENDS_MS + 1, 'afterWindow', false],
      [ballot({ voting_ends_at: null }), STARTS_MS, 'windowUndeclared', false],
      [ballot({ phase: 'announcement' }), STARTS_MS, 'outOfPhase', false],
    ];
    for (const [edition, now, state, open] of cases) {
      expect(ballotState(edition, now)).toBe(state);
      expect(isBallotOpen(edition, now)).toBe(open);
    }
  });
});

describe('canContribute', () => {
  it('accepts every open phase while the flag is on', () => {
    for (const phase of CONTRIBUTION_PHASES) {
      expect(canContribute({ phase, contributions_enabled: true })).toBe(true);
    }
  });

  it('refuses a closed cycle even with the flag on', () => {
    expect(canContribute({ phase: 'closed', contributions_enabled: true })).toBe(false);
  });

  // The legal flag and the phase window are independent gates in
  // create-contribution-session (logic.ts) and both are re-asserted server-side; neither
  // one alone is the rule.
  it('refuses every phase while the flag is off', () => {
    for (const phase of FUND_PHASES) {
      expect(canContribute({ phase, contributions_enabled: false })).toBe(false);
    }
  });
});

describe('canSubmitCandidacy', () => {
  it('accepts every non-closed phase while the window is open', () => {
    for (const phase of FUND_PHASES.filter((p) => p !== 'closed')) {
      expect(canSubmitCandidacy({ phase, candidacy_window_open: true })).toBe(true);
    }
  });

  it('refuses a closed cycle even with the window flag on', () => {
    expect(canSubmitCandidacy({ phase: 'closed', candidacy_window_open: true })).toBe(false);
  });

  it('refuses every phase while the window is shut', () => {
    for (const phase of FUND_PHASES) {
      expect(canSubmitCandidacy({ phase, candidacy_window_open: false })).toBe(false);
    }
  });
});

describe('declareState', () => {
  const declarable = (over: Partial<Parameters<typeof declareState>[0]> = {}) => ({
    phase: 'voting' as FundPhase,
    voting_ends_at: ENDS as string | null,
    winner_candidacy_id: null as string | null,
    ...over,
  });

  it('is ready once the ballot has closed', () => {
    expect(declareState(declarable(), ENDS_MS + 1)).toBe('ready');
  });

  it('is ready in announcement as well as in voting', () => {
    expect(declareState(declarable({ phase: 'announcement' }), ENDS_MS + 1)).toBe('ready');
  });

  // declare_winner refuses on `now() <= voting_ends_at`
  // (20260815094157_declare_winner_window_fail_closed.sql:35), so the final millisecond of
  // the window still votes and still cannot be declared. The two rules meet, never overlap.
  it('is ballotOpen at the last millisecond of the window', () => {
    expect(declareState(declarable(), ENDS_MS)).toBe('ballotOpen');
    expect(isBallotOpen(ballot(), ENDS_MS)).toBe(true);
  });

  it('is ballotOpen while the window is still running', () => {
    expect(declareState(declarable(), STARTS_MS)).toBe('ballotOpen');
  });

  // The predecessor migration wrote `if not (now() > voting_ends_at)` and sailed past on a
  // NULL because plpgsql treats IF NULL as false. The NULL arm is spelled out here for the
  // same reason it had to be spelled out there.
  it('is windowUndeclared when the end is missing', () => {
    expect(declareState(declarable({ voting_ends_at: null }), ENDS_MS + 1)).toBe(
      'windowUndeclared',
    );
  });

  it('is windowUndeclared when the end is not a parseable instant', () => {
    expect(declareState(declarable({ voting_ends_at: 'later' }), ENDS_MS + 1)).toBe(
      'windowUndeclared',
    );
  });

  it('is outOfPhase outside voting and announcement', () => {
    for (const phase of FUND_PHASES.filter((p) => p !== 'voting' && p !== 'announcement')) {
      expect(declareState(declarable({ phase }), ENDS_MS + 1)).toBe('outOfPhase');
    }
  });

  // Gate order, verbatim from the SQL: already-declared, then phase, then window. Each case
  // below would report a DIFFERENT reason if the order slipped.
  it('reports an existing winner before the phase and before the window', () => {
    expect(
      declareState(
        declarable({ winner_candidacy_id: 'c0ffee', phase: 'closed', voting_ends_at: null }),
        ENDS_MS + 1,
      ),
    ).toBe('alreadyDeclared');
  });

  it('reports the phase before the window', () => {
    expect(
      declareState(declarable({ phase: 'candidacy', voting_ends_at: null }), ENDS_MS + 1),
    ).toBe('outOfPhase');
  });
});

describe('mayDeclare', () => {
  it('is true for ready and false for every other state', () => {
    const cases: Array<[Parameters<typeof declareState>[0], number, DeclareState, boolean]> = [
      [
        { phase: 'voting', voting_ends_at: ENDS, winner_candidacy_id: null },
        ENDS_MS + 1,
        'ready',
        true,
      ],
      [
        { phase: 'voting', voting_ends_at: ENDS, winner_candidacy_id: null },
        ENDS_MS,
        'ballotOpen',
        false,
      ],
      [
        { phase: 'voting', voting_ends_at: null, winner_candidacy_id: null },
        ENDS_MS + 1,
        'windowUndeclared',
        false,
      ],
      [
        { phase: 'closed', voting_ends_at: ENDS, winner_candidacy_id: null },
        ENDS_MS + 1,
        'outOfPhase',
        false,
      ],
      [
        { phase: 'voting', voting_ends_at: ENDS, winner_candidacy_id: 'w' },
        ENDS_MS + 1,
        'alreadyDeclared',
        false,
      ],
    ];
    for (const [edition, now, state, may] of cases) {
      expect(declareState(edition, now)).toBe(state);
      expect(mayDeclare(edition, now)).toBe(may);
    }
  });
});
