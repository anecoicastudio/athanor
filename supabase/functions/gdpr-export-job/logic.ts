import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { reapBucket, type RemoveResult } from '../_shared/reap.ts';

// Export job extracted from index.ts so the own-data invariant is unit-testable (deno test):
// index.ts keeps the transport shell (requireServiceRole, client + storage port wiring) and
// injects everything here (repo convention: DI over mocks). Storage arrives as a capability
// port because the fake db has no .storage namespace.

/**
 * How long an archive lives (#784 ruling 2): seven days, then the nightly pass deletes the object
 * and the row, and the member re-requests whenever they like.
 *
 * The link is signed for the WHOLE window, not a shorter slice of it. A link that died on day 3
 * while the archive sat until day 7 is the shape #784 found on the screen: a Download button on
 * a dead link, and no request button, because the row still read 'ready'. Signing for the window
 * makes `expires_at` the one clock — the link, the row reap (`gdpr_export_reap_jobs`) and the
 * object reap (`gdpr_export_reap_candidates`) all end on it.
 */
export const RETENTION_DAYS = 7;
export const SIGNED_TTL_SECONDS = RETENTION_DAYS * 24 * 60 * 60; // ≤ the 30-day expiry cap

/**
 * How long after it was requested a job can still be SERVED.
 *
 * `gdpr_export_jobs` carries `check (expires_at <= created_at + interval '30 days')`
 * (20260620140149:16) and every 'ready' write signs its link for SIGNED_TTL_SECONDS. So once a job
 * is older than 30 days minus that TTL, the terminal write cannot satisfy the constraint and
 * raises 23514 — and that is precisely the population the #721 stale-claim re-drive reaches. Left
 * unfenced, the lease would convert a job stuck on 'processing' into one re-claimed, rebuilt,
 * re-uploaded and rejected every night for ever, with nothing in the logs. Such a job is filed
 * 'failed' instead, before any work is done, and the member re-requests.
 */
export const SERVABLE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 - SIGNED_TTL_SECONDS * 1000;

/**
 * How many jobs one pass CLAIMS.
 *
 * Sized to what a pass can finish rather than to the queue: each job runs the whole EXPORT_SPEC
 * (~45 sections, the `via` ones serially after the batch), an upload and a signing round trip,
 * against a 400 s wall clock (150 s free — https://supabase.com/docs/guides/functions/limits).
 * The old bound of 50 was a candidate count, not a capacity, and now that the claim STAMPS every
 * row it takes, over-claiming is worse than it was: a row claimed and never reached is held by
 * its own lease for 15 minutes and then waits for the next nightly pass, so a batch the isolate
 * cannot finish delays exactly the jobs it pretended to take. Passed rather than left to the
 * function's default because the batch size is this loop's business; the LEASE is the table's and
 * is deliberately NOT passed, so the number an operator reads in the migration is the one running.
 */
export const CLAIM_BATCH = 10;

/**
 * Rows per section page. Every section is read to the end, a page at a time, keyed on `id`
 * (rule 9 — never an offset). Before #784 each section was ONE `select('*')`, which PostgREST's
 * `max_rows = 1000` truncates without saying so: a member with 1001 notifications got 1000 and an
 * archive that read as complete. Received messages make that ceiling reachable in weeks, so the
 * archive now pages until a page comes back EMPTY — never until one comes back short, because a
 * hosted max_rows below this number would make every page short.
 */
export const SECTION_PAGE = 1000;

/** Parent ids per `via` query — an `in (…)` of thousands of uuids outgrows a request URL. */
export const ID_CHUNK = 100;

/** Concurrent media copies. Each is one Storage API round trip; the bytes move server-side. */
export const COPY_CONCURRENCY = 6;

/**
 * Wall-clock the pass allows itself before it stops starting work, of the 400 s the platform
 * gives it (https://supabase.com/docs/guides/functions/limits). Copying media is the first part
 * of the job whose cost scales with the member's library rather than their row count, so a pass
 * can now run out of time. When it does, the job in hand and every claimed job not yet reached
 * are requeued rather than shipped short: the copies already made stay in the bucket, a copy onto
 * an existing key is treated as done, and the next pass resumes where this one stopped.
 */
export const PASS_BUDGET_MS = 300_000;

/**
 * The `exports` bucket's per-object ceiling (20260925154710 §1 — the largest member upload,
 * candidacy-videos' 200 MiB). An object reported larger is named in the manifest as not included
 * rather than attempted: the Storage API would refuse it, after moving the bytes.
 */
export const EXPORTS_OBJECT_LIMIT = 209_715_200;

/** The media buckets gdpr_export_media lists from (20260925154710 §2); media-buckets.test.ts pins them. */
export const EXPORT_MEDIA_BUCKETS = [
  'post-media',
  'moments',
  'story-segments',
  'candidacy-videos',
  'avatars',
  'chat-media',
] as const;

/** The `exports` bucket surface the job needs — index wires db.storage.from('exports'). */
export type ExportStorage = {
  upload: (
    path: string,
    body: string,
    opts: { contentType: string; upsert: boolean },
  ) => Promise<{ error: unknown }>;
  // `error` rides along so a signing failure can say WHY in the logs. The loop branches on the
  // url being absent, not on the error, because the Storage client can answer with neither.
  createSignedUrl: (
    path: string,
    ttlSeconds: number,
  ) => Promise<{ data: { signedUrl: string } | null; error?: unknown }>;
  /** one signing round trip for the media files; a per-path miss arrives as a null signedUrl */
  createSignedUrls: (
    paths: string[],
    ttlSeconds: number,
  ) => Promise<{
    data: { path: string | null; signedUrl: string | null; error?: string | null }[] | null;
    error?: unknown;
  }>;
  /** server-side copy of one of the member's objects from a media bucket INTO `exports` */
  copyIn: (bucket: string, from: string, to: string) => Promise<{ error: unknown }>;
  /** `exports` remove — the retention reap (_shared/reap.ts) */
  remove: (paths: string[]) => PromiseLike<RemoveResult>;
};

