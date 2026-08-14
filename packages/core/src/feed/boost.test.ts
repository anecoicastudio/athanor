import { describe, expect, it } from 'vitest';
import {
  CONNECTION_BOOST_MAX_PEERS,
  CONNECTION_BOOST_MS,
  effectiveTimestampMs,
  mergeBoostedFeed,
  type BoostFeedRow,
  type FeedFrontier,
  type MergeBoostedFeedResult,
} from './boost';

const FRIEND = '11111111-1111-4111-8111-111111111111';
const FRIEND_B = '22222222-2222-4222-8222-222222222222';
const STRANGER = '99999999-9999-4999-8999-999999999999';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Fixed "now" — merge is pure, the clock only anchors the fixture timestamps. */
const NOW = Date.parse('2026-08-14T12:00:00.000Z');

const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
const post = (author: string, agoMs: number, id?: string): BoostFeedRow => ({
  id: id ?? `${String(++seq).padStart(8, '0')}-0000-4000-8000-000000000000`,
  author_id: author,
  created_at: iso(NOW - agoMs),
});

const peers = (...ids: string[]) => new Set(ids);

// ── constants (rule #10 pattern: named, one module, test-asserted) ───────────

describe('boost constants', () => {
  it('pins the light-boost weight at 2 hours', () => {
    expect(CONNECTION_BOOST_MS).toBe(2 * HOUR);
  });

  it('keeps the boost light: strictly under a day, so chronology stays the backbone', () => {
    expect(CONNECTION_BOOST_MS).toBeGreaterThan(0);
    expect(CONNECTION_BOOST_MS).toBeLessThan(DAY);
  });

  it('pins the peer cap that bounds the in-list', () => {
    expect(CONNECTION_BOOST_MAX_PEERS).toBe(100);
  });
});

// ── effective timestamp ──────────────────────────────────────────────────────

describe('effectiveTimestampMs', () => {
  it('boosts a connection row by exactly CONNECTION_BOOST_MS', () => {
    const row = post(FRIEND, 3 * HOUR);
    expect(effectiveTimestampMs(row, true)).toBe(NOW - 3 * HOUR + CONNECTION_BOOST_MS);
  });

  it('leaves a non-connection row at its created_at', () => {
    const row = post(STRANGER, 3 * HOUR);
    expect(effectiveTimestampMs(row, false)).toBe(NOW - 3 * HOUR);
  });
});

// ── merge: ordering ──────────────────────────────────────────────────────────

const merge = <T extends BoostFeedRow>(
  input: Partial<Parameters<typeof mergeBoostedFeed<T>>[0]> &
    Pick<Parameters<typeof mergeBoostedFeed<T>>[0], 'chrono' | 'boosted' | 'peerIds'>,
): MergeBoostedFeedResult<T> =>
  mergeBoostedFeed({
    limit: 20,
    chronoMayHaveMore: false,
    boostedMayHaveMore: false,
    frontier: null,
    ...input,
  });

describe('mergeBoostedFeed — ordering', () => {
  it('passes the chronological page through untouched when there are no connections', () => {
    const rows = [post(STRANGER, 1 * HOUR), post(STRANGER, 2 * HOUR), post(STRANGER, 3 * HOUR)];
    const out = merge({ chrono: rows, boosted: [], peerIds: peers() });
    expect(out.posts).toEqual(rows);
    expect(out.lastChrono).toBe(rows[2]);
    expect(out.lastBoosted).toBeNull();
    expect(out.done).toBe(true);
  });

  it('nudges a connection post above a slightly newer stranger post', () => {
    const friendPost = post(FRIEND, 90 * 60 * 1000); // 90 min ago, boosted → reads as +30 min
    const strangerPost = post(STRANGER, 30 * 60 * 1000); // 30 min ago
    const out = merge({
      chrono: [strangerPost, friendPost],
      boosted: [friendPost],
      peerIds: peers(FRIEND),
    });
    expect(out.posts).toEqual([friendPost, strangerPost]);
  });

  it('keeps chronology the backbone: a connection post from 3 days ago never outranks today', () => {
    const oldFriendPost = post(FRIEND, 3 * DAY);
    const todayPost = post(STRANGER, 6 * HOUR);
    const out = merge({
      chrono: [todayPost, oldFriendPost],
      boosted: [oldFriendPost],
      peerIds: peers(FRIEND),
    });
    expect(out.posts).toEqual([todayPost, oldFriendPost]);
  });

  it('does not boost the stranger posts around a connection post', () => {
    const rows = [post(STRANGER, 1 * HOUR), post(FRIEND, 90 * 60 * 1000), post(STRANGER, 4 * HOUR)];
    const out = merge({
      chrono: rows,
      boosted: [rows[1] as BoostFeedRow],
      peerIds: peers(FRIEND),
    });
    // friend@-90min boosts to +30min > stranger@-1h; stranger@-4h stays last
    expect(out.posts).toEqual([rows[1], rows[0], rows[2]]);
  });

  it('breaks an effective-timestamp tie by id descending, deterministically', () => {
    // friend posted exactly CONNECTION_BOOST_MS before the stranger → identical effective ts
    const friendPost = post(
      FRIEND,
      2 * HOUR + CONNECTION_BOOST_MS,
      'bbbbbbbb-0000-4000-8000-000000000000',
    );
    const strangerPost = post(STRANGER, 2 * HOUR, 'aaaaaaaa-0000-4000-8000-000000000000');
    const out = merge({
      chrono: [strangerPost, friendPost],
      boosted: [friendPost],
      peerIds: peers(FRIEND),
    });
    expect(out.posts).toEqual([friendPost, strangerPost]);
  });
});

