// deno test supabase/functions/score-engine/ — runs in CI (edge job) and locally.
// Characterization tests for the award/decay engine (rule #1: this fn is the SOLE
// Aura writer). Fixed injected clock + all db I/O through the injected fake
// (repo convention: DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { bodySchema, runAward, runDecay, type ScoreCtx, windowStart } from './logic.ts';

const PROFILE = '00000000-0000-0000-0000-000000000001';
const REF = '00000000-0000-0000-0000-00000000beef';
// Fri 2026-08-07 15:30 LOCAL — windowStart is local-calendar math, so expectations
// built with the same Date(y,m,d) constructor are TZ-independent.
const NOW = new Date(2026, 7, 7, 15, 30);
const NOW_ISO = NOW.toISOString();

const ctx = (script: Record<string, FakeResult[]> = {}): ScoreCtx & { db: FakeDb } => {
  const db = makeFakeDb(script);
  return { admin: db as unknown as ScoreCtx['admin'], now: () => NOW, db };
};

// ── windowStart (pure, injected now) ────────────────────────────────────────

Deno.test('windowStart: day/week/month resolve to local calendar starts', () => {
  assertEquals(windowStart('day', NOW), new Date(2026, 7, 7).toISOString());
  // Aug 7 2026 is a Friday → the week began Sunday Aug 2.
  assertEquals(windowStart('week', NOW), new Date(2026, 7, 2).toISOString());
  assertEquals(windowStart('month', NOW), new Date(2026, 7, 1).toISOString());
});

Deno.test('windowStart: lifetime and unknown windows fall back to epoch', () => {
  assertEquals(windowStart('lifetime', NOW), '1970-01-01T00:00:00.000Z');
  assertEquals(windowStart('fortnight', NOW), '1970-01-01T00:00:00.000Z');
});

// ── bodySchema ───────────────────────────────────────────────────────────────

Deno.test('bodySchema accepts award and decay bodies', () => {
  assert(
    bodySchema.safeParse({ mode: 'award', profileId: PROFILE, type: 'own_milestone', refId: REF })
      .success,
  );
  assert(bodySchema.safeParse({ mode: 'decay' }).success);
});

Deno.test('bodySchema rejects malformed bodies', () => {
  assert(!bodySchema.safeParse({ mode: 'award' }).success); // no profileId
  assert(!bodySchema.safeParse({ mode: 'award', profileId: 'not-a-uuid', type: 'x' }).success);
  assert(!bodySchema.safeParse({ mode: 'refund' }).success);
});

// ── runAward ─────────────────────────────────────────────────────────────────

Deno.test(
  'award: over cap → capped, no ledger row (I1); window counted from injected now',
  async () => {
    // event_attended caps at 4/week — a full window zeroes via applyCap.
    const c = ctx({ 'aura_events.select': [{ count: 4 }] });
    const res = await runAward(c, { mode: 'award', profileId: PROFILE, type: 'event_attended' });
    assertEquals(await res.json(), { capped: true });

    assertEquals(c.db.calls.length, 1); // the cap count only — nothing written
    const capQ = c.db.calls[0];
    assertEquals(capQ.op, 'select');
    assert(
      capQ.filters.some(
        ([f, col, v]) => f === 'gte' && col === 'created_at' && v === windowStart('week', NOW),
      ),
    );
  },
);

Deno.test('award: zero-point non-scoring action → skipped, db untouched (rule #1)', async () => {
  const c = ctx();
  const res = await runAward(c, { mode: 'award', profileId: PROFILE, type: 'circle_membership' });
  assertEquals(await res.json(), { awarded: 0, skipped: true });
  assertEquals(c.db.calls.length, 0); // uncapped type + 0 points → no reads, no writes
});

Deno.test('award: duplicate ledger insert (23505) → duplicate, score never touched', async () => {
  const c = ctx({ 'aura_events.insert': [{ error: { code: '23505', message: 'dup' } }] });
  const res = await runAward(c, {
    mode: 'award',
    profileId: PROFILE,
    type: 'own_milestone',
    refId: REF,
  });
  assertEquals(await res.json(), { awarded: 0, duplicate: true });
  assert(!c.db.calls.some((call) => call.table === 'aura_scores'));
  assert(!c.db.calls.some((call) => call.table === 'stars'));
});

