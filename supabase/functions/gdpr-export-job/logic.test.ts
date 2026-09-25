// deno test supabase/functions/gdpr-export-job/ — runs in CI (edge job) and locally.
// Characterization tests for the export loop. THE critical invariant (10 §5.3): every
// archive query filters by the requester's own id, with the per-table owner column.
// All db I/O through injected fakes; storage is a recorded capability port (no .storage
// on the fake db — DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import {
  assembleArchive,
  CLAIM_BATCH,
  EXPORT_SPEC,
  type ExportJobCtx,
  type ExportStorage,
  EXPORTS_OBJECT_LIMIT,
  type MediaObject,
  PASS_BUDGET_MS,
  processExportJobs,
  SECTION_PAGE,
  SERVABLE_WINDOW_MS,
  SIGNED_TTL_SECONDS,
} from './logic.ts';

const JOB = 'job-1';
const REQUESTER = 'user-1';
/** The lease stamp claim_export_jobs handed back — every status write must fence on it (#721). */
const CLAIMED = '2026-09-08T03:47:00.000Z';

// ── the completeness pin (#129) ──────────────────────────────────────────────
// Independent literal mirror of EXPORT_SPEC: (archive key, table, expected filter shape).
// A section silently dropped from EXPORT_SPEC — the exact bug #129 fixed for
// event_tickets/event_attendance — fails HERE, not in production. The DB-side half of the
// contract (every FK-to-profiles table is exported or explicitly excluded) lives in
// supabase/tests/0096_gdpr_export_completeness.test.sql.
type ExpectedFilter =
  | { kind: 'eq'; column: string }
  | { kind: 'or'; columns: [string, string] }
  | { kind: 'in'; column: string; parentKey: string };

const EXPECTED_SECTIONS: Record<string, { table: string; filter: ExpectedFilter; one?: true }> = {
  profile: { table: 'profiles', filter: { kind: 'eq', column: 'id' }, one: true },
  dreams: { table: 'dreams', filter: { kind: 'eq', column: 'profile_id' } },
  dream_milestones: {
    table: 'dream_milestones',
    filter: { kind: 'in', column: 'dream_id', parentKey: 'dreams' },
  },
  milestone_helps: { table: 'milestone_helps', filter: { kind: 'eq', column: 'helper_id' } },
  posts: { table: 'posts', filter: { kind: 'eq', column: 'author_id' } },
  post_media: {
    table: 'post_media',
    filter: { kind: 'in', column: 'post_id', parentKey: 'posts' },
  },
  post_reactions: { table: 'post_reactions', filter: { kind: 'eq', column: 'person_id' } },
  post_comments: { table: 'post_comments', filter: { kind: 'eq', column: 'author_id' } },
  moments: { table: 'moments', filter: { kind: 'eq', column: 'owner_id' } },
  momento_proposals: {
    table: 'momento_proposals',
    filter: { kind: 'or', columns: ['user_id', 'candidate_id'] },
  },
  story_segments: { table: 'story_segments', filter: { kind: 'eq', column: 'author_id' } },
  story_reactions: { table: 'story_reactions', filter: { kind: 'eq', column: 'person_id' } },
  projects: { table: 'projects', filter: { kind: 'eq', column: 'author_id' } },
  favor_offers: {
    table: 'favor_offers',
    filter: { kind: 'or', columns: ['actor_id', 'target_id'] },
  },
  events: { table: 'events', filter: { kind: 'eq', column: 'organizer_id' } },
  athanor_days_interest: {
    table: 'athanor_days_interest',
    filter: { kind: 'eq', column: 'user_id' },
  },
  rsvps: { table: 'rsvps', filter: { kind: 'eq', column: 'user_id' } },
  event_tickets: { table: 'event_tickets', filter: { kind: 'eq', column: 'user_id' } },
  event_attendance: {
    table: 'event_attendance',
    filter: { kind: 'in', column: 'ticket_id', parentKey: 'event_tickets' },
  },
  conversations: {
    table: 'conversations',
    filter: { kind: 'or', columns: ['participant_a', 'participant_b'] },
  },
  messages: {
    table: 'messages',
    filter: { kind: 'in', column: 'conversation_id', parentKey: 'conversations' },
  },
  conversation_reads: {
    table: 'conversation_reads',
    filter: { kind: 'eq', column: 'profile_id' },
  },
  connection_requests: {
    table: 'connection_requests',
    filter: { kind: 'or', columns: ['requester_id', 'addressee_id'] },
  },
  connections: {
    table: 'connections',
    filter: { kind: 'or', columns: ['profile_a', 'profile_b'] },
  },
  blocks: { table: 'blocks', filter: { kind: 'eq', column: 'blocker_id' } },
  reports: { table: 'reports', filter: { kind: 'eq', column: 'reporter_id' } },
  notifications: { table: 'notifications', filter: { kind: 'eq', column: 'recipient_id' } },
  notification_preferences: {
    table: 'notification_preferences',
    filter: { kind: 'eq', column: 'profile_id' },
  },
  push_tokens: { table: 'push_tokens', filter: { kind: 'eq', column: 'profile_id' } },
  aura_events: { table: 'aura_events', filter: { kind: 'eq', column: 'profile_id' } },
  aura_scores: { table: 'aura_scores', filter: { kind: 'eq', column: 'profile_id' }, one: true },
  stars: { table: 'stars', filter: { kind: 'eq', column: 'profile_id' } },
  dream_candidacies: { table: 'dream_candidacies', filter: { kind: 'eq', column: 'profile_id' } },
  realization_plans: {
    table: 'realization_plans',
    filter: { kind: 'in', column: 'candidacy_id', parentKey: 'dream_candidacies' },
  },
  realization_plan_phases: {
    table: 'realization_plan_phases',
    filter: { kind: 'in', column: 'plan_id', parentKey: 'realization_plans' },
  },
  candidacy_votes: { table: 'candidacy_votes', filter: { kind: 'eq', column: 'voter_id' } },
  fund_contributions: { table: 'fund_contributions', filter: { kind: 'eq', column: 'profile_id' } },
  circle_memberships: { table: 'circle_memberships', filter: { kind: 'eq', column: 'profile_id' } },
  payout_accounts: {
    table: 'payout_accounts',
    filter: { kind: 'eq', column: 'profile_id' },
    one: true,
  },
  realization_updates: {
    table: 'realization_updates',
    filter: { kind: 'eq', column: 'profile_id' },
  },
  invites: { table: 'invites', filter: { kind: 'or', columns: ['inviter_id', 'invitee_id'] } },
  consent: { table: 'consent', filter: { kind: 'eq', column: 'profile_id' } },
  verifications: { table: 'verifications', filter: { kind: 'eq', column: 'profile_id' } },
  gdpr_export_jobs: { table: 'gdpr_export_jobs', filter: { kind: 'eq', column: 'profile_id' } },
  gdpr_erasure_requests: {
    table: 'gdpr_erasure_requests',
    filter: { kind: 'eq', column: 'profile_id' },
  },
};

