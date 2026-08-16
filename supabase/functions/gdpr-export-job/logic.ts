import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Export job extracted from index.ts so the own-data invariant is unit-testable (deno test):
// index.ts keeps the transport shell (requireServiceRole, client + storage port wiring) and
// injects everything here (repo convention: DI over mocks). Storage arrives as a capability
// port because the fake db has no .storage namespace.

export const SIGNED_TTL_SECONDS = 72 * 60 * 60; // 72h (≤30d GDPR cap; target far sooner — 10 §5)

/** The `exports` bucket surface the job needs — index wires db.storage.from('exports'). */
export type ExportStorage = {
  upload: (
    path: string,
    body: string,
    opts: { contentType: string; upsert: boolean },
  ) => Promise<{ error: unknown }>;
  createSignedUrl: (
    path: string,
    ttlSeconds: number,
  ) => Promise<{ data: { signedUrl: string } | null }>;
};

export type ExportJobCtx = {
  /** service role — reads across the requester's rows + owns the job status column */
  db: SupabaseClient;
  storage: ExportStorage;
};

type QueryResult = { data: unknown };

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

export async function processExportJobs(ctx: ExportJobCtx): Promise<Response> {
  const { db, storage } = ctx;

  const { data: jobs, error } = await db
    .from('gdpr_export_jobs')
    .select('id, profile_id')
    .eq('status', 'requested')
    .limit(50);
  if (error) return new Response(error.message, { status: 500 });

  for (const job of jobs ?? []) {
    await db.from('gdpr_export_jobs').update({ status: 'processing' }).eq('id', job.id);

    const results = await collectOwnData(db, job.profile_id);
    const archive = assembleArchive(new Date().toISOString(), results);

    const path = `${job.profile_id}/${job.id}.json`;
    const up = await storage.upload(path, JSON.stringify(archive, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });
    if (up.error) {
      await db.from('gdpr_export_jobs').update({ status: 'requested' }).eq('id', job.id); // retry next run
      continue;
    }

    const signed = await storage.createSignedUrl(path, SIGNED_TTL_SECONDS);
    const expiresAt = new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString();

    // status → 'ready' fires gdpr_export_jobs_notify_ready (20260813162227): the in-app
    // «your archive is ready» notification reaches the member through the guarded fan-out.
    await db
      .from('gdpr_export_jobs')
      .update({
        status: 'ready',
        download_url: signed.data?.signedUrl ?? null,
        expires_at: expiresAt,
      })
      .eq('id', job.id);
  }

  return new Response(JSON.stringify({ processed: jobs?.length ?? 0 }), {
    headers: { 'content-type': 'application/json' },
  });
}
