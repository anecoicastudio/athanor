// deno test supabase/functions/score-engine/ — runs in CI (edge job) and locally.
// Characterization tests for the award/decay engine (rule #1: this fn is the SOLE
// Aura writer). Fixed injected clock + all db I/O through the injected fake
// (repo convention: DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import { bodySchema, runAward, runDecay, runStars, type ScoreCtx, windowStart } from './logic.ts';

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
    counterparty_id: null, // solo event — own_milestone has no other party
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

// ── pairwise dampening (PRD §4.9 "reciprocal exchanges dampened") ────────────
// The rule is PAIRWISE — per counterparty. It used to be keyed on refId, which for
// milestone_help is the milestone_helps row id: unique per help, so the exchange index never
// advanced past 1 and the dampening never fired. Two colluding accounts confirming each
// other's fabricated milestones collected the full +40 indefinitely and hit the 1000 clamp in
// roughly 25 exchanges.

const COUNTERPARTY = '00000000-0000-0000-0000-0000000000c1';

/** Award scripting for a milestone_help that lands, with `priorPair` earlier pair events. */
const helpCtx = (priorPair: number) =>
  ctx({
    // FIFO on aura_events: [0] the dampening count, [1] the re-aggregation read,
    // [2] gatherStarFacts' ledger-type count.
    'aura_events.select': [{ count: priorPair }, { data: [] }, { data: [] }],
    'aura_events.insert': [{}],
    'aura_scores.select': [{ data: { score: 0, peak_score: 0, last_qualifying_action_at: null } }],
    'stars.select': [{ data: [] }],
    'dreams.select': [{ data: [] }],
    'posts.select': [{ data: [] }],
    'invites.select': [{ count: 0 }],
  });

const awardHelp = (c: ReturnType<typeof ctx>, counterpartyId: string | null, refId = REF) =>
  runAward(c, { mode: 'award', profileId: PROFILE, type: 'milestone_help', refId, counterpartyId });

Deno.test('award: the dampening count is keyed on the counterparty, not the artifact', async () => {
  const c = helpCtx(0);
  await awardHelp(c, COUNTERPARTY);
  const countRead = c.db.calls.find((call) => call.table === 'aura_events' && call.op === 'select');
  assert(countRead, 'no dampening read was issued');
  assert(
    countRead.filters.some((f) => f[0] === 'eq' && f[1] === 'counterparty_id'),
    'the dampening count does not filter on counterparty_id',
  );
  assert(
    !countRead.filters.some((f) => f[0] === 'eq' && f[1] === 'ref_id'),
    'the dampening count still filters on ref_id — a fresh artifact would reset the curve',
  );
});

Deno.test('award: the first exchange with a counterparty is worth the full +40', async () => {
  const c = helpCtx(0);
  assertEquals((await awardHelp(c, COUNTERPARTY).then((r) => r.json())).awarded, 40);
});

Deno.test('award: a repeat exchange with the SAME counterparty is dampened', async () => {
  // Two priors → third exchange → factor 1/(1+0.5·2) = 0.5 → 20.
  const c = helpCtx(2);
  assertEquals((await awardHelp(c, COUNTERPARTY).then((r) => r.json())).awarded, 20);
});

Deno.test('award: a NEW milestone with the same counterparty is still dampened', async () => {
  // The collusion loop: a fresh milestone means a fresh refId. Keyed on the counterparty it
  // no longer matters, which is the whole point of the fix.
  const c = helpCtx(2);
  const fresh = '00000000-0000-0000-0000-00000000f00d';
  assertEquals((await awardHelp(c, COUNTERPARTY, fresh).then((r) => r.json())).awarded, 20);
});

Deno.test('award: a different counterparty is a fresh curve, not a penalty', async () => {
  // Helping many different people must stay fully rewarded — the rule targets reciprocity,
  // not generosity.
  const c = helpCtx(0);
  const other = '00000000-0000-0000-0000-0000000000c2';
  assertEquals((await awardHelp(c, other).then((r) => r.json())).awarded, 40);
});

Deno.test('award: the counterparty is persisted on the ledger row', async () => {
  // Without this the next award reads a count of zero and the curve resets every time.
  const c = helpCtx(0);
  await awardHelp(c, COUNTERPARTY);
  const insert = c.db.calls.find((call) => call.table === 'aura_events' && call.op === 'insert');
  assertEquals((insert?.values as { counterparty_id?: string }).counterparty_id, COUNTERPARTY);
});