// ── merge: dedup + consumption ───────────────────────────────────────────────

describe('mergeBoostedFeed — dedup and cursors', () => {
  it('emits a connection post once even though both streams fetched it', () => {
    const friendPost = post(FRIEND, 1 * HOUR);
    const strangerPost = post(STRANGER, 2 * HOUR);
    const out = merge({
      chrono: [friendPost, strangerPost],
      boosted: [friendPost],
      peerIds: peers(FRIEND),
    });
    expect(out.posts).toEqual([friendPost, strangerPost]);
    // the chrono copy was consumed silently — the cursor moved past it
    expect(out.lastChrono).toBe(strangerPost);
    expect(out.lastBoosted).toBe(friendPost);
  });

  it('stops at the limit and reports the last consumed row of each stream', () => {
    const rows = [post(STRANGER, 1 * HOUR), post(STRANGER, 2 * HOUR), post(STRANGER, 3 * HOUR)];
    const out = merge({ chrono: rows, boosted: [], peerIds: peers(), limit: 2 });
    expect(out.posts).toEqual([rows[0], rows[1]]);
    expect(out.lastChrono).toBe(rows[1]);
    expect(out.done).toBe(false);
  });

  it('stops when a full-page stream runs dry — unseen rows there may outrank the other stream', () => {
    const friendPost = post(FRIEND, 1 * HOUR);
    const strangers = [post(STRANGER, 2 * HOUR), post(STRANGER, 3 * HOUR)];
    const out = merge({
      chrono: strangers,
      boosted: [friendPost],
      peerIds: peers(FRIEND),
      boostedMayHaveMore: true, // B page was full at limit 1 → more boosted rows unknown
      limit: 20,
    });
    expect(out.posts).toEqual([friendPost]);
    expect(out.done).toBe(false);
  });

  it('is done only when both streams came back short and were fully consumed', () => {
    const rows = [post(STRANGER, 1 * HOUR)];
    const short = merge({ chrono: rows, boosted: [], peerIds: peers() });
    expect(short.done).toBe(true);
    const full = merge({ chrono: rows, boosted: [], peerIds: peers(), chronoMayHaveMore: true });
    expect(full.done).toBe(false);
  });
});

// ── merge: frontier ──────────────────────────────────────────────────────────

describe('mergeBoostedFeed — frontier', () => {
  it('reports the effective position of the last emitted row as the new frontier', () => {
    const friendPost = post(FRIEND, 1 * HOUR);
    const out = merge({ chrono: [friendPost], boosted: [friendPost], peerIds: peers(FRIEND) });
    expect(out.frontier).toEqual({
      ms: NOW - 1 * HOUR + CONNECTION_BOOST_MS,
      id: friendPost.id,
    });
  });

  it('drops rows at or above the previous frontier instead of re-emitting them', () => {
    const alreadySeen = post(FRIEND, 1 * HOUR);
    const fresh = post(STRANGER, 2 * HOUR);
    const frontier: FeedFrontier = {
      ms: effectiveTimestampMs(alreadySeen, true),
      id: alreadySeen.id,
    };
    const out = merge({
      chrono: [fresh],
      boosted: [alreadySeen],
      peerIds: peers(FRIEND),
      frontier,
    });
    expect(out.posts).toEqual([fresh]);
    // dropped, but consumed — the boosted cursor advances past it
    expect(out.lastBoosted).toBe(alreadySeen);
  });

  it('propagates the previous frontier when nothing is emitted', () => {
    const frontier: FeedFrontier = { ms: NOW, id: 'ffffffff-0000-4000-8000-000000000000' };
    const out = merge({ chrono: [], boosted: [], peerIds: peers(), frontier });
    expect(out.frontier).toEqual(frontier);
  });
});