Deno.test('award: happy path → ledger row + full re-aggregation upsert + star sweep', async () => {
  const c = ctx({
    'aura_events.insert': [{}], // ledger row lands
    'aura_scores.select': [{ data: { score: 5, peak_score: 20, last_qualifying_action_at: null } }],
    // FIFO: step-6 re-aggregation, then gatherStarFacts' ledger-type count.
    'aura_events.select': [{ data: [{ type: 'own_milestone', points: 10 }] }, { data: [] }],
    'stars.select': [{ data: [] }],
    'dreams.select': [{ data: [] }],
    'posts.select': [{ data: [] }],
    'invites.select': [{ count: 0 }],
  });
  const res = await runAward(c, { mode: 'award', profileId: PROFILE, type: 'own_milestone' });
  assertEquals(await res.json(), {
    awarded: 10,
    score: 10,
    tier: 'scintilla',
    starsGranted: [],
  });

  // Ledger row exactly as computed.
  const ins = c.db.calls.find((call) => call.table === 'aura_events' && call.op === 'insert');
  assert(ins);
  assertEquals(ins.values, {
    profile_id: PROFILE,
    type: 'own_milestone',
    points: 10,
    ref_id: null,
    reason: {},
  });

  // Snapshot upsert: re-aggregated score, peak preserved, both timestamps = injected now.
  const up = c.db.calls.find((call) => call.table === 'aura_scores' && call.op === 'upsert');
  assert(up);
  assertEquals(up.options, { onConflict: 'profile_id' });
  assertEquals(up.values, {
    profile_id: PROFILE,
    score: 10,
    breakdown: {
      contributi: 10,
      eventi: 0,
      collaborazioni: 0,
      valore: 0,
      recensioni: 0,
      affidabilita: 0,
    },
    peak_score: 20, // prior peak > new score → preserved
    last_qualifying_action_at: NOW_ISO,
    computed_at: NOW_ISO,
  });

  // All six stars upserted (progress rows); nothing granted → no celebration RPC.
  assertEquals(
    c.db.calls.filter((call) => call.table === 'stars' && call.op === 'upsert').length,
    6,
  );
  assert(!c.db.calls.some((call) => call.op === 'rpc'));
});

// ── runDecay ─────────────────────────────────────────────────────────────────

/** 45 idle days at fixed NOW → idleWeeks = floor((45−30)/7) = 2. */
const idleRow = (score: number) => ({
  profile_id: 'p1',
  score,
  peak_score: 100,
  last_qualifying_action_at: new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString(),
});

Deno.test(
  'decay: idle profile → decay ledger row + score update that never touches peak/last-action',
  async () => {
    const c = ctx({
      'aura_scores.select': [{ data: [idleRow(100)] }],
      // Non-decay base = 100 → target = round(100 × 0.98²) = 96 (floor 40 not hit).
      'aura_events.select': [{ data: [{ type: 'own_milestone', points: 100 }] }],
    });
    const res = await runDecay(c);
    assertEquals(await res.json(), { decayed: 1 });

    // Stale scan windowed on the injected clock (now − 30d).
    const scan = c.db.calls[0];
    const threshold = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    assert(
      scan.filters.some(
        ([f, col, v]) => f === 'lt' && col === 'last_qualifying_action_at' && v === threshold,
      ),
    );

    // Decay ledger row: delta to target, weeks in reason.
    const ins = c.db.calls.find((call) => call.table === 'aura_events' && call.op === 'insert');
    assert(ins);
    assertEquals(ins.values, {
      profile_id: 'p1',
      type: 'decay',
      points: -4,
      ref_id: null,
      reason: { weeks: 2 },
    });

    // Score update: ONLY score + computed_at — peak_score / last_qualifying_action_at untouched.
    const upd = c.db.calls.find((call) => call.table === 'aura_scores' && call.op === 'update');
    assert(upd);
    assertEquals(Object.keys(upd.values as Record<string, unknown>).sort(), [
      'computed_at',
      'score',
    ]);
    assertEquals(upd.values, { score: 96, computed_at: NOW_ISO });
    assert(upd.filters.some(([f, col, v]) => f === 'eq' && col === 'profile_id' && v === 'p1'));
  },
);

Deno.test(
  'decay: already at target → idempotent no-op (same-night re-run writes nothing)',
  async () => {
    const c = ctx({
      'aura_scores.select': [{ data: [idleRow(96)] }], // score already at target 96
      'aura_events.select': [{ data: [{ type: 'own_milestone', points: 100 }] }],
    });
    const res = await runDecay(c);
    assertEquals(await res.json(), { decayed: 0 });
    assert(!c.db.calls.some((call) => call.op === 'insert' || call.op === 'update'));
  },
);