Deno.test(
  'award: a solo event issues no dampening read and stores a null counterparty',
  async () => {
    const c = ctx({
      'aura_events.insert': [{}],
      'aura_events.select': [{ data: [] }, { data: [] }],
      'aura_scores.select': [
        { data: { score: 0, peak_score: 0, last_qualifying_action_at: null } },
      ],
      'stars.select': [{ data: [] }],
      'dreams.select': [{ data: [] }],
      'posts.select': [{ data: [] }],
      'invites.select': [{ count: 0 }],
    });
    await runAward(c, { mode: 'award', profileId: PROFILE, type: 'own_milestone', refId: REF });
    const insert = c.db.calls.find((call) => call.table === 'aura_events' && call.op === 'insert');
    assertEquals((insert?.values as { counterparty_id?: string | null }).counterparty_id, null);
  },
);

Deno.test('award: an unresolvable counterparty falls back to the undampened award', async () => {
  // The trigger emits JSON null when the dream was hard-deleted. Denying the helper their
  // points because the owner's dream vanished would punish the wrong person.
  const c = helpCtx(0);
  assertEquals((await awardHelp(c, null).then((r) => r.json())).awarded, 40);
});

// ── post_starred (issue #27: the payload must carry the reactor's Aura) ─────
// pointsFor gates on ctx.reviewerScore > REACTION_AUTHOR_MIN_SCORE (300) and
// multiplies the base 2 by reviewerWeight(s) — every qualifying ✦ awards 3.
// The curve's 4 arm needs a reactor at ≥1118, above the aura_scores 0–1000
// clamp (core clamp.ts + check constraint), so it is unreachable (#55).
// Until the enqueue plumbing landed, the pg_net body carried no reviewerScore
// at all, `?? 0` failed the gate, and every ✦ awarded 0 with no ledger row.

/** Award scripting for a post_starred that lands: [0] day-cap count, then the happy path. */
const starCtx = () =>
  ctx({
    // FIFO on aura_events: [0] the day-cap count, [1] re-aggregation, [2] star facts.
    'aura_events.select': [{ count: 0 }, { data: [] }, { data: [] }],
    'aura_events.insert': [{}],
    'aura_scores.select': [{ data: { score: 0, peak_score: 0, last_qualifying_action_at: null } }],
    'stars.select': [{ data: [] }],
    'dreams.select': [{ data: [] }],
    'posts.select': [{ data: [] }],
    'invites.select': [{ count: 0 }],
  });

Deno.test('award: a ✦ carrying the reactor score above the gate lands at 3', async () => {
  const c = starCtx();
  const res = await runAward(c, {
    mode: 'award',
    profileId: PROFILE,
    type: 'post_starred',
    refId: REF,
    ctx: { reviewerScore: 500 },
  });
  assertEquals(((await res.json()) as { awarded: number }).awarded, 3);
  const ins = c.db.calls.find((call) => call.table === 'aura_events' && call.op === 'insert');
  assert(ins, 'no ledger row was inserted');
  assertEquals((ins.values as { points: number }).points, 3);
  // The score used is persisted in reason so the ledger explains its own numbers.
  assertEquals((ins.values as { reason: { reviewerScore?: number } }).reason.reviewerScore, 500);
});

Deno.test(
  'award: a domain-max reactor (1000) still awards 3 — 4 sits above the clamp',
  async () => {
    const c = starCtx();
    const res = await runAward(c, {
      mode: 'award',
      profileId: PROFILE,
      type: 'post_starred',
      refId: REF,
      ctx: { reviewerScore: 1000 },
    });
    assertEquals(((await res.json()) as { awarded: number }).awarded, 3);
  },
);

Deno.test('award: a sub-gate reactor score → skipped, no ledger row', async () => {
  const c = ctx({ 'aura_events.select': [{ count: 0 }] }); // the day-cap read only
  const res = await runAward(c, {
    mode: 'award',
    profileId: PROFILE,
    type: 'post_starred',
    refId: REF,
    ctx: { reviewerScore: 300 }, // gate is STRICTLY above 300
  });
  assertEquals(await res.json(), { awarded: 0, skipped: true });
  assert(!c.db.calls.some((call) => call.op === 'insert'));
});

Deno.test('award: a ✦ with no reviewerScore in ctx (pre-#27 payload) → skipped', async () => {
  const c = ctx({ 'aura_events.select': [{ count: 0 }] });
  const res = await runAward(c, {
    mode: 'award',
    profileId: PROFILE,
    type: 'post_starred',
    refId: REF,
  });
  assertEquals(await res.json(), { awarded: 0, skipped: true });
  assert(!c.db.calls.some((call) => call.op === 'insert'));
});

// ── runStars (issue #121: stars-only mode, no score touched) ─────────────────
// Invite activation enqueues { mode: 'stars' } so an invite-only profile can earn
// Ambasciatore. The run re-evaluates all six stars from facts and writes ONLY the
// stars table — never aura_events or aura_scores (rule #1: invites are worth zero).