export type ExportJobCtx = {
  /** service role — reads across the requester's rows + owns the job status column */
  db: SupabaseClient;
  storage: ExportStorage;
  /**
   * The member's account email, from auth.users (#784 ruling 1). `profiles` has no email column,
   * so it is the Auth admin API or nothing; a port because the fake db has no `.auth`.
   */
  getEmail: (profileId: string) => Promise<{ email: string | null; error?: unknown }>;
  /** injectable clock for the pass budget; Date.now in production */
  now?: () => number;
};

// `error` is read, not decoration: a section whose query fails resolves `data: null`, which
// assembleArchive defaults to null/[] — indistinguishable from «this member has none». An archive
// that silently omits a member's messages is a worse answer to an Art. 15 request than no archive
// at all, so the loop withholds it and requeues the job (#721).
type QueryResult = { data: unknown; error?: unknown };

/**
 * One archive section per table carrying the requester's personal data (Art. 15/20; 10 §5.3).
 *
 * - 'one'    — at most one row, filtered by `column` (maybeSingle).
 * - 'many'   — rows filtered by `column`.
 * - 'either' — rows where either column is the requester (or-filter): tables where the
 *              member can sit on both sides of the relation.
 * - 'via'    — rows owned through a parent section (`column` ∈ parent row ids): tables with
 *              no owner column of their own (event_attendance) or owned via their parent
 *              content row (dream_milestones, post_media). The parent MUST appear earlier
 *              in this list — it may itself be 'via', which is how realization_plan_phases
 *              reaches its author three hops out (profiles → candidacy → plan → phase).
 *
 * COMPLETENESS CONTRACT: this list is pinned twice —
 * - logic.test.ts holds an independent literal mirror of (table, filter) pairs, so a
 *   silently dropped or re-columned entry fails `deno test`;
 * - supabase/tests/0096_gdpr_export_completeness.test.sql sweeps every FK-to-profiles
 *   table in the live schema and fails when one is neither exported here nor explicitly
 *   excluded there with a reason. A NEW personal-data table therefore cannot land without
 *   deciding its export fate.
 */
export type OwnDataSpec =
  | { key: string; table: string; mode: 'one'; column: string }
  | { key: string; table: string; mode: 'many'; column: string }
  | { key: string; table: string; mode: 'either'; columns: readonly [string, string] }
  | { key: string; table: string; mode: 'via'; parentKey: string; column: string };