type Ctx = ExportJobCtx & {
  db: FakeDb;
  uploads: { path: string; body: string; opts: unknown }[];
  signs: { path: string; ttl: number }[];
  mediaSigns: { paths: string[]; ttl: number }[];
  copies: { bucket: string; from: string; to: string }[];
  removed: string[][];
};

/** A claim row as claim_export_jobs returns it; `ageMs` back-dates created_at for the window fence. */
const claimRow = (ageMs = 0) => ({
  id: JOB,
  profile_id: REQUESTER,
  created_at: new Date(Date.now() - ageMs).toISOString(),
  claimed_at: CLAIMED,
});

const ctx = (
  script: Record<string, FakeResult[]> = {},
  storage: Partial<ExportStorage> = {},
  extra: Partial<Pick<ExportJobCtx, 'getEmail' | 'now'>> = {},
): Ctx => {
  const db = makeFakeDb({
    'rpc.claim_export_jobs': [{ data: [claimRow()] }],
    ...script,
  });
  const uploads: Ctx['uploads'] = [];
  const signs: Ctx['signs'] = [];
  const mediaSigns: Ctx['mediaSigns'] = [];
  const copies: Ctx['copies'] = [];
  const removed: Ctx['removed'] = [];
  return {
    db,
    getEmail: extra.getEmail ?? (() => Promise.resolve({ email: 'luna@example.test' })),
    now: extra.now,
    storage: {
      createSignedUrls:
        storage.createSignedUrls ??
        ((paths, ttl) => {
          mediaSigns.push({ paths, ttl });
          return Promise.resolve({
            data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
          });
        }),
      copyIn:
        storage.copyIn ??
        ((bucket, from, to) => {
          copies.push({ bucket, from, to });
          return Promise.resolve({ error: null });
        }),
      remove:
        storage.remove ??
        ((paths) => {
          removed.push(paths);
          return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
        }),
      upload:
        storage.upload ??
        ((path, body, opts) => {
          uploads.push({ path, body, opts });
          return Promise.resolve({ error: null });
        }),
      createSignedUrl:
        storage.createSignedUrl ??
        ((path, ttl) => {
          signs.push({ path, ttl });
          return Promise.resolve({ data: { signedUrl: 'https://signed.example/x' } });
        }),
    },
    uploads,
    signs,
    mediaSigns,
    copies,
    removed,
  } as unknown as Ctx;
};

const statusUpdates = (db: FakeDb) =>
  db.calls
    .filter((c) => c.table === 'gdpr_export_jobs' && c.op === 'update')
    .map((c) => ({ values: c.values as Record<string, unknown>, filters: c.filters }));

/**
 * Every status write is fenced on the id AND on the stamp the claim handed back, and asks for the
 * row back so a rejected write is visible (#721). A write missing the stamp would land on a job a
 * later pass has already re-claimed.
 */
const assertFenced = (db: FakeDb) => {
  const updates = db.calls.filter((c) => c.table === 'gdpr_export_jobs' && c.op === 'update');
  assert(updates.length > 0, 'there is a status write to fence');
  for (const u of updates) {
    assertEquals(u.filters, [
      ['eq', 'id', JOB],
      ['eq', 'claimed_at', CLAIMED],
    ]);
    assertEquals(u.columns, 'id', 'and asks for the row back, so a lost lease is not silent');
  }
};

/** The pass's job counters; the reap summary riding beside them has tests of its own. */
const assertCounts = async (res: Response, processed: number, failed: number, deferred = 0) => {
  const body = await res.json();
  assertEquals(
    { processed: body.processed, failed: body.failed, deferred: body.deferred },
    { processed, failed, deferred },
  );
};

// ── completeness: EXPORT_SPEC ⇄ the literal mirror ───────────────────────────

