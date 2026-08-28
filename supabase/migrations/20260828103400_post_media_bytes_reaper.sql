-- Post-media bytes reaper (#589): the byte side of the composer's publish path.
--
-- `post_media` ROWS have been exactly right since 20260828083140 (#588) — `publish_post`
-- upserts the new set and deletes every position the new set does not fill, in one
-- transaction. Its own header says what it deliberately leaves behind: "The BYTES are not
-- swept." Two sources, and one reaper owns both:
--
--   superseded — objects a PREVIOUS media set uploaded that the new set does not reference.
--                Tail positions when the set gets shorter, and the old key at a position
--                whose kind changed (`postMediaPath` keys by position AND by the kind's
--                extension, so `0.mp4` → `0.jpg` writes beside the old file rather than over
--                it). A video→image swap orphans TWO objects, because the mp4's poster
--                `{index}-thumb.jpg` goes with it.
--   abandoned  — the dominant source. `post-compose.tsx` uploads the bytes BEFORE the write
--                (#579's order, so a failed publish can never leave a post claiming media
--                with nothing behind it), so a member who abandons the draft rather than
--                retrying leaves objects no row ever pointed at. The same trade
--                `use-moment-upload` already makes.
--
-- Neither is a compliance gap: `gdpr_storage_footprint` (20260827110034) sweeps `post-media`
-- by `{uid}/` prefix, so erasure reaches all of it. This is storage cost.
--
-- ── Shape: `story-segment-reaper`'s, and for the same reason ───────────────────────────────
--
-- Deletion CANNOT be a `delete from storage.objects`. Storage keeps only metadata in Postgres;
-- the bytes live in the object store, and the docs are explicit: "Deleting the metadata
-- doesn't remove the object in the underlying storage provider. This results in your object
-- being inaccessible, but you'll still be billed for it"
-- (supabase.com/docs/guides/storage/schema/design). So the same three-way split as #31:
--
--   • `post_media_reap_candidates` (here, SQL) — WHICH objects, next to the table it diffs.
--   • `post-media-reaper` (edge function)      — HOW: lists through the RPC, deletes through
--     the Storage API in batches of ≤ 1000, re-lists each round. Shares the loop with
--     `story-segment-reaper` (`_shared/reap.ts`); only the bucket and the RPC differ.
--   • `invoke_post_media_reaper()` + a cron job — WHEN. A NEW job rather than an extension of
--     an existing one: there is no nightly post-side prune to ride on, and `post_media` needs
--     no row-side work at all (that is `publish_post`'s, already done, in the transaction).
--
-- ── The candidate predicate ────────────────────────────────────────────────────────────────
--
-- An object in `post-media` is a candidate when NO `post_media` row references it — from
-- either column — and it is older than `p_grace` (1 hour by default). That is the whole
-- predicate. It needs no descriptor-liveness term the way #31's does, because a post_media row
-- does not expire: it exists until `publish_post`'s sweep or the post's hard delete removes
-- it, and nothing else writes the bucket.
--
-- BOTH columns, and that is not a detail. `thumb_path` holds a video's poster
-- (`{uid}/{postId}/{index}-thumb.jpg`, 20260813082300) and it is a real object in the same
-- bucket. A predicate that diffed on `storage_path` alone would list every live poster in the
-- bucket and delete it — every feed video back to a bare ▶, which is the defect #318 closed.
-- Written as two `not exists` rather than one with an `or`, so each can take its own index.
--
-- The grace covers the composer's upload-then-write window, which is what makes an in-flight
-- publish safe: between `processAndUpload` and `publishPost` the object exists with no row,
-- and that is a healthy publish, not garbage. Seconds in practice; an hour of margin.
--
-- The age term reads `greatest(created_at, updated_at)`, not `created_at` alone. A retry
-- re-uploads to the SAME key (`upsert: true`), and storage-api overwrites the object in place
-- — it bumps `version` (which is what `media_process_enqueue`'s `update of version` trigger
-- fires on) and leaves `created_at` at the first attempt's timestamp. So a member who uploads
-- at 03:00, fails to publish, and re-taps at 04:30 would otherwise present a 90-minute-old
-- object to a pass running between their upload and their write: listed, then deleted after
-- the bytes were rewritten, leaving the row to describe a file that is gone. Reading the later
-- of the two timestamps makes a re-upload reset the clock and closes that window. If
-- storage-api ever stops bumping `updated_at`, this degrades to `created_at` — #31's
-- behaviour — rather than to something unsafe.
--
-- `greatest` IGNORES nulls in Postgres (unlike arithmetic), so an object with only one of the
-- two timestamps is still aged by the one it has; with neither, the comparison is NULL → false
-- and the object is never reaped. Conservative in the direction that matters.
--
-- ── What is deliberately NOT reaped ────────────────────────────────────────────────────────
--
-- A SOFT-DELETED post keeps its bytes. `post_media` has no `deleted_at` and its FK cascade
-- fires only on a hard delete of the post, which nothing performs — so a deleted post keeps
-- its rows, its rows keep referencing their objects, and this predicate never lists them.
-- That is a THIRD byte source, and it is left standing on purpose rather than by oversight:
--
--   • Freeing them is irreversible and is a product decision, not a cleanup. #31 made the
--     opposite call for stories («a take-down loses its bytes») because a story is ephemeral
--     by construction; a post is the member's history.
--   • The one undelete path in the tree would break. `refresh-staging.sql` §3 revives the
--     twelve seeded posts in place with `deleted_at = null` every hour and never re-uploads
--     bytes (`pnpm staging:media` does that, by hand). Reaping a soft-deleted post's objects
--     would leave the revived rows pointing at nothing — four broken cards in the fake world
--     until somebody re-ran the upload script.
--
-- If that source is ever wanted, it is an arm on this predicate (`… or the post is deleted
-- beyond a grace`), not a second mechanism.
--
-- ── Key handling (rule 8's cron half) ──────────────────────────────────────────────────────
--
-- `invoke_post_media_reaper()` resolves url/key at CALL time through athanor.runtime_setting
-- (GUC first, else Vault) and presents the key on the `apikey` header via
-- athanor.edge_auth_headers — never a literal in cron.job.command, never a hand-built
-- Authorization bearer (an sb_secret_… key is not a JWT). This migration creates NO secret.
-- The operator creates the Vault pair per project (deploy rider, docs/RELEASE-RUNBOOK.md §5):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/post-media-reaper',
--                              'app.settings.post_media_reaper_url');
--   select vault.create_secret('sb_secret_…', 'app.settings.post_media_reaper_key');
-- Until both exist the wrapper no-ops — the guard tests `is null` explicitly, because a bare
-- boolean test on a NULL setting is NULL, which is not true and therefore falls THROUGH the
-- guard instead of taking it. No error loop on a fresh CI stack or before the rider runs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 1. The indexes the predicate needs ─────────────────────────────────────────────────────

-- Without these the anti-join is a seq scan of post_media per candidate object. `post_media`
-- carried only its PK and the (post_id, position) unique index; neither answers "is this key
-- referenced?". Two indexes rather than one composite: the two `not exists` arms probe
-- different columns, and a composite on (storage_path, thumb_path) serves only the first.
create index if not exists post_media_storage_path_idx
  on public.post_media (storage_path);

-- Partial: thumb_path is null for every image and audio row and for video rows whose poster
-- extraction failed (20260813082300 — best-effort by design), so the index holds only the
-- rows that can ever match.
create index if not exists post_media_thumb_path_idx
  on public.post_media (thumb_path)
  where thumb_path is not null;

-- ── 2. WHICH: the candidate enumeration, service_role-only ─────────────────────────────────

-- SECURITY INVOKER, the correction 20260821082216 made to #31's definer version and the
-- default this schema keeps: the only grantee is the reaper's service-role client, which
-- carries BYPASSRLS and SELECT on both storage.objects and public.post_media, so definer
-- rights would return identical rows while leaving a postgres-owned function that enumerates
-- storage.objects across every owner folder for the next widened grant to find. STABLE: it
-- lists, the Storage API deletes.
create function public.post_media_reap_candidates(
  p_limit integer default 1000,
  p_grace interval default interval '1 hour'
) returns table (name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'post-media'
     and greatest(o.created_at, o.updated_at) < now() - p_grace
     and not exists (
       select 1 from public.post_media pm where pm.storage_path = o.name
     )
     and not exists (
       select 1 from public.post_media pm where pm.thumb_path = o.name
     )
   -- Oldest first: the backlog drains in the order it accumulated.
   order by greatest(o.created_at, o.updated_at), o.name
   -- Clamped to the Storage API's per-call ceiling (1000) so the edge function can pass its
   -- batch size straight through, and to ≥ 1 so a zero never means "everything".
   limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

comment on function public.post_media_reap_candidates(integer, interval) is
  'Objects in post-media referenced by no post_media row, from either storage_path or thumb_path, and untouched for p_grace (#589): the superseded and abandoned bytes publish_post deliberately leaves behind. Oldest first, ≤ 1000. A soft-deleted post keeps its rows and therefore its bytes. Invoker: read by the post-media-reaper edge function as service_role, which needs no definer rights. The deletion goes through the Storage API, never this table.';

revoke execute on function public.post_media_reap_candidates(integer, interval)
  from public, anon, authenticated;
grant execute on function public.post_media_reap_candidates(integer, interval) to service_role;

-- ── 3. HOW it is reached: the pg_net caller ────────────────────────────────────────────────

-- SECURITY DEFINER to match every pg_net caller here (invoke_score_engine_decay,
-- invoke_story_segment_reaper, invoke_fund_settle_sweep, the enqueue_* family): it only posts
-- HTTP, and definer + locked search_path + revoked client EXECUTE is their audited shape.
create function public.invoke_post_media_reaper() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := athanor.runtime_setting('post_media_reaper_url');
  v_key text := athanor.runtime_setting('post_media_reaper_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- reaper not configured (pre-deploy) → no-op, never an error loop
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: an sb_secret_… key
    -- is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object('job', 'reap-post-media-bytes'),
    -- 30 s, like #31's: a round deletes up to 1000 objects through the Storage API and the
    -- function answers only when its rounds are done.
    timeout_milliseconds := 30000
  );
end;
$$;

comment on function public.invoke_post_media_reaper() is
  'Posts to the post-media-reaper edge function (#589) with the key from Vault on the apikey header. No-op until app.settings.post_media_reaper_url/_key exist. Called by the reap-post-media-bytes cron job.';

revoke execute on function public.invoke_post_media_reaper() from public, anon, authenticated;

-- ── 4. WHEN: a new nightly job ─────────────────────────────────────────────────────────────

-- 04:29 UTC: clear of the 03:11/03:17 nightly cluster (momenti-matcher, aura-decay, the story
-- prune) and of fund-settle-sweep at 04:41, so a slow pass overlaps nothing. Cron calls the
-- wrapper directly — there is no row-side work to do first, unlike #31's prune.
--
-- Unschedule-if-present then schedule, so the migration replays cleanly from zero and is
-- re-runnable on a hosted project.
select cron.unschedule(jobid) from cron.job where jobname = 'reap-post-media-bytes';
select cron.schedule(
  'reap-post-media-bytes',
  '29 4 * * *',
  $$ select public.invoke_post_media_reaper() $$
);