export const EXPORT_SPEC: readonly OwnDataSpec[] = [
  { key: 'profile', table: 'profiles', mode: 'one', column: 'id' },
  { key: 'dreams', table: 'dreams', mode: 'many', column: 'profile_id' },
  {
    key: 'dream_milestones',
    table: 'dream_milestones',
    mode: 'via',
    parentKey: 'dreams',
    column: 'dream_id',
  },
  { key: 'milestone_helps', table: 'milestone_helps', mode: 'many', column: 'helper_id' },
  { key: 'posts', table: 'posts', mode: 'many', column: 'author_id' },
  { key: 'post_media', table: 'post_media', mode: 'via', parentKey: 'posts', column: 'post_id' },
  { key: 'post_reactions', table: 'post_reactions', mode: 'many', column: 'person_id' },
  { key: 'post_comments', table: 'post_comments', mode: 'many', column: 'author_id' },
  { key: 'moments', table: 'moments', mode: 'many', column: 'owner_id' },
  {
    key: 'momento_proposals',
    table: 'momento_proposals',
    mode: 'either',
    columns: ['user_id', 'candidate_id'],
  },
  { key: 'story_segments', table: 'story_segments', mode: 'many', column: 'author_id' },
  { key: 'story_reactions', table: 'story_reactions', mode: 'many', column: 'person_id' },
  { key: 'projects', table: 'projects', mode: 'many', column: 'author_id' },
  {
    key: 'favor_offers',
    table: 'favor_offers',
    mode: 'either',
    columns: ['actor_id', 'target_id'],
  },
  { key: 'events', table: 'events', mode: 'many', column: 'organizer_id' },
  { key: 'athanor_days_interest', table: 'athanor_days_interest', mode: 'many', column: 'user_id' },
  { key: 'rsvps', table: 'rsvps', mode: 'many', column: 'user_id' },
  { key: 'event_tickets', table: 'event_tickets', mode: 'many', column: 'user_id' },
  {
    key: 'event_attendance',
    table: 'event_attendance',
    mode: 'via',
    parentKey: 'event_tickets',
    column: 'ticket_id',
  },
  // #784: the member's conversations IN FULL — every thread they sit on either side of, and
  // every message in it, received as well as sent. Until #784 this was `messages` filtered on
  // `sender_id`, so the archive held one half of every conversation. Both sections are READ
  // raw here and REDACTED before assembly (`redactConversations`): the counterpart appears by
  // handle only, never by profile id or email (ruling 1), and `conversations` left 0096's
  // excluded list for its exported one on exactly that condition.
  {
    key: 'conversations',
    table: 'conversations',
    mode: 'either',
    columns: ['participant_a', 'participant_b'],
  },
  {
    key: 'messages',
    table: 'messages',
    mode: 'via',
    parentKey: 'conversations',
    column: 'conversation_id',
  },
  // #637: the member's own read cursors. Not authored content — a timestamp per thread —
  // but it is behavioural data ABOUT them (when they read what, and which threads they
  // never opened), which is squarely what access and portability cover.
  {
    key: 'conversation_reads',
    table: 'conversation_reads',
    mode: 'many',
    column: 'profile_id',
  },
  {
    key: 'connection_requests',
    table: 'connection_requests',
    mode: 'either',
    columns: ['requester_id', 'addressee_id'],
  },
  { key: 'connections', table: 'connections', mode: 'either', columns: ['profile_a', 'profile_b'] },
  { key: 'blocks', table: 'blocks', mode: 'many', column: 'blocker_id' },
  { key: 'reports', table: 'reports', mode: 'many', column: 'reporter_id' },
  { key: 'notifications', table: 'notifications', mode: 'many', column: 'recipient_id' },
  {
    key: 'notification_preferences',
    table: 'notification_preferences',
    mode: 'many',
    column: 'profile_id',
  },
  { key: 'push_tokens', table: 'push_tokens', mode: 'many', column: 'profile_id' },
  { key: 'aura_events', table: 'aura_events', mode: 'many', column: 'profile_id' },
  { key: 'aura_scores', table: 'aura_scores', mode: 'one', column: 'profile_id' },
  { key: 'stars', table: 'stars', mode: 'many', column: 'profile_id' },
  { key: 'dream_candidacies', table: 'dream_candidacies', mode: 'many', column: 'profile_id' },
  // #400: the winner's realization plan and its phases (#228/#229). Member-authored prose —
  // objective, expected_result, professionals, suppliers; per phase title, scheduled_for,
  // amount_cents, verification_criteria — reached through dream_candidacies, so 0096's
  // FK-to-profiles sweep never sees them and they are on its exported list by hand, the way
  // its header prescribes for tables below the first degree. Published is not the same as
  // impersonal: access and portability cover what the member wrote no matter who else may
  // read it, and erasure already takes both down with the candidacy. Phases follow plans
  // because the via loop reads `results` as it fills them.
  {
    key: 'realization_plans',
    table: 'realization_plans',
    mode: 'via',
    parentKey: 'dream_candidacies',
    column: 'candidacy_id',
  },
  {
    key: 'realization_plan_phases',
    table: 'realization_plan_phases',
    mode: 'via',
    parentKey: 'realization_plans',
    column: 'plan_id',
  },
  { key: 'candidacy_votes', table: 'candidacy_votes', mode: 'many', column: 'voter_id' },
  { key: 'fund_contributions', table: 'fund_contributions', mode: 'many', column: 'profile_id' },
  { key: 'circle_memberships', table: 'circle_memberships', mode: 'many', column: 'profile_id' },
  { key: 'payout_accounts', table: 'payout_accounts', mode: 'one', column: 'profile_id' },
  // #230: the winner's public progress notes. Member-authored prose with a direct FK to
  // profiles, so it is squarely personal data — and withdrawn notes come with it, because
  // `deleted_at` hides a row from the world, not from its author.
  {
    key: 'realization_updates',
    table: 'realization_updates',
    mode: 'many',
    column: 'profile_id',
  },
  { key: 'invites', table: 'invites', mode: 'either', columns: ['inviter_id', 'invitee_id'] },
  { key: 'consent', table: 'consent', mode: 'many', column: 'profile_id' },
  { key: 'verifications', table: 'verifications', mode: 'many', column: 'profile_id' },
  { key: 'gdpr_export_jobs', table: 'gdpr_export_jobs', mode: 'many', column: 'profile_id' },
  {
    key: 'gdpr_erasure_requests',
    table: 'gdpr_erasure_requests',
    mode: 'many',
    column: 'profile_id',
  },
];

/** One object `gdpr_export_media` lists: the member's own upload in one of the media buckets. */
export type MediaObject = {
  bucket_id: string;
  name: string;
  created_at: string | null;
  size: number | null;
  mimetype: string | null;
};

/** What a media file in the archive belongs to — a section key and the row's id. */
export type MediaOwner = { section: string; id: string };

/** One copied file, as the manifest lists it. `file` is relative to the archive's own folder. */
export type MediaFile = {
  file: string;
  bucket: string;
  path: string;
  created_at: string | null;
  size: number | null;
  content_type: string | null;
  belongs_to: MediaOwner | null;
  url: string;
};

/** A file that is the member's but is NOT in this archive, and why. */
export type MediaOmission = { bucket: string; path: string; reason: string };

/**
 * The media half of the archive (#784 ruling 1). `complete` is the manifest's promise: false
 * whenever `not_included` is non-empty, so a partial archive says so in the one place a member
 * (or anyone they hand it to) reads first — never a silent short list.
 */
export type MediaManifest = {
  complete: boolean;
  files: MediaFile[];
  not_included: MediaOmission[];
};

/**
 * Where a copied object lands: `{uid}/{job}/media/{bucket}/{rest of its key}`. Keeping the bucket
 * and the original key under the job's folder means the archive's own layout says where each
 * file came from, and `gdpr_export_reap_candidates` finds it by the job segment like the archive.
 */
