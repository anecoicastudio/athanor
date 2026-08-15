// deno test supabase/functions/gdpr-export-job/ — runs in CI (edge job) and locally.
// Characterization tests for the export loop. THE critical invariant (10 §5.3): every
// archive query filters by the requester's own id, with the per-table owner column.
// All db I/O through injected fakes; storage is a recorded capability port (no .storage
// on the fake db — DI over mocks).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb, type FakeDb, type FakeResult } from '../_shared/fake-db.ts';
import {
  assembleArchive,
  EXPORT_SPEC,
  type ExportJobCtx,
  type ExportStorage,
  processExportJobs,
  SIGNED_TTL_SECONDS,
} from './logic.ts';

const JOB = 'job-1';
const REQUESTER = 'user-1';

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
  messages: { table: 'messages', filter: { kind: 'eq', column: 'sender_id' } },
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
  candidacy_votes: { table: 'candidacy_votes', filter: { kind: 'eq', column: 'voter_id' } },
  fund_contributions: { table: 'fund_contributions', filter: { kind: 'eq', column: 'profile_id' } },
  circle_memberships: { table: 'circle_memberships', filter: { kind: 'eq', column: 'profile_id' } },
  payout_accounts: {
    table: 'payout_accounts',
    filter: { kind: 'eq', column: 'profile_id' },
    one: true,
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
};

const ctx = (
  script: Record<string, FakeResult[]> = {},
  storage: Partial<ExportStorage> = {},
): Ctx => {
  const db = makeFakeDb({
    'gdpr_export_jobs.select': [{ data: [{ id: JOB, profile_id: REQUESTER }] }],
    ...script,
  });
  const uploads: Ctx['uploads'] = [];
  const signs: Ctx['signs'] = [];
  return {
    db,
    storage: {
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
  } as unknown as Ctx;
};

const statusUpdates = (db: FakeDb) =>
  db.calls
    .filter((c) => c.table === 'gdpr_export_jobs' && c.op === 'update')
    .map((c) => ({ values: c.values as Record<string, unknown>, filters: c.filters }));

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
    ['exported_at', ...EXPORT_SPEC.map((s) => s.key)].sort(),
    'archive keys = exported_at + every EXPORT_SPEC key',
  );
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
    // script the three via parents with rows so the join queries actually run
    const c = ctx({
      'dreams.select': [{ data: [{ id: 'd1' }, { id: 'd2' }] }],
      'posts.select': [{ data: [{ id: 'p1' }] }],
      'event_tickets.select': [{ data: [{ id: 't1' }, { id: 't2' }] }],
    });
    await processExportJobs(c);

    // claim: status='requested', batched
    const claim = c.db.calls.find(
      (call) => call.table === 'gdpr_export_jobs' && call.op === 'select' && call.columns !== '*',
    );
    assert(claim);
    assertEquals(claim.filters, [['eq', 'status', 'requested']]);
    assertEquals(claim.modifiers, [['limit', 50]]);

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
        const parentIds = { dreams: ['d1', 'd2'], posts: ['p1'], event_tickets: ['t1', 't2'] }[
          expected.filter.parentKey
        ];
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
  for (const table of ['dream_milestones', 'post_media', 'event_attendance']) {
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
});

// ── upload failure → requeue ─────────────────────────────────────────────────

Deno.test("upload failure → job requeued (status back to 'requested'), never 'ready'", async () => {
  const c = ctx({}, { upload: () => Promise.resolve({ error: { message: 'bucket down' } }) });
  const res = await processExportJobs(c);

  const updates = statusUpdates(c.db);
  assertEquals(
    updates.map((u) => u.values.status),
    ['processing', 'requested'],
  );
  assert(
    updates.every((u) => u.filters.some(([f, col, v]) => f === 'eq' && col === 'id' && v === JOB)),
  );
  assertEquals(c.signs.length, 0); // never signs a URL for a failed upload

  // the run itself still reports the batch it saw (retry happens next cron run)
  assertEquals(await res.json(), { processed: 1 });
});

// ── happy path ───────────────────────────────────────────────────────────────

Deno.test(
  "happy path → upload to <profile>/<job>.json, then 'ready' + signed url + expiry",
  async () => {
    const c = ctx();
    const res = await processExportJobs(c);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { processed: 1 });

    assertEquals(c.uploads.length, 1);
    assertEquals(c.uploads[0].path, `${REQUESTER}/${JOB}.json`);
    assertEquals(c.uploads[0].opts, { contentType: 'application/json', upsert: true });
    const archived = JSON.parse(c.uploads[0].body);
    assertEquals(archived.profile, null); // unscripted queries → the empty archive shape
    assertEquals(archived.dreams, []);

    assertEquals(c.signs, [{ path: `${REQUESTER}/${JOB}.json`, ttl: SIGNED_TTL_SECONDS }]);

    const updates = statusUpdates(c.db);
    assertEquals(
      updates.map((u) => u.values.status),
      ['processing', 'ready'],
    );
    const ready = updates[1].values;
    assertEquals(ready.download_url, 'https://signed.example/x');
    assert(typeof ready.expires_at === 'string' && !Number.isNaN(Date.parse(ready.expires_at)));
  },
);

Deno.test('claim error → 500 with the pg message; no job touched', async () => {
  const c = ctx({ 'gdpr_export_jobs.select': [{ error: { message: 'boom' } }] });
  const res = await processExportJobs(c);
  assertEquals(res.status, 500);
  assertEquals(await res.text(), 'boom');
  assertEquals(c.uploads.length, 0);
  assertEquals(statusUpdates(c.db).length, 0);
});

Deno.test('empty batch → processed 0', async () => {
  const c = ctx({ 'gdpr_export_jobs.select': [{ data: [] }] });
  const res = await processExportJobs(c);
  assertEquals(await res.json(), { processed: 0 });
});