Deno.test('EXPORT_SPEC covers exactly the pinned section list, with the pinned filters', () => {
  const expectedKeys = Object.keys(EXPECTED_SECTIONS).sort();
  const specKeys = EXPORT_SPEC.map((s) => s.key).sort();
  assertEquals(specKeys, expectedKeys);

  for (const spec of EXPORT_SPEC) {
    const expected = EXPECTED_SECTIONS[spec.key];
    assertEquals(spec.table, expected.table, `${spec.key} table`);
    assertEquals(spec.mode === 'one', expected.one === true, `${spec.key} cardinality`);
    if (expected.filter.kind === 'eq') {
      assert(spec.mode === 'one' || spec.mode === 'many', `${spec.key} mode`);
      assertEquals(spec.column, expected.filter.column, `${spec.key} owner column`);
    } else if (expected.filter.kind === 'or') {
      assert(spec.mode === 'either', `${spec.key} mode`);
      assertEquals([...spec.columns], expected.filter.columns, `${spec.key} owner columns`);
    } else {
      assert(spec.mode === 'via', `${spec.key} mode`);
      assertEquals(spec.column, expected.filter.column, `${spec.key} join column`);
      assertEquals(spec.parentKey, expected.filter.parentKey, `${spec.key} parent`);
    }
  }
});

Deno.test('every via section names a parent that exists and precedes it', () => {
  const seen = new Set<string>();
  for (const spec of EXPORT_SPEC) {
    if (spec.mode === 'via') {
      assert(seen.has(spec.parentKey), `${spec.key}'s parent ${spec.parentKey} precedes it`);
    }
    seen.add(spec.key);
  }
});

// ── archive assembly (pure) ──────────────────────────────────────────────────

Deno.test('assembleArchive: one key per section, defaulting null → null / []', () => {
  const empty = assembleArchive('2026-08-13T00:00:00.000Z', {});
  assertEquals(
    Object.keys(empty).sort(),
    ['exported_at', 'link_expires_at', 'account', 'media', ...EXPORT_SPEC.map((s) => s.key)].sort(),
    'archive keys = exported_at, link_expires_at, account, media + every EXPORT_SPEC key',
  );
  assertEquals(empty.account, { email: null });
  assertEquals(empty.media, { complete: true, files: [], not_included: [] });
  assertEquals(empty.exported_at, '2026-08-13T00:00:00.000Z');
  assertEquals(empty.profile, null);
  assertEquals(empty.aura_scores, null);
  assertEquals(empty.dreams, []);
  assertEquals(empty.event_tickets, []);
  assertEquals(empty.event_attendance, []);

  const full = assembleArchive('2026-08-13T00:00:00.000Z', {
    profile: { data: { id: REQUESTER } },
    dreams: { data: [{ id: 'd1' }] },
    event_attendance: { data: [{ id: 'att1' }] },
  });
  assertEquals(full.profile, { id: REQUESTER });
  assertEquals(full.dreams, [{ id: 'd1' }]);
  assertEquals(full.event_attendance, [{ id: 'att1' }]);
});

// ── the own-data invariant ───────────────────────────────────────────────────

Deno.test(
  'claim query + every archive query filters by the requester (per-table shape)',
  async () => {
    // script every via parent with rows so the join queries actually run. realization_plans
    // is both: a child of dream_candidacies and the parent of its phases, so its scripted
    // result is what the phases join reads — the two-level chain #400 added.
    const c = ctx({
      'conversations.select': [{ data: [{ id: 'cv1' }] }],
      'dreams.select': [{ data: [{ id: 'd1' }, { id: 'd2' }] }],
      'posts.select': [{ data: [{ id: 'p1' }] }],
      'event_tickets.select': [{ data: [{ id: 't1' }, { id: 't2' }] }],
      'dream_candidacies.select': [{ data: [{ id: 'c1' }] }],
      'realization_plans.select': [{ data: [{ id: 'rp1' }, { id: 'rp2' }] }],
    });
    await processExportJobs(c);

    // claim: the atomic RPC (#721), never a select-then-update. The predicate itself is the
    // database's and 0057 proves it; this loop's half of the contract is that it ASKS.
    const claim = c.db.calls.find(
      (call) => call.op === 'rpc' && call.columns === 'claim_export_jobs',
    );
    assert(claim);
    assertEquals(claim.columns, 'claim_export_jobs');
    assertEquals(claim.values, { p_limit: CLAIM_BATCH });
    // The only gdpr_export_jobs SELECT left is the archive's own section (`select('*')`, the
    // member's export history). The queue read the claim replaced was the narrow-column one.
    assertEquals(
      c.db.calls.filter(
        (call) => call.table === 'gdpr_export_jobs' && call.op === 'select' && call.columns !== '*',
      ).length,
      0,
      'the loop never reads the queue itself — the claim is the only way in',
    );

    // own-data (10 §5.3): each section filtered by the requester's id via ITS pinned shape.
    for (const [key, expected] of Object.entries(EXPECTED_SECTIONS)) {
      const call = c.db.calls.find(
        (k) => k.table === expected.table && k.op === 'select' && k.columns === '*' && k !== claim,
      );
      assert(call, `${key} queried`);
      if (expected.filter.kind === 'eq') {
        assertEquals(
          call.filters,
          [['eq', expected.filter.column, REQUESTER]],
          `${key} filtered by ${expected.filter.column}`,
        );
      } else if (expected.filter.kind === 'or') {
        const [a, b] = expected.filter.columns;
        assertEquals(
          call.filters,
          [['or', `${a}.eq.${REQUESTER},${b}.eq.${REQUESTER}`]],
          `${key} or-filtered by ${a}/${b}`,
        );
      } else {
        const parentTable = EXPECTED_SECTIONS[expected.filter.parentKey].table;
        const parentCall = c.db.calls.find((k) => k.table === parentTable && k.columns === '*');
        assert(parentCall, `${key}'s parent ${parentTable} queried`);
        // ids come from the scripted parent rows at the top of this test
        const parentIds = {
          conversations: ['cv1'],
          dreams: ['d1', 'd2'],
          posts: ['p1'],
          event_tickets: ['t1', 't2'],
          dream_candidacies: ['c1'],
          realization_plans: ['rp1', 'rp2'],
        }[expected.filter.parentKey];
        assert(parentIds, `${key}'s parent ${expected.filter.parentKey} is scripted above`);
        assertEquals(
          call.filters,
          [['in', expected.filter.column, parentIds]],
          `${key} joined via parent ids`,
        );
      }
    }
  },
);

