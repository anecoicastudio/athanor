import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Export job extracted from index.ts so the own-data invariant is unit-testable (deno test):
// index.ts keeps the transport shell (requireServiceRole, client + storage port wiring) and
// injects everything here (repo convention: DI over mocks). Storage arrives as a capability
// port because the fake db has no .storage namespace.

export const SIGNED_TTL_SECONDS = 72 * 60 * 60; // 72h (≤30d GDPR cap; target far sooner — 10 §5)

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
};

export type ExportJobCtx = {
  /** service role — reads across the requester's rows + owns the job status column */
  db: SupabaseClient;
  storage: ExportStorage;
};

// `error` is read, not decoration: a section whose query fails resolves `data: null`, which
// assembleArchive defaults to null/[] — indistinguishable from «this member has none». An archive
// that silently omits a member's messages is a worse answer to an Art. 15 request than no archive
// at all, so the loop withholds it and files the job 'failed' (#721).
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
  { key: 'messages', table: 'messages', mode: 'many', column: 'sender_id' },
  // #637: the member's own read cursors. Not authored content — a timestamp per thread —
  // but it is behavioural data ABOUT them (when they read what, and which threads they
  // never opened), which is squarely what access and portability cover. Exported rather
  // than excluded for that reason: `conversations` is excluded in 0096 because the row is
  // mostly the counterpart's identity, and this row is the opposite — it is only ever the
  // member's own behaviour, and it exists on no one else's copy.
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

/**
 * Pure: assemble the archive document from the per-section query results.
 * Inputs are already per-requester filtered (10 §5.3) — this only shapes + defaults.
 * The archive's key set is exactly EXPORT_SPEC's keys plus `exported_at`.
 */
export function assembleArchive(exportedAt: string, results: Record<string, QueryResult>) {
  const archive: Record<string, unknown> = { exported_at: exportedAt };
  for (const spec of EXPORT_SPEC) {
    const data = results[spec.key]?.data;
    archive[spec.key] = spec.mode === 'one' ? (data ?? null) : (data ?? []);
  }
  return archive;
}

/** Strictly own data (10 §5.3 invariant): every query filters by the requester's id. */
function ownDataQuery(db: SupabaseClient, spec: OwnDataSpec, profileId: string) {
  switch (spec.mode) {
    case 'one':
      return db.from(spec.table).select('*').eq(spec.column, profileId).maybeSingle();
    case 'many':
      return db.from(spec.table).select('*').eq(spec.column, profileId);
    case 'either':
      return db
        .from(spec.table)
        .select('*')
        .or(`${spec.columns[0]}.eq.${profileId},${spec.columns[1]}.eq.${profileId}`);
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
    results[spec.key] =
      ids.length === 0
        ? { data: [] }
        : ((await db.from(spec.table).select('*').in(spec.column, ids)) as QueryResult);
  }
  return results;
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

export async function processExportJobs(ctx: ExportJobCtx): Promise<Response> {
  const { db, storage } = ctx;

  // ATOMIC LEASE CLAIM (#721) — one statement, in the database, flips the rows to 'processing'
  // and stamps `claimed_at`. What it replaced was a SELECT on `status = 'requested'` followed by
  // an UPDATE carrying no predicate at all, which had two holes: a pass torn down between them
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

  for (const job of claims) {
    // OUR stamp. Every status write below fences on it, so a pass whose lease expired mid-run
    // cannot write over a row a later pass has already re-claimed (20260908152740).
    const claimed = job.claimed_at;

    // Past the servable window: no signed link this job could carry would satisfy the 30-day
    // expiry cap, so building the archive would only end in a discarded 23514. Fail it before any
    // work — the member's retry is one tap and produces a job that CAN be served.
    if (Date.now() - Date.parse(job.created_at) > SERVABLE_WINDOW_MS) {
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
    const sectionError = firstSectionError(results);
    if (sectionError) {
      // Withheld, not shipped short: an archive missing a section reads as «you have none of
      // this», and the member has no way to tell. Terminal, because the alternative is a nightly
      // silent rebuild the member is never told about.
      console.error(
        'gdpr-export-job: section read failed, archive withheld',
        job.id,
        sectionError.key,
        sectionError.error,
      );
      await writeStatus(db, job.id, claimed, 'failed');
      failed++;
      continue;
    }

    const archive = assembleArchive(new Date().toISOString(), results);

    const path = `${job.profile_id}/${job.id}.json`;
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
      // with a null download_url produced a row the screen reads as neither pending nor ready, so
      // the member was told nothing and the row was terminal — a second stranding shape.
      console.error('gdpr-export-job: signing returned no url, requeued', job.id, signed.error);
      await writeStatus(db, job.id, claimed, 'requested');
      continue;
    }

    const expiresAt = new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString();

    // status → 'ready' fires gdpr_export_jobs_notify_ready (20260813162227): the in-app
    // «your archive is ready» notification reaches the member through the guarded fan-out. The
    // trigger guards on `old.status is distinct from 'ready'`, so a re-claimed job notifies once.
    await writeStatus(db, job.id, claimed, 'ready', {
      download_url: signedUrl,
      expires_at: expiresAt,
    });
  }

  return new Response(JSON.stringify({ processed: claims.length, failed }), {
    headers: { 'content-type': 'application/json' },
  });
}