export function mediaArchivePath(bucket: string, name: string, profileId: string): string {
  const rest = name.startsWith(`${profileId}/`) ? name.slice(profileId.length + 1) : name;
  return `media/${bucket}/${rest}`;
}

/**
 * Which row each of the member's storage keys belongs to, from the rows the archive already
 * holds. The manifest's `belongs_to` is how a file in `media/` is tied back to the post, moment,
 * story, candidacy, avatar or message it was uploaded for; a key no row names (an abandoned
 * upload the reaper has not reached yet) is still the member's and is still copied, with
 * `belongs_to: null`.
 */
const MEDIA_OWNERS: readonly {
  section: string;
  columns: readonly string[];
  owner: (row: Record<string, unknown>) => MediaOwner | null;
}[] = [
  { section: 'profile', columns: ['avatar_path'], owner: (r) => idOwner('profile', r.id) },
  {
    section: 'post_media',
    columns: ['storage_path', 'thumb_path'],
    owner: (r) => idOwner('posts', r.post_id),
  },
  {
    section: 'moments',
    columns: ['media_path', 'thumb_path'],
    owner: (r) => idOwner('moments', r.id),
  },
  {
    section: 'story_segments',
    columns: ['storage_path'],
    owner: (r) => idOwner('story_segments', r.id),
  },
  {
    section: 'dream_candidacies',
    columns: ['video_url', 'thumb_path'],
    owner: (r) => idOwner('dream_candidacies', r.id),
  },
  { section: 'messages', columns: ['media_url'], owner: (r) => idOwner('messages', r.id) },
];

function idOwner(section: string, id: unknown): MediaOwner | null {
  return typeof id === 'string' ? { section, id } : null;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

export function mediaOwnerIndex(results: Record<string, QueryResult>): Map<string, MediaOwner> {
  const index = new Map<string, MediaOwner>();
  for (const { section, columns, owner } of MEDIA_OWNERS) {
    for (const row of rowsOf(results[section]?.data)) {
      const who = owner(row);
      if (!who) continue;
      for (const column of columns) {
        const key = row[column];
        if (typeof key === 'string' && key !== '') index.set(key, who);
      }
    }
  }
  return index;
}

/** The last path segment of a storage key — what a received attachment is reduced to. */
function filenameOf(key: string): string {
  const i = key.lastIndexOf('/');
  return i === -1 ? key : key.slice(i + 1);
}

/**
 * The conversations and messages sections as the member receives them (#784 ruling 1).
 *
 * Read raw, both carry the counterpart's profile id — `participant_a/_b`,
 * `last_message_sender_id`, and `sender_id` on every received message. The archive carries none
 * of those. A conversation names the other person by `with_handle` only; a message says whether
 * the member sent it (`from_me`) and otherwise gives the sender's handle (`from_handle`, null for
 * the system and prompt messages, which have no sender, and for a counterpart with no handle).
 * `last_message_preview` goes too: it is a copy of a message the section already carries.
 *
 * Attachments follow the same line as the bytes. The member's own is named by its key and, when
 * the copy made it into the archive, by its `file` there. A received one is named by filename
 * only: the bytes are the sender's data, and so is the key, which begins with the sender's id.
 *
 * A message the SENDER withdrew (`deleted_at`) is kept as a row — the member did receive it — but
 * without its body or attachment: withdrawing is the sender's right over their own words. The
 * member's own withdrawn messages keep their body, as they always have: `deleted_at` hides a row
 * from the world, not from its author.
 */
export function redactConversations(
  profileId: string,
  conversations: unknown,
  messages: unknown,
  handles: ReadonlyMap<string, string | null>,
  copied: ReadonlyMap<string, string>,
): { conversations: Record<string, unknown>[]; messages: Record<string, unknown>[] } {
  const handleOf = (id: unknown) => (typeof id === 'string' ? (handles.get(id) ?? null) : null);

  const outConversations = rowsOf(conversations).map((c) => {
    const other = c.participant_a === profileId ? c.participant_b : c.participant_a;
    return {
      id: c.id,
      created_at: c.created_at,
      created_from: c.created_from,
      last_message_at: c.last_message_at,
      with_handle: handleOf(other),
    };
  });

  const outMessages = rowsOf(messages)
    .map((m) => {
      const fromMe = m.sender_id === profileId;
      const withdrawnByOther = !fromMe && m.deleted_at != null;
      const key = typeof m.media_url === 'string' && m.media_url !== '' ? m.media_url : null;
      let attachment: Record<string, unknown> | null = null;
      if (key && !withdrawnByOther) {
        attachment = fromMe
          ? { path: key, file: copied.get(key) ?? null }
          : { filename: filenameOf(key) };
      }
      return {
        id: m.id,
        conversation_id: m.conversation_id,
        created_at: m.created_at,
        kind: m.kind,
        from_me: fromMe,
        from_handle: fromMe ? null : handleOf(m.sender_id),
        body: withdrawnByOther ? null : (m.body ?? null),
        prompt_key: m.prompt_key ?? null,
        attachment,
        deleted_at: m.deleted_at ?? null,
      };
    })
    .sort(
      (a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)) ||
        String(a.id).localeCompare(String(b.id)),
    );

  return { conversations: outConversations, messages: outMessages };
}

/**
 * Pure: assemble the archive document from the per-section query results.
 * Inputs are already per-requester filtered (10 §5.3) — this only shapes + defaults.
 * The archive's key set is exactly EXPORT_SPEC's keys plus `exported_at`, `link_expires_at`,
 * `account` and `media`. `conversations` and `messages` arrive already redacted.
 */