Deno.test('a requester with no parent rows skips the child join queries entirely', async () => {
  const c = ctx(); // unscripted → every parent resolves data: null → []
  await processExportJobs(c);
  for (const table of [
    'messages',
    'dream_milestones',
    'post_media',
    'event_attendance',
    'realization_plans',
    // two hops down: no candidacy → no plan → no phase, without either query running
    'realization_plan_phases',
  ]) {
    assertEquals(
      c.db.calls.filter((k) => k.table === table).length,
      0,
      `${table} not queried without parent rows`,
    );
  }
  // …but the archive still carries the empty sections
  const archived = JSON.parse(c.uploads[0].body);
  assertEquals(archived.dream_milestones, []);
  assertEquals(archived.event_attendance, []);
  assertEquals(archived.realization_plan_phases, []);
});

// ── #400: the winner's plan reaches the archive, not just the spec list ──────

Deno.test("a winner's archive carries the realization plan and its phases", async () => {
  const PLAN = {
    id: 'rp1',
    edition_id: 'ed1',
    candidacy_id: 'c1',
    objective: 'Costruire il forno del quartiere',
    expected_result: 'Si cuoce il pane insieme ogni domenica',
    professionals: 'Un muratore, un fumista',
    suppliers: 'Fornace Rossi',
    published_at: '2026-08-01T09:00:00.000Z',
  };
  const PHASES = [
    {
      id: 'ph1',
      plan_id: 'rp1',
      sort: 1,
      title: 'Fondazione',
      scheduled_for: '2026-09-01',
      amount_cents: 120000,
      verification_criteria: 'Foto della platea gettata',
    },
    {
      id: 'ph2',
      plan_id: 'rp1',
      sort: 2,
      title: 'Cupola',
      scheduled_for: '2026-10-15',
      amount_cents: 340000,
      verification_criteria: 'Collaudo del fumista',
    },
  ];
  const c = ctx({
    'dream_candidacies.select': [{ data: [{ id: 'c1', profile_id: REQUESTER }] }],
    'realization_plans.select': [{ data: [PLAN] }],
    'realization_plan_phases.select': [{ data: PHASES }],
  });
  await processExportJobs(c);

  // the archive itself, not EXPORT_SPEC's membership: the authored prose is in the file
  const archived = JSON.parse(c.uploads[0].body);
  assertEquals(archived.realization_plans, [PLAN], 'the plan reaches the archive whole');
  assertEquals(archived.realization_plan_phases, PHASES, 'every phase reaches it whole');
  assertEquals(archived.realization_plans[0].objective, PLAN.objective);
  assertEquals(archived.realization_plan_phases[1].verification_criteria, 'Collaudo del fumista');

  // joined by the candidacy's then the plan's ids, and narrowed by nothing else — a draft
  // (published_at null) is the author's prose too, so the archive must not filter on it
  const planCall = c.db.calls.find((k) => k.table === 'realization_plans');
  assert(planCall, 'the plan is queried through its candidacy');
  assertEquals(planCall.filters, [['in', 'candidacy_id', ['c1']]]);
  const phaseCall = c.db.calls.find((k) => k.table === 'realization_plan_phases');
  assert(phaseCall, 'the phases are queried through their plan');
  assertEquals(phaseCall.filters, [['in', 'plan_id', ['rp1']]]);
});

// ── upload failure → requeue ─────────────────────────────────────────────────

Deno.test("upload failure → job requeued (status back to 'requested'), never 'ready'", async () => {
  const c = ctx({}, { upload: () => Promise.resolve({ error: { message: 'bucket down' } }) });
  const res = await processExportJobs(c);

  const updates = statusUpdates(c.db);
  // One write, not two: the claim already flipped the row to 'processing' in the database (#721).
  assertEquals(
    updates.map((u) => u.values.status),
    ['requested'],
  );
  assertFenced(c.db);
  assertEquals(c.signs.length, 0); // never signs a URL for a failed upload

  // the run itself still reports the batch it saw (retry happens next cron run)
  await assertCounts(res, 1, 0);
});

// ── #721: the failure statuses, and the shapes that used to strand a member ──

Deno.test("signing returns no url → requeued, never 'ready' with a null download_url", async () => {
  const c = ctx({}, { createSignedUrl: () => Promise.resolve({ data: null }) });
  const res = await processExportJobs(c);

  const updates = statusUpdates(c.db);
  assertEquals(
    updates.map((u) => u.values.status),
    ['requested'],
    "a 'ready' row with no url notifies the member that their archive is ready (#129 guards on " +
      'the status alone) and then shows them no link, on a terminal row',
  );
  assertEquals(updates[0].values.download_url, undefined);
  assertFenced(c.db);
  await assertCounts(res, 1, 0);
});

