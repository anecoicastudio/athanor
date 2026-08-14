/**
 * Feed connection boost (#152, PRD §4.5): «chronological within tab, light boost for
 * first-degree connections». Pure merge — `@athanor/api` fetches two keyset streams
 * (the chronological page and the connection-authored page, each on its own raw
 * `(created_at, id)` cursor so rule #9 keeps exact keyset semantics) and hands the
 * pages here. The boost never touches Aura (rule #1): `CONNECTION_BOOST_MS` is a feed
 * *ordering* nudge, not a score, and it keys on the connection edge only — no
 * engagement signal of any kind enters the ranking.
 */

/**
 * The nudge (rule #10 pattern: named, one module, test-asserted): a connection's post
 * ranks as if posted this much later than it was. Kept well under a day so chronology
 * stays the backbone — a connection's post from days ago can never outrank today.
 */
export const CONNECTION_BOOST_MS = 2 * 60 * 60 * 1000;

/**
 * The boost reads at most this many peers (most recent connections first) — bounds the
 * PostgREST `in.(...)` URL the api layer builds. Beyond the cap the feed simply stays
 * chronological for the oldest edges.
 */
export const CONNECTION_BOOST_MAX_PEERS = 100;

/** The columns the merge reads — any post row with these fits. */
export type BoostFeedRow = { id: string; author_id: string; created_at: string };

/**
 * Effective-order position of the last emitted row: ms-precision timestamp plus id
 * tiebreak. Later pages drop anything at or above it, so pages stay monotone (and
 * duplicates stay impossible) even when rows land between fetches.
 */
export type FeedFrontier = { ms: number; id: string };

export type MergeBoostedFeedInput<T extends BoostFeedRow> = {
  /** Chronological page, `(created_at desc, id desc)`, all authors. */
  chrono: readonly T[];
  /** Connection-authored page, same order, already filtered to `peerIds` authors. */
  boosted: readonly T[];
  /** First-degree peer snapshot — MUST be the same set across every page of one scroll. */
  peerIds: ReadonlySet<string>;
  limit: number;
  /** Stream came back full ⇒ rows beyond its horizon may exist (nextCursorOf heuristic). */
  chronoMayHaveMore: boolean;
  boostedMayHaveMore: boolean;
  /** Frontier from the previous page; null on the first. */
  frontier?: FeedFrontier | null;
};

export type MergeBoostedFeedResult<T extends BoostFeedRow> = {
  posts: T[];
  /** Last consumed row of each stream — the api layer's next keyset cursor. Null = the
   * stream was not consumed this page; the caller keeps its previous cursor. */
  lastChrono: T | null;
  lastBoosted: T | null;
  frontier: FeedFrontier | null;
  /** True only when both streams came back short and were fully consumed. */
  done: boolean;
};

/** Where a row sits in the merged order: `created_at`, nudged forward for a connection. */
export function effectiveTimestampMs(row: BoostFeedRow, isConnection: boolean): number {
  return Date.parse(row.created_at) + (isConnection ? CONNECTION_BOOST_MS : 0);
}

/**
 * Two-pointer merge of the streams by `(effectiveTimestampMs desc, id desc)`. Three
 * consumption rules keep the cursor invariants (no duplicates, no skips, monotone
 * pages) under concurrent inserts:
 *
 * 1. A chrono copy of a connection post is consumed silently — the boosted stream
 *    emits it at its nudged position (which the merge has always already passed).
 * 2. Anything at or above the frontier is consumed silently — either it was emitted
 *    last page, or it landed mid-scroll and waits for a refresh, like any keyset feed.
 * 3. When a stream that came back full runs dry, the merge stops: its unfetched rows
 *    might outrank the other stream's buffer, so emitting past them could skip.
 *
 * Comparison is ms-precision (sub-ms order between streams collapses to the id
 * tiebreak) — pagination exactness never depends on it, because the SQL cursors are
 * the raw `created_at` strings.
 */
export function mergeBoostedFeed<T extends BoostFeedRow>(
  input: MergeBoostedFeedInput<T>,
): MergeBoostedFeedResult<T> {
  const { chrono, boosted, peerIds, limit, chronoMayHaveMore, boostedMayHaveMore } = input;
  let frontier = input.frontier ?? null;
  const posts: T[] = [];
  let iA = 0;
  let iB = 0;
  let lastChrono: T | null = null;
  let lastBoosted: T | null = null;

  const atOrAboveFrontier = (ms: number, id: string): boolean =>
    frontier !== null && (ms > frontier.ms || (ms === frontier.ms && id >= frontier.id));

  const takeChrono = (row: T): void => {
    posts.push(row);
    frontier = { ms: effectiveTimestampMs(row, false), id: row.id };
    lastChrono = row;
    iA++;
  };
  const takeBoosted = (row: T): void => {
    posts.push(row);
    frontier = { ms: effectiveTimestampMs(row, true), id: row.id };
    lastBoosted = row;
    iB++;
  };

  while (posts.length < limit) {
    // noUncheckedIndexedAccess: an out-of-range read is `undefined` — the stream is dry.
    const a = chrono[iA];
    if (a !== undefined && peerIds.has(a.author_id)) {
      lastChrono = a;
      iA++;
      continue;
    }
    if (a !== undefined && atOrAboveFrontier(effectiveTimestampMs(a, false), a.id)) {
      lastChrono = a;
      iA++;
      continue;
    }
    const b = boosted[iB];
    if (b !== undefined && atOrAboveFrontier(effectiveTimestampMs(b, true), b.id)) {
      lastBoosted = b;
      iB++;
      continue;
    }

    if (a === undefined && chronoMayHaveMore) break;
    if (b === undefined && boostedMayHaveMore) break;

    if (a === undefined) {
      if (b === undefined) break;
      takeBoosted(b);
      continue;
    }
    if (b === undefined) {
      takeChrono(a);
      continue;
    }
    const effA = effectiveTimestampMs(a, false);
    const effB = effectiveTimestampMs(b, true);
    // Equivalent mutant (`>` → `>=`): ids are the posts PK, and the peerIds guard above
    // consumes any chrono copy of a boosted row, so `a.id === b.id` cannot reach here.
    if (effA > effB || (effA === effB && a.id > b.id)) {
      takeChrono(a);
    } else {
      takeBoosted(b);
    }
  }

  const done =
    !chronoMayHaveMore && !boostedMayHaveMore && iA === chrono.length && iB === boosted.length;
  return { posts, lastChrono, lastBoosted, frontier, done };
}