export function assembleArchive(
  exportedAt: string,
  results: Record<string, QueryResult>,
  extra: {
    linkExpiresAt?: string | null;
    email?: string | null;
    media?: MediaManifest;
  } = {},
) {
  const archive: Record<string, unknown> = {
    exported_at: exportedAt,
    link_expires_at: extra.linkExpiresAt ?? null,
    account: { email: extra.email ?? null },
    media: extra.media ?? { complete: true, files: [], not_included: [] },
  };
  for (const spec of EXPORT_SPEC) {
    const data = results[spec.key]?.data;
    archive[spec.key] = spec.mode === 'one' ? (data ?? null) : (data ?? []);
  }
  return archive;
}

type PageQuery = {
  gt: (column: string, value: string) => PageQuery;
} & PromiseLike<QueryResult>;

/**
 * Read a query to the end, SECTION_PAGE rows at a time, keyed on `id` (rule 9). Stops on an EMPTY
 * page, never a short one — see SECTION_PAGE. A page row with no string id cannot carry the
 * cursor, and is reported as an error rather than looping or stopping early.
 */
async function readAll(build: () => PageQuery): Promise<QueryResult> {
  const rows: unknown[] = [];
  let cursor: string | null = null;
  for (;;) {
    let q = build();
    if (cursor !== null) q = q.gt('id', cursor);
    const page = (await q) as QueryResult;
    if (page.error) return { data: null, error: page.error };
    const data = Array.isArray(page.data) ? page.data : [];
    if (data.length === 0) return { data: rows };
    rows.push(...data);
    const last = (data[data.length - 1] as { id?: unknown })?.id;
    if (typeof last !== 'string') return { data: null, error: new Error('page row without an id') };
    cursor = last;
  }
}

/** Strictly own data (10 §5.3 invariant): every query filters by the requester's id. */
function ownDataQuery(
  db: SupabaseClient,
  spec: OwnDataSpec,
  profileId: string,
): PromiseLike<QueryResult> {
  const page = (q: unknown) =>
    (q as { order: (c: string) => { limit: (n: number) => PageQuery } })
      .order('id')
      .limit(SECTION_PAGE);
  switch (spec.mode) {
    case 'one':
      return db.from(spec.table).select('*').eq(spec.column, profileId).maybeSingle();
    case 'many':
      return readAll(() => page(db.from(spec.table).select('*').eq(spec.column, profileId)));
    case 'either':
      return readAll(() =>
        page(
          db
            .from(spec.table)
            .select('*')
            .or(`${spec.columns[0]}.eq.${profileId},${spec.columns[1]}.eq.${profileId}`),
        ),
      );
    case 'via':
      throw new Error(`via spec ${spec.key} needs its parent's ids — handled in collectOwnData`);
  }
}

/** Run the whole EXPORT_SPEC for one requester: direct sections batched, via sections after. */
async function collectOwnData(
  db: SupabaseClient,
  profileId: string,
): Promise<Record<string, QueryResult>> {
  const direct = EXPORT_SPEC.filter((s) => s.mode !== 'via');
  const settled = await Promise.all(direct.map((s) => ownDataQuery(db, s, profileId)));
  const results: Record<string, QueryResult> = {};
  direct.forEach((s, i) => {
    results[s.key] = settled[i] as QueryResult;
  });

  for (const spec of EXPORT_SPEC) {
    if (spec.mode !== 'via') continue;
    const parentRows = results[spec.parentKey]?.data;
    const ids = Array.isArray(parentRows)
      ? parentRows.map((r) => (r as { id?: unknown })?.id).filter((v) => typeof v === 'string')
      : [];
    // no parent rows → provably no child rows; skip the query instead of `in (empty)`
    const rows: unknown[] = [];
    let error: unknown = null;
    for (let i = 0; i < ids.length && !error; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const got = await readAll(() =>
        (
          db.from(spec.table).select('*').in(spec.column, chunk) as unknown as {
            order: (c: string) => { limit: (n: number) => PageQuery };
          }
        )
          .order('id')
          .limit(SECTION_PAGE),
      );
      if (got.error) error = got.error;
      else rows.push(...(got.data as unknown[]));
    }
    results[spec.key] = error ? { data: null, error } : { data: rows };
  }
  return results;
}

/**
 * The counterparts' handles, for the conversation redaction — `id, handle` and nothing else, for
 * exactly the profiles the member shares a conversation with. Not an own-data read, and the one
 * place the job reads another member's row: it is what lets the archive name the other person
 * without their profile id.
 */
async function counterpartHandles(
  db: SupabaseClient,
  profileId: string,
  conversations: unknown,
): Promise<{ handles: Map<string, string | null>; error: unknown }> {
  const ids = new Set<string>();
  for (const c of rowsOf(conversations)) {
    for (const id of [c.participant_a, c.participant_b]) {
      if (typeof id === 'string' && id !== profileId) ids.add(id);
    }
  }
  const handles = new Map<string, string | null>();
  const all = [...ids];
  for (let i = 0; i < all.length; i += ID_CHUNK) {
    const { data, error } = (await db
      .from('profiles')
      .select('id, handle')
      .in('id', all.slice(i, i + ID_CHUNK))) as QueryResult;
    if (error) return { handles, error };
    for (const row of rowsOf(data)) {
      if (typeof row.id === 'string') {
        handles.set(row.id, typeof row.handle === 'string' ? row.handle : null);
      }
    }
  }
  return { handles, error: null };
}