Deno.test(
  "past the servable window → 'failed' before any work, because the 30-day cap would reject 'ready'",
  async () => {
    // One millisecond past 30 days − SIGNED_TTL: the expiry this job would write can no longer
    // satisfy `expires_at <= created_at + interval '30 days'`, so the terminal write would raise
    // 23514 and — before #721 — be discarded, leaving the row to be re-claimed every night.
    const c = ctx({ 'rpc.claim_export_jobs': [{ data: [claimRow(SERVABLE_WINDOW_MS + 1)] }] });
    const res = await processExportJobs(c);

    assertEquals(c.uploads.length, 0, 'no archive is built for a job that cannot be handed over');
    assertEquals(c.signs.length, 0);
    const updates = statusUpdates(c.db);
    assertEquals(
      updates.map((u) => u.values.status),
      ['failed'],
    );
    assertEquals(updates[0].values.download_url, undefined);
    assertFenced(c.db);
    await assertCounts(res, 1, 1);
  },
);

Deno.test('just inside the servable window → still served', async () => {
  const c = ctx({ 'rpc.claim_export_jobs': [{ data: [claimRow(SERVABLE_WINDOW_MS - 60_000)] }] });
  const res = await processExportJobs(c);

  assertEquals(c.uploads.length, 1);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['ready'],
  );
  await assertCounts(res, 1, 0);
});

Deno.test(
  'a section read error → requeued, archive withheld: a short archive must not read as «you have none»',
  async () => {
    const c = ctx({ 'notifications.select': [{ error: { message: 'statement timeout' } }] });
    const res = await processExportJobs(c);

    assertEquals(c.uploads.length, 0, 'nothing is uploaded, so no partial archive can be signed');
    assertEquals(c.signs.length, 0);
    assertEquals(
      statusUpdates(c.db).map((u) => u.values.status),
      ['requested'],
      'a statement timeout on one section is as transient as a failed upload — failing the job ' +
        'here would burn the Art. 15 request the member is waiting on',
    );
    assertFenced(c.db);
    await assertCounts(res, 1, 0);
  },
);

Deno.test('an unparseable created_at fails CLOSED, not open', async () => {
  // `NaN > SERVABLE_WINDOW_MS` is false, so an unguarded comparison waves the job THROUGH the one
  // fence that stops it being rebuilt and rejected every night.
  const c = ctx({
    'rpc.claim_export_jobs': [
      { data: [{ id: JOB, profile_id: REQUESTER, created_at: 'not a date', claimed_at: CLAIMED }] },
    ],
  });
  const res = await processExportJobs(c);

  assertEquals(c.uploads.length, 0);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['failed'],
  );
  await assertCounts(res, 1, 1);
});

Deno.test('the lease lost before the terminal write is survivable, not fatal', async () => {
  // PostgREST answers a no-op update with success and an EMPTY row array — the fence rejected the
  // write because a later pass re-claimed the row. The pass must finish its batch anyway.
  const c = ctx({ 'gdpr_export_jobs.update': [{ data: [] }] });
  const res = await processExportJobs(c);

  assertEquals(c.uploads.length, 1, 'the work still happened; only the write was rejected');
  assertEquals(res.status, 200);
  await assertCounts(res, 1, 0);
});

// ── happy path ───────────────────────────────────────────────────────────────

Deno.test(
  "happy path → upload to <profile>/<job>/archive.json, then 'ready' + signed url + expiry",
  async () => {
    const c = ctx();
    const res = await processExportJobs(c);
    assertEquals(res.status, 200);
    await assertCounts(res, 1, 0);

    assertEquals(c.uploads.length, 1);
    assertEquals(c.uploads[0].path, `${REQUESTER}/${JOB}/archive.json`);
    assertEquals(c.uploads[0].opts, { contentType: 'application/json', upsert: true });
    const archived = JSON.parse(c.uploads[0].body);
    assertEquals(archived.profile, null); // unscripted queries → the empty archive shape
    assertEquals(archived.dreams, []);

    assertEquals(c.signs, [{ path: `${REQUESTER}/${JOB}/archive.json`, ttl: SIGNED_TTL_SECONDS }]);
    assertEquals(archived.account, { email: 'luna@example.test' });
    assertEquals(archived.media, { complete: true, files: [], not_included: [] });

    const updates = statusUpdates(c.db);
    assertEquals(
      updates.map((u) => u.values.status),
      ['ready'],
    );
    const ready = updates[0].values;
    assertEquals(ready.download_url, 'https://signed.example/x');
    assert(typeof ready.expires_at === 'string' && !Number.isNaN(Date.parse(ready.expires_at)));
    assertFenced(c.db);
  },
);

Deno.test('claim error → 500 with the pg message; no job touched', async () => {
  const c = ctx({ 'rpc.claim_export_jobs': [{ error: { message: 'boom' } }] });
  const res = await processExportJobs(c);
  assertEquals(res.status, 500);
  assertEquals(await res.text(), 'boom');
  assertEquals(c.uploads.length, 0);
  assertEquals(statusUpdates(c.db).length, 0);
});

Deno.test('empty batch → processed 0', async () => {
  const c = ctx({ 'rpc.claim_export_jobs': [{ data: [] }] });
  const res = await processExportJobs(c);
  assertEquals(await res.json(), {
    processed: 0,
    failed: 0,
    deferred: 0,
    reap: { objects: { reaped: 0, unremoved: 0, rounds: 1, exhausted: true }, jobs: { reaped: 0 } },
  });
});

// ── #784: the archive is complete — email, own media as files, whole conversations ──

