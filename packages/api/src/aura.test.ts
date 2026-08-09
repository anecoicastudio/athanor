import { describe, expect, it, test, vi } from 'vitest';
import { ZERO_AURA_SNAPSHOT } from '@athanor/schemas';
import * as auraApi from './aura';
import {
  auraKeys,
  getAuraEventsSince,
  getAuraLedgerPage,
  getAuraScore,
  getAuraScoreFull,
  getStars,
  ledgerKeys,
  starKeys,
  subscribeAura,
} from './aura';
import { makeFakeClient } from './test-support/fake-client';
import type { AthanorClient } from './client';

// ---------------------------------------------------------------------------
// Key factory shapes
// ---------------------------------------------------------------------------

describe('aura key factories', () => {
  test('shapes', () => {
    expect(auraKeys.score('p1')).toEqual(['aura', 'score', 'p1']);
    expect(ledgerKeys.list('p1', 'gained')).toEqual(['ledger', 'p1', { filter: 'gained' }]);
    expect(starKeys.list('p1')).toEqual(['stars', 'p1']);
  });

  it('existing key shapes still work', () => {
    expect(auraKeys.detail('abc')).toEqual(['aura', 'detail', 'abc']);
  });
});

// ---------------------------------------------------------------------------
// getAuraScore coalesce tests
// ---------------------------------------------------------------------------

describe('getAuraScore coalesce', () => {
  test('missing aura_scores row → zero snapshot (never null)', async () => {
    const client = makeClientReturning({ score: null, stars: [] });
    const snap = await getAuraScore(client as never, 'p1');
    expect(snap).toEqual(ZERO_AURA_SNAPSHOT);
  });

  test('real row + earned mentor star → snapshot reflects them', async () => {
    const client = makeClientReturning({
      score: { score: 412 },
      stars: [{ star_id: 'mentor', granted_at: '2026-06-17T00:00:00Z' }],
    });
    const snap = await getAuraScore(client as never, 'p1');
    expect(snap.score).toBe(412);
    expect(snap.stars.mentor).toBe(true);
    expect(snap.stars.creatore).toBe(false);
  });

  test('score row but no stars → score set, all stars false', async () => {
    const client = makeClientReturning({ score: { score: 99 }, stars: [] });
    const snap = await getAuraScore(client as never, 'p1');
    expect(snap.score).toBe(99);
    expect(Object.values(snap.stars).every((v) => v === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Minimal chainable stub — matches the repo's api test helper style (moments.test.ts)
// ---------------------------------------------------------------------------

function makeClientReturning(fixtures: { score: unknown; stars: unknown[] }) {
  const score = fixtures.score as { score: number } | null;
  return {
    from(table: string) {
      if (table === 'aura_scores') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: score, error: null }) }),
          }),
        };
      }
      // stars table
      return { select: () => ({ eq: () => ({ data: fixtures.stars, error: null }) }) };
    },
  };
}

// ---------------------------------------------------------------------------
// Rule #1 — Aura is never client-writable. This package may only read.
// ---------------------------------------------------------------------------

const P = '00000000-0000-0000-0000-0000000000a1';
const EV1 = '00000000-0000-0000-0000-0000000000e1';
const EV2 = '00000000-0000-0000-0000-0000000000e2';

const SCORE_TABLES = ['aura_scores', 'aura_events', 'stars'];

const ledgerRow = (over: Record<string, unknown> = {}) => ({
  id: EV1,
  profile_id: P,
  type: 'event_attended',
  points: 15,
  ref_id: null,
  reason: null,
  created_at: '2026-08-01T10:00:00Z',
  ...over,
});

const starRow = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-0000000000b1',
  profile_id: P,
  star_id: 'mentor',
  granted_at: '2026-07-01T00:00:00Z',
  progress: { done: 3, total: 3, unit: 'aiuti' },
  ...over,
});