/** Every object `gdpr_export_media` lists for the member, paged on (bucket_id, name). */
async function listOwnMedia(
  db: SupabaseClient,
  profileId: string,
): Promise<{ objects: MediaObject[]; error: unknown }> {
  const objects: MediaObject[] = [];
  let after: MediaObject | null = null;
  for (;;) {
    const { data, error } = (await db.rpc('gdpr_export_media', {
      p_profile_id: profileId,
      p_after_bucket: after?.bucket_id ?? null,
      p_after_name: after?.name ?? null,
      p_limit: 1000,
    })) as QueryResult;
    if (error) return { objects, error };
    const page = Array.isArray(data) ? (data as MediaObject[]) : [];
    // Empty, never short, ends the listing — the function's own clamp says why.
    if (page.length === 0) return { objects, error: null };
    for (const o of page) {
      if (typeof o?.bucket_id !== 'string' || typeof o?.name !== 'string') {
        return { objects, error: new Error('gdpr_export_media returned a malformed row') };
      }
      objects.push(o);
    }
    after = page[page.length - 1];
  }
}

/** A copy onto a key the job already filled — a resumed pass — is the file being there. */
function alreadyExists(error: unknown): boolean {
  const e = error as { code?: unknown; statusCode?: unknown; status?: unknown } | null;
  return !!e && (e.code === 'ResourceAlreadyExists' || e.statusCode === '409' || e.status === 409);
}

function describe(error: unknown): string {
  const m = (error as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m !== '' ? m : 'copy failed';
}

type CopyOutcome =
  | {
      kind: 'done';
      copied: { object: MediaObject; dest: string; file: string }[];
      omitted: MediaOmission[];
    }
  | { kind: 'out_of_time' };

/**
 * Copy every listed object into the job's folder in `exports`, COPY_CONCURRENCY at a time.
 *
 * A copy that fails is NOT retried in this pass and does NOT withhold the archive. That is the
 * opposite of a failed section read, and deliberately: a section read either works for everyone
 * or is transient, while one object can fail for ever (a key whose bytes are gone, a file over the
 * ceiling) — and withholding the whole archive for it would deny the member everything else until
 * the servable window gave up. So the failure is named in `not_included` with its reason and the
 * manifest says `complete: false`. Running out of time is the one exception, because it is about
 * the pass, not the file: that returns `out_of_time` and the caller requeues.
 */
async function copyMedia(
  storage: ExportStorage,
  objects: MediaObject[],
  profileId: string,
  jobId: string,
  outOfTime: () => boolean,
): Promise<CopyOutcome> {
  const copied: { object: MediaObject; dest: string; file: string }[] = [];
  const omitted: MediaOmission[] = [];
  let timedOut = false;
  let next = 0;

  const worker = async () => {
    while (!timedOut && next < objects.length) {
      if (outOfTime()) {
        timedOut = true;
        return;
      }
      const object = objects[next++];
      if (object.size !== null && object.size > EXPORTS_OBJECT_LIMIT) {
        omitted.push({ bucket: object.bucket_id, path: object.name, reason: 'too_large' });
        continue;
      }
      const file = mediaArchivePath(object.bucket_id, object.name, profileId);
      const dest = `${profileId}/${jobId}/${file}`;
      const { error } = await storage.copyIn(object.bucket_id, object.name, dest);
      if (error && !alreadyExists(error)) {
        console.warn(
          'gdpr-export-job: media copy failed',
          jobId,
          object.bucket_id,
          describe(error),
        );
        omitted.push({ bucket: object.bucket_id, path: object.name, reason: describe(error) });
        continue;
      }
      copied.push({ object, dest, file });
    }
  };
  await Promise.all(Array.from({ length: COPY_CONCURRENCY }, worker));
  if (timedOut) return { kind: 'out_of_time' };

  const order = (a: { bucket?: string; path?: string }, b: { bucket?: string; path?: string }) =>
    `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`);
  copied.sort((a, b) =>
    order(
      { bucket: a.object.bucket_id, path: a.object.name },
      {
        bucket: b.object.bucket_id,
        path: b.object.name,
      },
    ),
  );
  omitted.sort(order);
  return { kind: 'done', copied, omitted };
}