const OTHER = 'user-2';
const CONVO = 'cv-1';
const PHOTO = `${REQUESTER}/p1/0.jpg`;
const MY_CHAT_IMAGE = `${REQUESTER}/${CONVO}/m2.jpg`;
const THEIR_CHAT_IMAGE = `${OTHER}/${CONVO}/m3.jpg`;

const mediaRow = (bucket_id: string, name: string, size: number | null = 1234): MediaObject => ({
  bucket_id,
  name,
  created_at: '2026-09-20T10:00:00.000Z',
  size,
  mimetype: 'image/jpeg',
});

/** A member with one photo post and one conversation: sent, received, and a withdrawn reply. */
const memberWithMediaAndConversation = (): Record<string, FakeResult[]> => ({
  'posts.select': [{ data: [{ id: 'p1', author_id: REQUESTER }] }],
  'post_media.select': [
    {
      data: [{ id: 'pm1', post_id: 'p1', storage_path: PHOTO, thumb_path: null }],
    },
  ],
  'conversations.select': [
    {
      data: [
        {
          id: CONVO,
          participant_a: OTHER,
          participant_b: REQUESTER,
          created_from: 'momento',
          created_at: '2026-09-19T08:00:00.000Z',
          last_message_at: '2026-09-20T10:05:00.000Z',
          last_message_preview: 'ci vediamo?',
          last_message_sender_id: OTHER,
        },
      ],
    },
  ],
  'messages.select': [
    {
      data: [
        {
          id: 'm3',
          conversation_id: CONVO,
          sender_id: OTHER,
          kind: 'user',
          body: 'ecco la foto',
          media_url: THEIR_CHAT_IMAGE,
          prompt_key: null,
          deleted_at: null,
          created_at: '2026-09-20T10:03:00.000Z',
        },
        {
          id: 'm1',
          conversation_id: CONVO,
          sender_id: REQUESTER,
          kind: 'user',
          body: 'ciao!',
          media_url: null,
          prompt_key: null,
          deleted_at: null,
          created_at: '2026-09-20T10:00:00.000Z',
        },
        {
          id: 'm2',
          conversation_id: CONVO,
          sender_id: REQUESTER,
          kind: 'user',
          body: null,
          media_url: MY_CHAT_IMAGE,
          prompt_key: null,
          deleted_at: null,
          created_at: '2026-09-20T10:01:00.000Z',
        },
        {
          id: 'm4',
          conversation_id: CONVO,
          sender_id: OTHER,
          kind: 'user',
          body: 'scusa, sbagliato',
          media_url: null,
          prompt_key: null,
          deleted_at: '2026-09-20T10:06:00.000Z',
          created_at: '2026-09-20T10:05:00.000Z',
        },
        {
          id: 'm0',
          conversation_id: CONVO,
          sender_id: null,
          kind: 'system',
          body: null,
          media_url: null,
          prompt_key: 'chat.opened',
          deleted_at: null,
          created_at: '2026-09-19T08:00:00.000Z',
        },
      ],
    },
  ],
  'profiles.select': [
    { data: { id: REQUESTER, handle: 'luna' } },
    {
      data: [{ id: OTHER, handle: 'sole' }],
    },
  ],
  'rpc.gdpr_export_media': [
    {
      data: [mediaRow('chat-media', MY_CHAT_IMAGE), mediaRow('post-media', PHOTO)],
    },
  ],
});