/** Stars-mode scripting for an otherwise-empty world. gatherStarFacts skips the
 *  dream_milestones / post_reactions reads when dreams / posts come back empty. */
const starsCtx = (invites: number, existingStars: unknown[] = []) =>
  ctx({
    'stars.select': [{ data: existingStars }],
    'aura_events.select': [{ data: [] }],
    'dreams.select': [{ data: [] }],
    'posts.select': [{ data: [] }],
    'invites.select': [{ count: invites }],
  });

Deno.test('bodySchema accepts a stars body and rejects malformed ones', () => {
  assert(bodySchema.safeParse({ mode: 'stars', profileId: PROFILE }).success);
  assert(!bodySchema.safeParse({ mode: 'stars' }).success); // no profileId
  assert(!bodySchema.safeParse({ mode: 'stars', profileId: 'not-a-uuid' }).success);
});

Deno.test(
  'stars: invite-only profile at 5 activations → Ambasciatore lit, zero Aura writes (#121)',
  async () => {
    const c = starsCtx(5);
    const res = await runStars(c, { mode: 'stars', profileId: PROFILE });
    const body = (await res.json()) as { starsGranted: string[]; newStars: string[] };
    assert(body.starsGranted.includes('ambasciatore'));
    assertEquals(body.newStars, ['ambasciatore']);

    // All six star rows upserted; Ambasciatore granted at the injected now, ring full.
    const ups = c.db.calls.filter((call) => call.table === 'stars' && call.op === 'upsert');
    assertEquals(ups.length, 6);
    const amb = ups.find((u) => (u.values as { star_id: string }).star_id === 'ambasciatore');
    assert(amb);
    assertEquals(amb.values, {
      profile_id: PROFILE,
      star_id: 'ambasciatore',
      granted_at: NOW_ISO,
      progress: { done: 5, total: 5, unit: 'inviti' },
    });
    assertEquals(amb.options, { onConflict: 'profile_id,star_id' });

    // Celebration for the new star; no tier-up — no score changed in a stars run.
    const rpc = c.db.calls.find((call) => call.op === 'rpc');
    assert(rpc);
    assertEquals(rpc.columns, 'broadcast_aura_celebration');
    assertEquals(rpc.values, {
      p_profile_id: PROFILE,
      p_tier_up: null,
      p_new_stars: ['ambasciatore'],
    });

    // Rule #1: a stars run never writes the ledger or the score snapshot.
    assert(!c.db.calls.some((call) => call.table === 'aura_events' && call.op !== 'select'));
    assert(!c.db.calls.some((call) => call.table === 'aura_scores'));
  },
);

Deno.test('stars: zero activity → six ungranted progress rows, no celebration', async () => {
  const c = starsCtx(0);
  const res = await runStars(c, { mode: 'stars', profileId: PROFILE });
  const body = (await res.json()) as { starsGranted: string[]; newStars: string[] };
  assertEquals(body.starsGranted, []);
  assertEquals(body.newStars, []);

  const ups = c.db.calls.filter((call) => call.table === 'stars' && call.op === 'upsert');
  assertEquals(ups.length, 6);
  for (const u of ups) assertEquals((u.values as { granted_at: unknown }).granted_at, null);
  assert(!c.db.calls.some((call) => call.op === 'rpc'));
});

Deno.test(
  'stars: an already-earned star keeps its grant date and is not re-celebrated',
  async () => {
    const EARNED_AT = '2026-01-01T00:00:00.000Z';
    const c = starsCtx(5, [{ star_id: 'ambasciatore', granted_at: EARNED_AT }]);
    const res = await runStars(c, { mode: 'stars', profileId: PROFILE });
    const body = (await res.json()) as { starsGranted: string[]; newStars: string[] };
    assert(body.starsGranted.includes('ambasciatore')); // still meets the criteria
    assertEquals(body.newStars, []); // but nothing is NEW

    const amb = c.db.calls.find(
      (call) =>
        call.table === 'stars' &&
        call.op === 'upsert' &&
        (call.values as { star_id: string }).star_id === 'ambasciatore',
    );
    assert(amb);
    // I3: the original grant date survives the re-sweep.
    assertEquals((amb.values as { granted_at: string }).granted_at, EARNED_AT);
    assert(!c.db.calls.some((call) => call.op === 'rpc'));
  },
);

Deno.test('bodySchema accepts a null counterpartyId, as jsonb_build_object emits it', () => {
  assert(
    bodySchema.safeParse({
      mode: 'award',
      profileId: PROFILE,
      type: 'milestone_help',
      refId: REF,
      counterpartyId: null,
    }).success,
  );
  assert(
    !bodySchema.safeParse({
      mode: 'award',
      profileId: PROFILE,
      type: 'milestone_help',
      counterpartyId: 'not-a-uuid',
    }).success,
  );
});