// ── pagination walk: the invariants rule #9 demands ──────────────────────────

type Cursor = { created_at: string; id: string };

/** Mimic the PostgREST keyset fetch the api layer performs per stream. */
const fetchPage = (
  table: readonly BoostFeedRow[],
  cursor: Cursor | null,
  limit: number,
  authors?: ReadonlySet<string>,
): BoostFeedRow[] =>
  table
    .filter((r) => !authors || authors.has(r.author_id))
    .filter(
      (r) =>
        !cursor ||
        r.created_at < cursor.created_at ||
        (r.created_at === cursor.created_at && r.id < cursor.id),
    )
    .sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1,
    )
    .slice(0, limit);

/** Reference api-layer loop: paginate to exhaustion, exactly as getFeedPage will. */
const walk = (
  table: BoostFeedRow[],
  peerIds: ReadonlySet<string>,
  limit: number,
  betweenPages?: (page: number) => void,
): BoostFeedRow[] => {
  const seen: BoostFeedRow[] = [];
  let chronoCursor: Cursor | null = null;
  let connCursor: Cursor | null = null;
  let frontier: FeedFrontier | null = null;
  for (let page = 0; page < 50; page++) {
    const chrono = fetchPage(table, chronoCursor, limit);
    const boosted: BoostFeedRow[] = peerIds.size
      ? fetchPage(table, connCursor, limit, peerIds)
      : [];
    const out: MergeBoostedFeedResult<BoostFeedRow> = mergeBoostedFeed({
      chrono,
      boosted,
      peerIds,
      limit,
      chronoMayHaveMore: chrono.length === limit,
      boostedMayHaveMore: boosted.length === limit,
      frontier,
    });
    seen.push(...out.posts);
    if (out.lastChrono)
      chronoCursor = { created_at: out.lastChrono.created_at, id: out.lastChrono.id };
    if (out.lastBoosted)
      connCursor = { created_at: out.lastBoosted.created_at, id: out.lastBoosted.id };
    frontier = out.frontier;
    if (out.done) return seen;
    betweenPages?.(page);
  }
  throw new Error('walk did not terminate');
};

describe('mergeBoostedFeed — full pagination walk', () => {
  const buildTable = (): BoostFeedRow[] => {
    const rows: BoostFeedRow[] = [];
    for (let i = 0; i < 30; i++) rows.push(post(STRANGER, i * 37 * 60 * 1000));
    for (let i = 0; i < 8; i++) rows.push(post(FRIEND, (i * 211 + 13) * 60 * 1000));
    for (let i = 0; i < 5; i++) rows.push(post(FRIEND_B, (i * 397 + 51) * 60 * 1000));
    return rows;
  };

  const expectedOrder = (table: BoostFeedRow[], peerIds: ReadonlySet<string>): string[] =>
    [...table]
      .map((r) => ({ id: r.id, eff: effectiveTimestampMs(r, peerIds.has(r.author_id)) }))
      .sort((a, b) => (a.eff === b.eff ? (a.id < b.id ? 1 : -1) : b.eff - a.eff))
      .map((r) => r.id);

  it('yields every post exactly once, in global boosted order', () => {
    const table = buildTable();
    const friendIds = peers(FRIEND, FRIEND_B);
    const seen = walk(table, friendIds, 7);
    expect(seen.map((r) => r.id)).toEqual(expectedOrder(table, friendIds));
  });

  it('never duplicates or skips a snapshot row when posts land mid-scroll', () => {
    const table = buildTable();
    const friendIds = peers(FRIEND, FRIEND_B);
    const snapshot = table.map((r) => r.id);
    let inserted = 0;
    const seen = walk(table, friendIds, 7, () => {
      // a stranger and a connection both post while the reader scrolls
      table.push(post(STRANGER, -++inserted * 60 * 1000));
      table.push(post(FRIEND, -++inserted * 60 * 1000));
    });
    const ids = seen.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    for (const id of snapshot) expect(ids).toContain(id); // no skipped snapshot rows
    for (const id of ids) expect(snapshot).toContain(id); // newcomers wait for refresh
  });

  it('holds the invariants when the connection stream is denser than the page size', () => {
    const table: BoostFeedRow[] = [];
    for (let i = 0; i < 12; i++) table.push(post(FRIEND, i * 13 * 60 * 1000));
    for (let i = 0; i < 4; i++) table.push(post(STRANGER, i * 101 * 60 * 1000));
    const friendIds = peers(FRIEND);
    const seen = walk(table, friendIds, 5);
    expect(seen.map((r) => r.id)).toEqual(expectedOrder(table, friendIds));
  });
});