Deno.test('a member with media and a conversation: every ruling lands in the archive', async () => {
  const c = ctx(memberWithMediaAndConversation());
  const res = await processExportJobs(c);
  await assertCounts(res, 1, 0);
  const archived = JSON.parse(c.uploads[0].body);

  // (1a) the account email, from Auth
  assertEquals(archived.account, { email: 'luna@example.test' });

  // (1b) own media as FILES: copied server-side into the job's folder, one per object
  assertEquals(c.copies.map((k) => k.to).sort(), [
    `${REQUESTER}/${JOB}/media/chat-media/${CONVO}/m2.jpg`,
    `${REQUESTER}/${JOB}/media/post-media/p1/0.jpg`,
  ]);
  assertEquals(c.copies.find((k) => k.from === PHOTO)?.bucket, 'post-media');
  assertEquals(archived.media.complete, true);
  assertEquals(archived.media.not_included, []);
  const photo = archived.media.files.find((f: { path: string }) => f.path === PHOTO);
  assertEquals(photo, {
    file: 'media/post-media/p1/0.jpg',
    bucket: 'post-media',
    path: PHOTO,
    created_at: '2026-09-20T10:00:00.000Z',
    size: 1234,
    content_type: 'image/jpeg',
    belongs_to: { section: 'posts', id: 'p1' },
    url: `https://signed.example/${REQUESTER}/${JOB}/media/post-media/p1/0.jpg`,
  });
  const chatImage = archived.media.files.find((f: { path: string }) => f.path === MY_CHAT_IMAGE);
  assertEquals(chatImage.belongs_to, { section: 'messages', id: 'm2' });
  // every file is signed for the same window as the archive link
  assertEquals(
    c.mediaSigns.map((m) => m.ttl),
    [SIGNED_TTL_SECONDS],
  );
  assert(
    !c.copies.some((k) => k.from === THEIR_CHAT_IMAGE),
    "the other party's bytes are not copied",
  );

  // (1c) the conversation in full, the other party by handle only
  assertEquals(archived.conversations, [
    {
      id: CONVO,
      created_at: '2026-09-19T08:00:00.000Z',
      created_from: 'momento',
      last_message_at: '2026-09-20T10:05:00.000Z',
      with_handle: 'sole',
    },
  ]);
  assertEquals(
    archived.messages.map((m: { id: string }) => m.id),
    ['m0', 'm1', 'm2', 'm3', 'm4'],
    'received messages are in, in conversation order',
  );
  const byId = Object.fromEntries(
    archived.messages.map((m: { id: string }) => [m.id, m]),
  ) as Record<string, Record<string, unknown>>;
  assertEquals(byId.m1.from_me, true);
  assertEquals(byId.m1.body, 'ciao!');
  assertEquals(byId.m3.from_me, false);
  assertEquals(byId.m3.from_handle, 'sole');
  assertEquals(byId.m3.body, 'ecco la foto');
  assertEquals(byId.m3.attachment, { filename: 'm3.jpg' }, 'a received attachment is a filename');
  assertEquals(
    byId.m2.attachment,
    { path: MY_CHAT_IMAGE, file: `media/chat-media/${CONVO}/m2.jpg` },
    "the member's own attachment points at its file in the archive",
  );
  assertEquals(byId.m4.body, null, 'a message the sender withdrew keeps no body');
  assertEquals(byId.m4.deleted_at, '2026-09-20T10:06:00.000Z');
  assertEquals(byId.m0.from_handle, null);
  assertEquals(byId.m0.prompt_key, 'chat.opened');

  // the counterpart's profile id appears NOWHERE in either section — not as a participant, not
  // as last_message_sender_id, not as sender_id, not inside a received attachment's key
  const leaked = JSON.stringify({
    c: archived.conversations,
    m: archived.messages,
  });
  assert(!leaked.includes(OTHER), `counterpart id leaked: ${leaked}`);
  assert(!leaked.includes('ci vediamo?'), 'the preview column is dropped');

  // the handle read asks for id + handle of the counterpart only
  const handleRead = c.db.calls.find((k) => k.table === 'profiles' && k.columns === 'id, handle');
  assert(handleRead);
  assertEquals(handleRead.filters, [['in', 'id', [OTHER]]]);

  // (2) the link lives the whole 7 days, and the archive says until when
  const ready = statusUpdates(c.db)[0].values;
  const ttlMs = Date.parse(ready.expires_at as string) - Date.now();
  assert(Math.abs(ttlMs - 7 * 24 * 3600 * 1000) < 60_000, `expires in ~7 days, got ${ttlMs}ms`);
  assertEquals(archived.link_expires_at, ready.expires_at);
});

Deno.test('a copy that fails is NAMED, and the manifest says the archive is partial', async () => {
  const c = ctx(memberWithMediaAndConversation(), {
    copyIn: (bucket) =>
      Promise.resolve({
        error: bucket === 'post-media' ? { message: 'Object not found', statusCode: '404' } : null,
      }),
  });
  const res = await processExportJobs(c);
  await assertCounts(res, 1, 0);
  const archived = JSON.parse(c.uploads[0].body);
  assertEquals(archived.media.complete, false);
  assertEquals(archived.media.not_included, [
    { bucket: 'post-media', path: PHOTO, reason: 'Object not found' },
  ]);
  assertEquals(
    archived.media.files.map((f: { path: string }) => f.path),
    [MY_CHAT_IMAGE],
  );
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['ready'],
  );
});

Deno.test('a copy onto a key a previous pass filled counts as copied (resume)', async () => {
  const c = ctx(memberWithMediaAndConversation(), {
    copyIn: () =>
      Promise.resolve({
        error: {
          message: 'The resource already exists',
          statusCode: '409',
          code: 'ResourceAlreadyExists',
        },
      }),
  });
  await processExportJobs(c);
  const archived = JSON.parse(c.uploads[0].body);
  assertEquals(archived.media.complete, true);
  assertEquals(archived.media.files.length, 2);
});

Deno.test('an object over the exports ceiling is named, never attempted', async () => {
  const big = `${REQUESTER}/cand/video.mp4`;
  const c = ctx({
    'rpc.gdpr_export_media': [
      {
        data: [mediaRow('candidacy-videos', big, EXPORTS_OBJECT_LIMIT + 1)],
      },
    ],
  });
  await processExportJobs(c);
  assertEquals(c.copies.length, 0);
  const archived = JSON.parse(c.uploads[0].body);
  assertEquals(archived.media.complete, false);
  assertEquals(archived.media.not_included, [
    { bucket: 'candidacy-videos', path: big, reason: 'too_large' },
  ]);
});

Deno.test(
  'the media listing pages on (bucket_id, name) until a page comes back empty',
  async () => {
    const first = mediaRow('avatars', `${REQUESTER}/a.jpg`);
    const second = mediaRow('post-media', `${REQUESTER}/p/0.jpg`);
    const c = ctx({
      'rpc.gdpr_export_media': [
        { data: [first] },
        { data: [second] },
        {
          data: [],
        },
      ],
    });
    await processExportJobs(c);
    const pages = c.db.calls.filter((k) => k.columns === 'gdpr_export_media').map((k) => k.values);
    assertEquals(pages, [
      {
        p_profile_id: REQUESTER,
        p_after_bucket: null,
        p_after_name: null,
        p_limit: 1000,
      },
      {
        p_profile_id: REQUESTER,
        p_after_bucket: 'avatars',
        p_after_name: first.name,
        p_limit: 1000,
      },
      {
        p_profile_id: REQUESTER,
        p_after_bucket: 'post-media',
        p_after_name: second.name,
        p_limit: 1000,
      },
    ]);
    assertEquals(c.copies.length, 2);
  },
);

