/**
 * AURA_WEIGHTS — the single source of Aura point values (rule #10). The app
 * imports these for display-only hints (e.g. the `✦ +N Aura` compose hint);
 * the M6 `score-engine` edge function (service-role) is the only writer of the
 * actual award (rule #1). One edit here keeps the UI hint and the engine award
 * in lockstep. Circle membership and fund contributions are worth ZERO (rule #1).
 *
 * Backend ref: 07-score-engine.md §3.1. Extend (comment +2, project +4, …) at M6.
 */
export const AURA_WEIGHTS = {
  /** Sharing a Community post (M3 feed). Displayed as `✦ +6 Aura` in the composer. */
  POST_CREATE: 6,
  /** Posting a reply on a Community post (M3). Displayed as `✦ +2 Aura` in the reply input. */
  COMMENT_CREATE: 2,
  /** Celebrating someone's growth step (M3 story ✦). Displayed as `✦ +4 Aura`. */
  STORY_REACT: 4,
  /** Publishing a Costellazioni project (M3 board). Displayed as `✦ +4 Aura` in the composer. */
  PROJECT_CREATE: 4,
  /** Attending (checking in to) an Athanor Live event (M4/M6). Read-only «✦ +15 Aura» label on event detail. */
  EVENT_ATTEND: 15,
  /** Organizing an event whose attendees check in (M4/M6). Read-only label. */
  EVENT_ORGANIZE: 30,
  /**
   * A Momento conversation reaching ≥10 messages from BOTH sides (M5 records the
   * messages; the M6 engine awards +5 to each party — never client-written, rule #1).
   * Display-only constant; no `✦ +N` hint is shown in chat (the award is invisible in M5).
   */
  MOMENTO_CONV: 5,
  /** Joining the Athanor Circle is never scored (rule #1). */
  CIRCLE_JOIN: 0,
  /** Contributing to Il Cuore (the fund) is never scored (rule #1). */
  FUND_CONTRIBUTION: 0,
} as const;

export type AuraWeightKey = keyof typeof AURA_WEIGHTS;

// ── M6 canonical engine weights (PRD §4.9). The score-engine edge fn (service role)
// is the ONLY consumer/writer (rule #1). Distinct from the legacy display-hint
// `AURA_WEIGHTS` object above (consumed by the M3–M5 compose hints) — a later
// "hint-truth" slice converges the two. Both live in this ONE module (rule #10).

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
  MARKETPLACE: 0, // Fase 2 surface; zero at launch
} as const;

/** ✦ only counts toward POST_REACTION if the reactor's Aura is strictly above this. */
export const REACTION_AUTHOR_MIN_SCORE = 300;

export type CapWindow = 'day' | 'week' | 'month' | 'lifetime';

/** Caps as (limit, window) pairs — counted from `aura_events` in the window by the engine. */
export const AURA_CAPS = {
  EVENT_ATTENDED: { limit: 4, window: 'week' },
  EVENT_ORGANIZED: { limit: 2, window: 'month' },
  MOMENTO_CONV: { limit: 10, window: 'month' },
  POST_REACTION: { limit: 10, window: 'day' },
  IDENTITY_VERIFIED: { limit: 1, window: 'lifetime' },
  // MILESTONE_HELP, OWN_MILESTONE: uncapped (no entry).
} as const satisfies Record<string, { limit: number; window: CapWindow }>;

/** Decay (PRD §4.9): inactive > 30d → ×0.98 per elapsed week, floored at 40% of lifetime peak. */
export const DECAY = { IDLE_DAYS_BEFORE: 30, WEEKLY_FACTOR: 0.98, PEAK_FLOOR_RATIO: 0.4 } as const;

/** Report-upheld penalty by severity, within [MIN, MAX]. Owned by M9 moderation; consumed here. */
export const REPORT_PENALTY = { low: -50, medium: -100, high: -200 } as const;

/** Tier display bands (frontend §3.4; display-only, never a score write). */
export const TIER_THRESHOLDS = [
  { tier: 'scintilla', min: 0 },
  { tier: 'bagliore', min: 250 },
  { tier: 'luce', min: 500 },
  { tier: 'faro', min: 750 },
  { tier: 'costellazione', min: 1000 },
] as const;
export type TierId = (typeof TIER_THRESHOLDS)[number]['tier'];

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

/** Six-star earn criteria (PRD §4.10), v1; tunable with seed data (G-D). */
export const STAR_CRITERIA = {
  visionario: { dreamPublished: true, milestonesDefined: 3, ownPostsStarred: 10 },
  creatore: { ownMilestonesCompleted: 2 },
  mentor: { helpsCompleted: 3 },
  innovatore: { evoluzionePostsStarred: 5, distinctStarrers: 10 },
  collaboratore: { momentoConversations: 5 },
  ambasciatore: { invitesActivated: 5 },
} as const;

/** The six display buckets (frontend §3.1). */
export type BucketKey =
  | 'contributi'
  | 'eventi'
  | 'collaborazioni'
  | 'valore'
  | 'recensioni'
  | 'affidabilita';

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