const scoreRow = (over: Record<string, unknown> = {}) => ({
  profile_id: P,
  score: 412,
  breakdown: {
    contributi: 100,
    eventi: 150,
    collaborazioni: 80,
    valore: 42,
    recensioni: 20,
    affidabilita: 20,
  },
  peak_score: 500,
  last_qualifying_action_at: '2026-08-01T10:00:00Z',
  computed_at: '2026-08-02T03:00:00Z',
  ...over,
});

const asClient = (fake: ReturnType<typeof makeFakeClient>) => fake as unknown as AthanorClient;

describe('Aura write surface (rule #1)', () => {
  it('exposes no mutation-shaped export', () => {
    const writeVerb =
      /^(add|award|grant|give|set|update|insert|upsert|write|create|delete|remove|increment|bump|adjust|recompute)/i;
    const offenders = Object.keys(auraApi).filter((name) => writeVerb.test(name));
    expect(offenders).toEqual([]);
  });

  it('offers no mutation query key — the engine owns every write', () => {
    const keys = [...Object.keys(auraKeys), ...Object.keys(ledgerKeys), ...Object.keys(starKeys)];
    expect(keys.filter((k) => /mutation|award|grant|write/i.test(k))).toEqual([]);
  });

  it('every read path touches the score tables with select only', async () => {
    const fake = makeFakeClient({
      'aura_scores.select': [{ data: [scoreRow()] }, { data: [scoreRow()] }],
      'aura_events.select': [{ data: [ledgerRow()] }, { data: [ledgerRow()] }],
      'stars.select': [{ data: [starRow()] }, { data: [starRow()] }],
    });
    const client = asClient(fake);

    await getAuraScore(client, P);
    await getAuraScoreFull(client, P);
    await getAuraLedgerPage(client, P);
    await getAuraEventsSince(client, P, '2026-07-01T00:00:00Z');
    await getStars(client, P);

    const touched = fake.calls.filter((c) => SCORE_TABLES.includes(c.table));
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((c) => c.op === 'select')).toBe(true);
    expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot reads
// ---------------------------------------------------------------------------

describe('getAuraScore (fake client)', () => {
  it('reads the caller"s score and stars scoped by profile', async () => {
    const fake = makeFakeClient({
      'aura_scores.select': [{ data: [{ score: 412 }] }],
      'stars.select': [{ data: [starRow()] }],
    });
    const snap = await getAuraScore(asClient(fake), P);
    expect(snap.score).toBe(412);
    expect(snap.stars.mentor).toBe(true);
    expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['eq', 'profile_id', P]]));
  });

  // A failed read must NOT be indistinguishable from an absent row: the zero snapshot is
  // reserved for a member the engine has not scored yet. An RLS denial / timeout that
  // resolved as "0 with six dark stars" would be cached by TanStack Query as truth.
  it('rejects when the score read fails instead of rendering a zero snapshot', async () => {
    const fake = makeFakeClient({
      'aura_scores.select': [{ error: { message: 'rls denied' } }],
      'stars.select': [{ data: [starRow()] }],
    });
    await expect(getAuraScore(asClient(fake), P)).rejects.toThrow('rls denied');
  });

  it('rejects when the stars read fails, even though the score read succeeded', async () => {
    const fake = makeFakeClient({
      'aura_scores.select': [{ data: [{ score: 412 }] }],
      'stars.select': [{ error: { message: 'timeout' } }],
    });
    await expect(getAuraScore(asClient(fake), P)).rejects.toThrow('timeout');
  });

  it('still coalesces a genuinely unscored member to the zero snapshot', async () => {
    const fake = makeFakeClient({
      'aura_scores.select': [{ data: [] }],
      'stars.select': [{ data: [] }],
    });
    await expect(getAuraScore(asClient(fake), P)).resolves.toEqual(ZERO_AURA_SNAPSHOT);
  });
});