Deno.test('a section is read to the end — keyset on id, stopping on an EMPTY page', async () => {
  // Two full pages, then empty. Before #784 this was one select('*'), which PostgREST's
  // max_rows cut at 1000 without a word.
  const page = (from: number) =>
    Array.from({ length: SECTION_PAGE }, (_, i) => ({
      id: `n${String(from + i).padStart(5, '0')}`,
    }));
  const c = ctx({
    'notifications.select': [
      { data: page(0) },
      { data: page(SECTION_PAGE) },
      {
        data: [],
      },
    ],
  });
  await processExportJobs(c);
  const reads = c.db.calls.filter((k) => k.table === 'notifications');
  assertEquals(reads.length, 3);
  assertEquals(reads[0].filters, [['eq', 'recipient_id', REQUESTER]]);
  assertEquals(reads[1].filters, [
    ['eq', 'recipient_id', REQUESTER],
    ['gt', 'id', `n${String(SECTION_PAGE - 1).padStart(5, '0')}`],
  ]);
  assertEquals(reads[0].modifiers, [
    ['order', 'id', undefined],
    ['limit', SECTION_PAGE],
  ]);
  const archived = JSON.parse(c.uploads[0].body);
  assertEquals(archived.notifications.length, 2 * SECTION_PAGE);
});

Deno.test('the email read failing withholds the archive and requeues', async () => {
  const c = ctx(
    {},
    {},
    {
      getEmail: () => Promise.resolve({ email: null, error: { message: 'auth down' } }),
    },
  );
  await processExportJobs(c);
  assertEquals(c.uploads.length, 0);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['requested'],
  );
  assertFenced(c.db);
});

Deno.test('the media listing failing withholds the archive and requeues', async () => {
  const c = ctx({ 'rpc.gdpr_export_media': [{ error: { message: 'boom' } }] });
  await processExportJobs(c);
  assertEquals(c.uploads.length, 0);
  assertEquals(c.copies.length, 0);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['requested'],
  );
});

Deno.test('media signing failing requeues rather than shipping a file without a link', async () => {
  const c = ctx(memberWithMediaAndConversation(), {
    createSignedUrls: () => Promise.resolve({ data: null, error: { message: 'sign down' } }),
  });
  await processExportJobs(c);
  assertEquals(c.uploads.length, 0);
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['requested'],
  );
});

Deno.test(
  'out of time mid-copy: the job and every claim behind it go back to the queue',
  async () => {
    const second = { ...claimRow(), id: 'job-2' };
    let t = 0;
    const c = ctx(
      {
        'rpc.claim_export_jobs': [{ data: [claimRow(), second] }],
        'rpc.gdpr_export_media': [
          {
            data: [mediaRow('avatars', `${REQUESTER}/a.jpg`)],
          },
        ],
      },
      {},
      // the clock jumps past the budget as soon as the pass starts copying
      { now: () => (t++ < 2 ? 0 : PASS_BUDGET_MS + 1) },
    );
    const res = await processExportJobs(c);
    await assertCounts(res, 2, 0, 2);
    assertEquals(c.uploads.length, 0, 'nothing is shipped short');
    const updates = c.db.calls.filter((k) => k.table === 'gdpr_export_jobs' && k.op === 'update');
    assertEquals(
      updates.map((u) => [u.filters[0][2], (u.values as { status: string }).status]),
      [
        [JOB, 'requested'],
        ['job-2', 'requested'],
      ],
    );
  },
);

// ── #784 ruling 2: the nightly reap ─────────────────────────────────────────

Deno.test(
  'each pass reaps expired exports objects, then expired rows, before claiming',
  async () => {
    const c = ctx({
      'rpc.gdpr_export_reap_candidates': [
        {
          data: [
            { name: `${REQUESTER}/old-job.json` },
            {
              name: `${REQUESTER}/j2/archive.json`,
            },
          ],
        },
        { data: [] },
      ],
      'rpc.gdpr_export_reap_jobs': [{ data: 2 }],
      'rpc.claim_export_jobs': [{ data: [] }],
    });
    const res = await processExportJobs(c);
    const body = await res.json();
    assertEquals(c.removed, [[`${REQUESTER}/old-job.json`, `${REQUESTER}/j2/archive.json`]]);
    assertEquals(body.reap, {
      objects: { reaped: 2, unremoved: 0, rounds: 2, exhausted: true },
      jobs: { reaped: 2 },
    });
    const rpcOrder = c.db.calls.filter((k) => k.op === 'rpc').map((k) => k.columns);
    assertEquals(rpcOrder, [
      'gdpr_export_reap_candidates',
      'gdpr_export_reap_candidates',
      'gdpr_export_reap_jobs',
      'claim_export_jobs',
    ]);
  },
);

Deno.test('a failing reap is reported and never blocks tonight’s exports', async () => {
  const c = ctx({
    'rpc.gdpr_export_reap_candidates': [{ error: { message: 'list down' } }],
    'rpc.gdpr_export_reap_jobs': [{ error: { message: 'delete down' } }],
  });
  const res = await processExportJobs(c);
  const body = await res.json();
  assertEquals(body.reap.objects.error, 'list: list down');
  assertEquals(body.reap.jobs, { error: 'delete down' });
  assertEquals(c.uploads.length, 1, 'the claimed job was still built');
  assertEquals(
    statusUpdates(c.db).map((u) => u.values.status),
    ['ready'],
  );
});
