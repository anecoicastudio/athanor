// gdpr-export-job (11 §3.9 8a) — service-role, nightly pg_cron over gdpr_export_jobs status='requested'.
// Assembles the user's archive (profile, dreams, posts, moments, messages, consent, tickets/rsvps refs),
// uploads to the private `exports` bucket, signs a time-limited URL (72h — 10 §5 open decision), emails
// it, and sets status='ready' + download_url + expires_at. Archive assembly is server-side and is NEVER
// bundled into the app build (09 §6). DEPLOY-DEFERRED: not deployed this slice; pg_cron scheduled at deploy-time.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const SIGNED_TTL_SECONDS = 72 * 60 * 60; // 72h (≤30d GDPR cap; target far sooner — 10 §5)

Deno.serve(async (req) => {
  // Caller gate: service-role only. verify_jwt=true merely proves a valid project JWT
  // (every member has one) — assert the bearer IS the service-role key.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || bearer !== serviceKey) return new Response('unauthorized', { status: 401 });

  const db = supabaseAdmin();

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

    const archive = {
      exported_at: new Date().toISOString(),
      profile: profile.data ?? null,
      dreams: dreams.data ?? [],
      posts: posts.data ?? [],
      moments: moments.data ?? [],
      messages: messages.data ?? [],
      consent: consents.data ?? [],
      // TODO(M9-deploy): include event_tickets and event_attendance refs once
      // the export bucket is provisioned and RESEND email is configured.
    };

    const path = `${job.profile_id}/${job.id}.json`;
    const up = await db.storage.from('exports').upload(path, JSON.stringify(archive, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });
    if (up.error) {
      await db.from('gdpr_export_jobs').update({ status: 'requested' }).eq('id', job.id); // retry next run
      continue;
    }

    const signed = await db.storage.from('exports').createSignedUrl(path, SIGNED_TTL_SECONDS);
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
});