describe('getAuraScoreFull', () => {
  it('maps the engine row into the breakdown snapshot', async () => {
    const fake = makeFakeClient({ 'aura_scores.select': [{ data: [scoreRow()] }] });
    const full = await getAuraScoreFull(asClient(fake), P);
    expect(full).toMatchObject({
      profileId: P,
      score: 412,
      peakScore: 500,
      breakdown: { eventi: 150, contributi: 100 },
    });
  });

  it('coalesces a missing row to a zero score rather than null', async () => {
    const fake = makeFakeClient({ 'aura_scores.select': [{ data: [] }] });
    const full = await getAuraScoreFull(asClient(fake), P);
    expect(full.score).toBe(0);
    expect(full.peakScore).toBe(0);
    expect(Object.values(full.breakdown).every((v) => v === 0)).toBe(true);
  });

  // Same corrected contract as getAuraScore: only a null row means "not scored yet".
  it('rejects on a failed read rather than reporting a zero score', async () => {
    const fake = makeFakeClient({ 'aura_scores.select': [{ error: { message: 'boom' } }] });
    await expect(getAuraScoreFull(asClient(fake), P)).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// Ledger — rule #9 keyset, never offset
// ---------------------------------------------------------------------------

describe('getAuraLedgerPage', () => {
  it('pages newest-first on a keyset and never issues an offset range', async () => {
    const fake = makeFakeClient({
      'aura_events.select': [
        { data: [ledgerRow(), ledgerRow({ id: EV2, created_at: '2026-07-30T10:00:00Z' })] },
      ],
    });
    const page = await getAuraLedgerPage(asClient(fake), P, { limit: 2 });

    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toEqual({ ts: '2026-07-30T10:00:00Z', id: EV2 });
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
    expect(fake.calls[0]!.modifiers).toEqual(expect.arrayContaining([['limit', 2]]));
  });

  it('returns a null cursor on a short page', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: [ledgerRow()] }] });
    const page = await getAuraLedgerPage(asClient(fake), P, { limit: 20 });
    expect(page.nextCursor).toBeNull();
  });

  it('carries the cursor as a keyset predicate', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: [] }] });
    await getAuraLedgerPage(asClient(fake), P, {
      cursor: { ts: '2026-08-01T10:00:00Z', id: EV1 },
    });
    const or = fake.calls[0]!.filters.find((f) => f[0] === 'or');
    expect(String(or?.[1])).toContain('created_at.lt.2026-08-01T10:00:00Z');
  });

  it('filters the gained view to positive points only', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: [ledgerRow()] }] });
    await getAuraLedgerPage(asClient(fake), P, { filter: 'gained' });
    expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['gt', 'points', 0]]));
  });

  it('filters the decayed view to negative points only', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: [ledgerRow({ points: -8 })] }] });
    await getAuraLedgerPage(asClient(fake), P, { filter: 'decayed' });
    expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['lt', 'points', 0]]));
  });

  it('applies no points filter to the all view', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: [ledgerRow()] }] });
    await getAuraLedgerPage(asClient(fake), P, { filter: 'all' });
    expect(fake.calls[0]!.filters.some((f) => f[1] === 'points')).toBe(false);
  });

  it('scopes the ledger to the owner', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: [] }] });
    await getAuraLedgerPage(asClient(fake), P);
    expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['eq', 'profile_id', P]]));
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ error: { message: 'boom' } }] });
    await expect(getAuraLedgerPage(asClient(fake), P)).rejects.toThrow();
  });
});

describe('getAuraEventsSince', () => {
  it('reads the owner"s bounded recent window without an offset', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: [ledgerRow()] }] });
    const rows = await getAuraEventsSince(asClient(fake), P, '2026-07-01T00:00:00Z');

    expect(rows).toHaveLength(1);
    expect(fake.calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'profile_id', P],
        ['gte', 'created_at', '2026-07-01T00:00:00Z'],
      ]),
    );
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'range')).toBe(false);
    expect(fake.calls[0]!.modifiers.some((m) => m[0] === 'limit')).toBe(true);
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ error: { message: 'boom' } }] });
    await expect(getAuraEventsSince(asClient(fake), P, '2026-07-01T00:00:00Z')).rejects.toThrow();
  });
});