/** Sign every copied file in batches; null when any path came back without a url. */
async function signMedia(
  storage: ExportStorage,
  dests: string[],
): Promise<{ urls: Map<string, string> | null; error?: unknown }> {
  const urls = new Map<string, string>();
  for (let i = 0; i < dests.length; i += 500) {
    const batch = dests.slice(i, i + 500);
    const { data, error } = await storage.createSignedUrls(batch, SIGNED_TTL_SECONDS);
    if (error || !Array.isArray(data)) return { urls: null, error };
    for (const entry of data) {
      if (entry?.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
    }
    for (const path of batch) if (!urls.has(path)) return { urls: null, error: `unsigned ${path}` };
  }
  return { urls };
}

/** One row of `claim_export_jobs` — the job, its subject, its age, and the lease stamp we hold. */
type ExportClaim = { id: string; profile_id: string; created_at: string; claimed_at: string };

/** The first section whose query errored, or null — see QueryResult. */
function firstSectionError(
  results: Record<string, QueryResult>,
): { key: string; error: unknown } | null {
  for (const spec of EXPORT_SPEC) {
    const error = results[spec.key]?.error;
    if (error) return { key: spec.key, error };
  }
  return null;
}

/**
 * Write a job's status, but ONLY while this pass still holds the lease it was claimed under.
 *
 * The fence is `erasure-job`'s (`logic.ts:159-181`, #717) and it is not decoration. A pass can
 * outlive its lease — an unusually long assembly, or an operator releasing the lease by hand
 * (RELEASE-RUNBOOK §7.6) — and a later pass then re-claims the row and starts building it. Without
 * the guard this pass's write lands on that row: 'ready' with a URL for an archive the second pass
 * is still uploading, or a requeue that takes the row OUT of 'processing' while it is being
 * worked. PostgREST answers a no-op update with success, so the `.select()` is what makes the lost
 * lease visible at all.
 *
 * `claimed_at` is deliberately not cleared, on any path: the column's contract
 * (20260908152740) is that it is set by the claim and never cleared, so a requeued row carries
 * the stamp of the pass that gave up on it — harmless, because the claim's 'requested' arm does
 * not read the stamp, and honest about what last touched the row.
 */
async function writeStatus(
  db: SupabaseClient,
  jobId: string,
  claimedAt: string,
  status: 'ready' | 'requested' | 'failed',
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { data, error } = await db
    .from('gdpr_export_jobs')
    .update({ status, ...extra })
    .eq('id', jobId)
    .eq('claimed_at', claimedAt)
    .select('id');
  if (error) {
    console.error('gdpr-export-job: status write failed', jobId, status, error);
  } else if (Array.isArray(data) && data.length === 0) {
    // An EMPTY array, not a falsy `data`: with `.select()` PostgREST answers a successful update
    // with a row array, so `[]` is positive evidence the fence rejected the write, while a null
    // with no error is evidence of nothing. Not an error we can act on — the row belongs to
    // someone else now — but it guarantees a duplicate pass over this job, so it must not be
    // silent.
    console.warn('gdpr-export-job: lease lost before the status write', jobId, status);
  }
}

/**
 * The retention half of the pass (#784 ruling 2): delete every `exports` object no live job
 * protects, then every row past its window. Runs BEFORE the claim, and never fails the pass: a
 * reap that errors is logged and reported, and tonight's exports are built anyway — an archive
 * the member is waiting on outranks tidying yesterday's. The two halves converge in either order
 * (20260925154710's header), so a half that failed tonight is simply finished tomorrow.
 */
async function reapExpired(ctx: ExportJobCtx): Promise<Record<string, unknown>> {
  const { db, storage } = ctx;
  const res = await reapBucket({
    listCandidates: (limit) => db.rpc('gdpr_export_reap_candidates', { p_limit: limit }),
    remove: (paths) => storage.remove(paths),
  });
  const objects = (await res.json()) as Record<string, unknown>;
  if (objects.error) console.error('gdpr-export-job: object reap failed', objects.error);

  const { data, error } = (await db.rpc('gdpr_export_reap_jobs')) as QueryResult;
  if (error) console.error('gdpr-export-job: row reap failed', error);
  return {
    objects,
    jobs: error ? { error: describe(error) } : { reaped: typeof data === 'number' ? data : 0 },
  };
}

export async function processExportJobs(ctx: ExportJobCtx): Promise<Response> {
  const { db, storage } = ctx;
  const now = ctx.now ?? Date.now;
  const deadline = now() + PASS_BUDGET_MS;
  const outOfTime = () => now() > deadline;

  const reap = await reapExpired(ctx);

  // ATOMIC LEASE CLAIM (#721) — one statement, in the database, flips the rows to 'processing'
  // and stamps `claimed_at`. What it replaced was a SELECT on `status = 'requested'` followed by
  // an UPDATE predicated on the row id alone — nothing re-checked that the row was still
  // 'requested' — which had two holes: a pass torn down between them
  // stranded the row on 'processing' with nothing left to re-queue it, and two overlapping passes
  // both built, uploaded and signed the same archives.
  //
  // The claim is an RPC rather than a PostgREST filter chain because the conditional
  // UPDATE ... RETURNING that decides the winner cannot be expressed here. 20260908152740 holds
  // the predicate; 0057 proves it. The assertions below are this loop's half of the contract,
  // which is that it asks for the batch and fences every status write on the stamp it got back.
  const { data: jobs, error } = await db.rpc('claim_export_jobs', { p_limit: CLAIM_BATCH });
  if (error) return new Response(error.message, { status: 500 });

  const claims = (jobs ?? []) as ExportClaim[];
  /** Jobs this pass filed terminal-failed, reported so a smoke invocation can see them (#515). */
  let failed = 0;
  /** Jobs handed back to the queue because the pass ran out of time (PASS_BUDGET_MS). */
  let deferred = 0;

  for (let i = 0; i < claims.length; i++) {
    const job = claims[i];
    // OUR stamp. Every status write below fences on it, so a pass whose lease expired mid-run
    // cannot write over a row a later pass has already re-claimed (20260908152740).
    const claimed = job.claimed_at;

    // Out of time before this job starts: hand it and every claim behind it back, rather than
    // letting each sit under its lease for 15 minutes and then wait for tomorrow night anyway.
    if (outOfTime()) {
      for (const rest of claims.slice(i)) {
        await writeStatus(db, rest.id, rest.claimed_at, 'requested');
        deferred++;
      }
      break;
    }

    // Past the servable window: no signed link this job could carry would satisfy the 30-day
    // expiry cap, so building the archive would only end in a discarded 23514. Fail it before any
    // work — the member's retry is one tap and produces a job that CAN be served.
    //
    // An unparseable created_at fails CLOSED. `NaN > SERVABLE_WINDOW_MS` is false, so an
    // unguarded comparison would wave such a job THROUGH the one fence that exists to stop it
    // being rebuilt and rejected every night — the unsafe direction, and silent.
    const ageMs = Date.now() - Date.parse(job.created_at);
    if (!Number.isFinite(ageMs) || ageMs > SERVABLE_WINDOW_MS) {
      console.warn(
        'gdpr-export-job: past the servable window, filed failed',
        job.id,
        job.created_at,
      );
      await writeStatus(db, job.id, claimed, 'failed');
      failed++;
      continue;
    }

    const results = await collectOwnData(db, job.profile_id);
    const handles = await counterpartHandles(db, job.profile_id, results.conversations?.data);
    const account = await ctx.getEmail(job.profile_id);
    const media = await listOwnMedia(db, job.profile_id);
    const readError =
      firstSectionError(results) ??
      (handles.error ? { key: 'conversations (handles)', error: handles.error } : null) ??
      (account.error ? { key: 'account (email)', error: account.error } : null) ??
      (media.error ? { key: 'media (listing)', error: media.error } : null);
    if (readError) {
      // Withheld, not shipped short: an archive missing a section reads to the member as «you
      // have none of this», and nothing on the screen could tell them otherwise.
      //
      // Requeued rather than failed, and the distinction is the member's Art. 15 request. A
      // statement timeout on `messages` for a heavy account is as transient as a failed upload
      // and is retried the same way; nothing has been uploaded at this point, so retrying cannot
      // publish a partial archive. What stops it retrying for ever is the servable-window fence
      // above: a read that keeps failing eventually ages the job out and files it 'failed', which
      // is the point where the member is told and asked to try again.
      console.error(
        'gdpr-export-job: section read failed, archive withheld and requeued',
        job.id,
        readError.key,
        readError.error,
      );
      await writeStatus(db, job.id, claimed, 'requested');
      continue;
    }

    const copies = await copyMedia(storage, media.objects, job.profile_id, job.id, outOfTime);
    if (copies.kind === 'out_of_time') {
      // Requeued with its copies in place; the next pass resumes (PASS_BUDGET_MS). The claims
      // behind this one are handed back by the check at the top of the next iteration.
      console.warn('gdpr-export-job: out of time copying media, requeued', job.id);
      await writeStatus(db, job.id, claimed, 'requested');
      deferred++;
      continue;
    }

    // ONE expiry for everything this job hands over, fixed before anything is signed: every url
    // signed after this instant outlives it, so no file in the archive dies before the row says
    // the archive does.
    const expiresAt = new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString();

    const signedMedia = await signMedia(
      storage,
      copies.copied.map((c) => c.dest),
    );
    if (!signedMedia.urls) {
      console.error('gdpr-export-job: media signing failed, requeued', job.id, signedMedia.error);
      await writeStatus(db, job.id, claimed, 'requested');
      continue;
    }

    const owners = mediaOwnerIndex(results);
    const manifest: MediaManifest = {
      complete: copies.omitted.length === 0,
      files: copies.copied.map(({ object, dest, file }) => ({
        file,
        bucket: object.bucket_id,
        path: object.name,
        created_at: object.created_at,
        size: object.size,
        content_type: object.mimetype,
        belongs_to: owners.get(object.name) ?? null,
        url: signedMedia.urls!.get(dest)!,
      })),
      not_included: copies.omitted,
    };

    const redacted = redactConversations(
      job.profile_id,
      results.conversations?.data,
      results.messages?.data,
      handles.handles,
      new Map(copies.copied.map((c) => [c.object.name, c.file])),
    );
    const archive = assembleArchive(
      new Date().toISOString(),
      {
        ...results,
        conversations: { data: redacted.conversations },
        messages: { data: redacted.messages },
      },
      { linkExpiresAt: expiresAt, email: account.email, media: manifest },
    );

    const path = `${job.profile_id}/${job.id}/archive.json`;
    const up = await storage.upload(path, JSON.stringify(archive, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });
    if (up.error) {
      // Retryable, and idempotent to retry: the key is deterministic and the upload upserts, so
      // the next pass overwrites rather than accumulating. The servable-window fence above is what
      // stops this retrying for ever.
      console.error('gdpr-export-job: upload failed, requeued', job.id, up.error);
      await writeStatus(db, job.id, claimed, 'requested');
      continue;
    }

    const signed = await storage.createSignedUrl(path, SIGNED_TTL_SECONDS);
    const signedUrl = signed.data?.signedUrl ?? null;
    if (!signedUrl) {
      // Same policy as a failed upload, and the reason this branch exists at all: writing 'ready'
      // with a null download_url produced a row the screen reads as neither pending nor ready —
      // while the #129 producer, which guards on the status alone and never reads download_url,
      // told the member their archive was ready. They opened the screen and found no link, on a
      // row nothing would ever pick up again. Worse than silence, not milder.
      console.error('gdpr-export-job: signing returned no url, requeued', job.id, signed.error);
      await writeStatus(db, job.id, claimed, 'requested');
      continue;
    }

    // status → 'ready' fires gdpr_export_jobs_notify_ready (20260813162227): the in-app
    // «your archive is ready» notification reaches the member through the guarded fan-out. The
    // trigger guards on `old.status is distinct from 'ready'`, so a re-claimed job notifies once.
    await writeStatus(db, job.id, claimed, 'ready', {
      download_url: signedUrl,
      expires_at: expiresAt,
    });
  }

  return new Response(JSON.stringify({ processed: claims.length, failed, deferred, reap }), {
    headers: { 'content-type': 'application/json' },
  });
}
