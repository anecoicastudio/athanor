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
 * Pure: assemble the archive document from the six own-data query results.
 * Inputs are already per-requester filtered (10 §5.3) — this only shapes + defaults.
 */
export function assembleArchive(
  exportedAt: string,
  q: {
    profile: QueryResult;
    dreams: QueryResult;
    posts: QueryResult;
    moments: QueryResult;
    messages: QueryResult;
    consent: QueryResult;
  },
) {
  return {
    exported_at: exportedAt,
    profile: q.profile.data ?? null,
    dreams: q.dreams.data ?? [],
    posts: q.posts.data ?? [],
    moments: q.moments.data ?? [],
    messages: q.messages.data ?? [],
    consent: q.consent.data ?? [],
    // TODO(M9-deploy): include event_tickets and event_attendance refs once
    // the export bucket is provisioned and RESEND email is configured.
  };
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

    // Strictly own data (10 §5.3 invariant). Each query filters by the requester's own id;
    // no other user's data ever appears in the archive.
    // Column names verified against packages/api/src/database.types.ts:
    //   profiles.id, dreams.profile_id, posts.author_id, moments.owner_id, messages.sender_id, consent.profile_id
    const [profile, dreams, posts, moments, messages, consents] = await Promise.all([
      db.from('profiles').select('*').eq('id', job.profile_id).maybeSingle(),
      db.from('dreams').select('*').eq('profile_id', job.profile_id),
      db.from('posts').select('*').eq('author_id', job.profile_id),
      db.from('moments').select('*').eq('owner_id', job.profile_id), // owner_id (NOT profile_id — verified)
      db.from('messages').select('*').eq('sender_id', job.profile_id),
      db.from('consent').select('*').eq('profile_id', job.profile_id),
    ]);

    const archive = assembleArchive(new Date().toISOString(), {
      profile,
      dreams,
      posts,
      moments,
      messages,
      consent: consents,
    });

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

    await db
      .from('gdpr_export_jobs')
      .update({
        status: 'ready',
        download_url: signed.data?.signedUrl ?? null,
        expires_at: expiresAt,
      })
      .eq('id', job.id);

    // TODO(M9-deploy): email the signed link via RESEND_API_KEY (11 §3.9 — optional secret).
  }

  return new Response(JSON.stringify({ processed: jobs?.length ?? 0 }), {
    headers: { 'content-type': 'application/json' },
  });
}