describe('getStars', () => {
  it('returns the six-star grants for a profile', async () => {
    const fake = makeFakeClient({ 'stars.select': [{ data: [starRow()] }] });
    const stars = await getStars(asClient(fake), P);
    expect(stars).toHaveLength(1);
    expect(stars[0]).toMatchObject({ starId: 'mentor', progress: { done: 3, total: 3 } });
    expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['eq', 'profile_id', P]]));
  });

  it('throws when the database errors', async () => {
    const fake = makeFakeClient({ 'stars.select': [{ error: { message: 'boom' } }] });
    await expect(getStars(asClient(fake), P)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Realtime — the engine is the only producer
// ---------------------------------------------------------------------------

describe('subscribeAura', () => {
  /**
   * The private aura topic is joined only after `realtime.setAuth()` resolves, so the
   * channel does not exist until the microtask queue drains.
   */
  async function subscribeAndJoin(
    fake: ReturnType<typeof makeFakeClient>,
    handlers: Parameters<typeof subscribeAura>[2],
  ) {
    const client = {
      ...fake,
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AthanorClient;
    const cleanup = subscribeAura(client, P, handlers);
    await Promise.resolve();
    await Promise.resolve();
    return cleanup;
  }

  const findByTable = (fake: ReturnType<typeof makeFakeClient>, table: string) =>
    fake.channels
      .flatMap((c) => c.events)
      .find((e) => (e[1] as { table?: string })?.table === table)?.[2] as
      | ((p: { new: unknown }) => void)
      | undefined;

  it('routes score, ledger and star changes to their handlers', async () => {
    const fake = makeFakeClient();
    const score: unknown[] = [];
    const events: unknown[] = [];
    const stars: unknown[] = [];

    await subscribeAndJoin(fake, {
      onScore: (r) => score.push(r),
      onEvent: (r) => events.push(r),
      onStar: (r) => stars.push(r),
    });

    findByTable(fake, 'aura_scores')?.({ new: scoreRow() });
    findByTable(fake, 'aura_events')?.({ new: ledgerRow() });
    findByTable(fake, 'stars')?.({ new: starRow() });

    expect(score).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(stars).toHaveLength(1);
  });

  it('authorises the private topic before joining it', async () => {
    const fake = makeFakeClient();
    const setAuth = vi.fn().mockResolvedValue(undefined);
    const client = { ...fake, realtime: { setAuth } } as unknown as AthanorClient;

    subscribeAura(client, P, { onScore: () => {} });
    expect(fake.channels).toHaveLength(0); // no join before setAuth resolves
    await Promise.resolve();
    await Promise.resolve();

    expect(setAuth).toHaveBeenCalled();
    expect(fake.channels[0]!.name).toBe(`aura:${P}`);
    expect(fake.channels[0]!.subscribed).toBe(true);
  });

  it('returns a cleanup that removes the channel (rule api.md)', async () => {
    const fake = makeFakeClient();
    const cleanup = await subscribeAndJoin(fake, { onScore: () => {} });
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(fake.channels.every((c) => c.removed)).toBe(true);
  });

  it('never joins when cleanup runs before authorisation resolves', async () => {
    const fake = makeFakeClient();
    const client = {
      ...fake,
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AthanorClient;

    const cleanup = subscribeAura(client, P, { onScore: () => {} });
    cleanup();
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.channels).toHaveLength(0);
  });

  it('delivers a validated celebration payload', async () => {
    const fake = makeFakeClient();
    const seen: unknown[] = [];
    await subscribeAndJoin(fake, { onCelebration: (p) => seen.push(p) });

    const broadcast = fake.channels
      .flatMap((c) => c.events)
      .find((e) => e[0] === 'broadcast')?.[2] as ((p: unknown) => void) | undefined;
    expect(broadcast).toBeDefined();
    broadcast?.({ payload: { tier_up: 'ardente', new_stars: ['mentor'], score: 412 } });

    expect(seen).toEqual([{ tier_up: 'ardente', new_stars: ['mentor'], score: 412 }]);
  });

  it('drops a celebration payload that fails validation', async () => {
    const fake = makeFakeClient();
    const seen: unknown[] = [];
    await subscribeAndJoin(fake, { onCelebration: (p) => seen.push(p) });

    const broadcast = fake.channels
      .flatMap((c) => c.events)
      .find((e) => e[0] === 'broadcast')?.[2] as ((p: unknown) => void) | undefined;
    broadcast?.({ payload: { score: 'molto alta' } });

    expect(seen).toEqual([]);
  });
});

describe('aura key namespacing', () => {
  it('gives every cache slot a distinct key across the three roots', () => {
    const keys = [
      auraKeys.all,
      auraKeys.detail(P),
      auraKeys.score(P),
      auraKeys.recap(P),
      ledgerKeys.all,
      ledgerKeys.list(P, 'all'),
      ledgerKeys.list(P, 'gained'),
      ledgerKeys.list(P, 'decayed'),
      starKeys.all,
      starKeys.list(P),
      starKeys.progress(P),
    ];

    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
  });

  it('separates the ledger cache per profile', () => {
    expect(ledgerKeys.list(P, 'all')).not.toEqual(ledgerKeys.list(EV1, 'all'));
  });
});

// These pin the `?? []` / `?? 0` guards, which are belt-and-braces rather than reachable: a
// zero-match list select returns `[]`, and after `if (error) throw error` TypeScript has already
// narrowed `data` to T[]. Covering them is still worth it here — this is the Aura surface, the
// guards back the score screen, the ledger and the six stars at once, and a "simplification"
// that deletes one should fail rather than pass.
describe('Aura reads survive a null payload rather than crashing', () => {
  // Not the early ZERO_AURA_SNAPSHOT return: that fires only when the score row AND the stars
  // are both absent. These two cases each have one side present, so execution reaches the
  // coalescing arms further down.
  it('a score row with a null stars payload yields the score and no lit stars', async () => {
    const fake = makeFakeClient({
      'aura_scores.select': [{ data: { score: 482 } }],
      'stars.select': [{ data: null }],
    });
    const snap = await getAuraScore(asClient(fake), P);
    expect(snap.score).toBe(482);
    expect(Object.values(snap.stars).every((v) => v === false)).toBe(true);
  });

  it('stars without a score row yield zero, not a crash', async () => {
    const fake = makeFakeClient({
      'aura_scores.select': [{ data: null }],
      'stars.select': [{ data: [{ star_id: 'mentor', granted_at: '2026-07-01T00:00:00Z' }] }],
    });
    const snap = await getAuraScore(asClient(fake), P);
    expect(snap.score).toBe(0);
    expect(snap.stars.mentor).toBe(true);
  });

  it('getAuraLedgerPage treats a null payload as an empty ledger', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: null }] });
    await expect(getAuraLedgerPage(asClient(fake), P)).resolves.toMatchObject({ rows: [] });
  });

  it('getAuraEventsSince treats a null payload as no events', async () => {
    const fake = makeFakeClient({ 'aura_events.select': [{ data: null }] });
    await expect(getAuraEventsSince(asClient(fake), P, '2026-07-01T00:00:00Z')).resolves.toEqual(
      [],
    );
  });

  it('getStars treats a null payload as no stars', async () => {
    const fake = makeFakeClient({ 'stars.select': [{ data: null }] });
    await expect(getStars(asClient(fake), P)).resolves.toEqual([]);
  });
});
