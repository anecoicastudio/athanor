// ── Canonical engine weights (PRD §4.9) — the SINGLE source of Aura point values
// (rule #10). The M6 score-engine edge fn (service role) is the only writer of
// awards (rule #1); the app may read these for truthful display-only labels
// (e.g. event detail «✦ +15 Aura» ← EVENT_ATTENDED, the only UI consumer).
//
// P2.5 hint-truth (2026-07-03): the legacy display-hint AURA_WEIGHTS table was
// REMOVED and the composer create-hints (`✦ +6/+2/+4` for post/comment/project)
// dropped — the engine deliberately never rewards creating content (anti-gaming:
// reward reactions earned, not volume produced; only `post_starred` exists).
// Never re-add a UI hint that doesn't map 1:1 to a ScoringType below.

export const ENGINE_WEIGHTS = {
  IDENTITY_VERIFIED: 50, //  +50 · once (lifetime)
  EVENT_ATTENDED: 15, //     +15 · max 4 / week (checked-in)
  EVENT_ORGANIZED: 30, //    +30 · max 2 / month (≥5 attendees)
  MOMENTO_CONV: 5, //        +5  · max 10 / month (≥10 msgs both sides)
  MILESTONE_HELP: 40, //     +40 · uncapped (owner-confirmed)
  OWN_MILESTONE: 10, //      +10 · per own milestone completed
  POST_REACTION: 2, //       +2  · max 10 / day (✦ from a member with score > 300)
  REPORT_UPHELD_MIN: -50,
  REPORT_UPHELD_MAX: -200,
  // ZERO by rule #1 — never grant Aura for these:
  CIRCLE_MEMBERSHIP: 0,
  FUND_CONTRIBUTION: 0,
  MARKETPLACE: 0, // PARKED(Fase-2): marketplace surface unbuilt; stays 0 at launch (tracked in PRODUCTION-READINESS P5)
} as const;

/** ✦ only counts toward POST_REACTION if the reactor's Aura is strictly above this. */
export const REACTION_AUTHOR_MIN_SCORE = 300;

// ── G-D (RESOLVED at M6 celebration-realtime) ────────────────────────────────
// PRD §4.9 mandates the *properties* (reviewer weight monotone in score + capped;
// reciprocal exchanges show pairwise diminishing returns), not the exact shapes.
// The v1 shapes below are promoted to FINAL (no production data to tune against;
// they satisfy every mandated property). Surfaced here as named constants so the
// curves are server-tunable + test-asserted in ONE module (rule #10).

/** Reciprocal dampening: the nth same-pair exchange is worth 1 / (1 + k·(n−1)). */
export const RECIPROCAL_DAMPENING = 0.5;
/** Reviewer-weight curve: 1 + ln1p(reviewerScore / SCALE), capped at CAP. */
export const REVIEWER_WEIGHT_SCALE = 1000;
export const REVIEWER_WEIGHT_CAP = 2;

/** The eight signed action types the engine ledgers (PRD §4.9). `decay` is engine-internal. */
export type ScoringType =
  | 'identity_verified'
  | 'event_attended'
  | 'event_organized'
  | 'momento_conversation'
  | 'milestone_help'
  | 'own_milestone'
  | 'post_starred'
  | 'report_upheld';

/**
 * The only ledger types that may move a score: the eight signed actions plus engine-internal
 * `decay`. Rule #1 — anything else (a paid-for row such as `circle_membership` or
 * `fund_contribution`) credits nothing no matter what `points` it carries, so the aggregator
 * refuses it on read as well as the awarder refusing it on write.
 */
export const CREDITABLE_TYPES: ReadonlySet<string> = new Set<string>([
  'identity_verified',
  'event_attended',
  'event_organized',
  'momento_conversation',
  'milestone_help',
  'own_milestone',
  'post_starred',
  'report_upheld',
  'decay',
]);

export type CapWindow = 'day' | 'week' | 'month' | 'lifetime';

/** Caps as (limit, window) pairs — counted from `aura_events` in the window by the engine.
 *  Keys are snake_case `ScoringType` values so the engine can look up `AURA_CAPS[type]`
 *  directly from the ledger row's `type` field. */
export const AURA_CAPS = {
  event_attended: { limit: 4, window: 'week' },
  event_organized: { limit: 2, window: 'month' },
  momento_conversation: { limit: 10, window: 'month' },
  post_starred: { limit: 10, window: 'day' },
  identity_verified: { limit: 1, window: 'lifetime' },
  // milestone_help, own_milestone: uncapped (no entry).
} as const satisfies Partial<Record<ScoringType, { limit: number; window: CapWindow }>>;

/** Decay (PRD §4.9): inactive > 30d → ×0.98 per elapsed week, floored at 40% of lifetime peak. */
export const DECAY = { IDLE_DAYS_BEFORE: 30, WEEKLY_FACTOR: 0.98, PEAK_FLOOR_RATIO: 0.4 } as const;

/** Report-upheld penalty by severity, within [MIN, MAX]. Owned by M9 moderation; consumed here. */
export const REPORT_PENALTY = { low: -50, medium: -100, high: -200 } as const;

export type ReportSeverity = keyof typeof REPORT_PENALTY;
/** Penalty points for an upheld report by severity (rule #10 single source). */
export function reportPenaltyPoints(severity: ReportSeverity): number {
  return REPORT_PENALTY[severity];
}

/** Tier display bands (frontend §3.4; display-only, never a score write). */
export const TIER_THRESHOLDS = [
  { tier: 'scintilla', min: 0 },
  { tier: 'bagliore', min: 250 },
  { tier: 'luce', min: 500 },
  { tier: 'faro', min: 750 },
  { tier: 'costellazione', min: 1000 },
] as const;
export type TierId = (typeof TIER_THRESHOLDS)[number]['tier'];

/** Six-star earn criteria (PRD §4.10), v1; tunable with seed data (G-D). */
export const STAR_CRITERIA = {
  visionario: { dreamPublished: true, milestonesDefined: 3, ownPostsStarred: 10 },
  creatore: { ownMilestonesCompleted: 2 },
  mentor: { helpsCompleted: 3 },
  innovatore: { evoluzionePostsStarred: 5, distinctStarrers: 10 },
  collaboratore: { momentoConversations: 5 },
  ambasciatore: { invitesActivated: 5 },
} as const;

/** The six display buckets in canonical display order (frontend §3.1) — single source (rule #10). */
export const BUCKET_ORDER = [
  'contributi',
  'eventi',
  'collaborazioni',
  'valore',
  'recensioni',
  'affidabilita',
] as const;
export type BucketKey = (typeof BUCKET_ORDER)[number];

/** v1 mapping of ledger type → display bucket (sum need NOT equal score). `decay` is unbucketed. */
export const BUCKET_MAP = {
  identity_verified: 'affidabilita',
  report_upheld: 'affidabilita',
  event_attended: 'eventi',
  event_organized: 'eventi',
  milestone_help: 'collaborazioni',
  momento_conversation: 'collaborazioni',
  own_milestone: 'contributi',
  post_starred: 'contributi',
} as const satisfies Record<ScoringType, BucketKey>;
