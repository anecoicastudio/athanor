-- Story-segment bytes reaper (#31): the deletion half of the story-segment storage gap.
--
-- 20260809151111_story_segment_storage_expiry.sql (#21) HIDES an expired or soft-deleted
-- segment's object behind the storage SELECT policy; 20260614230935_prune_expired_stories.sql
-- soft-deletes the ROWS. Nothing removed the bytes, so every story ever posted stayed in the
-- `story-segments` bucket (up to 50 MB each, video by design), invisible to members, real for
-- storage cost, for retention accounting, and for anything holding service role.
--
-- ── Why an edge function and not a `delete from storage.objects` ───────────────────────────
--
-- The issue's first proposed shape — a pg_cron job deleting `storage.objects` rows — does not
-- free anything. Storage keeps only metadata in Postgres; the bytes live in the object store,
-- and the docs are explicit: "Deleting the metadata doesn't remove the object in the
-- underlying storage provider. This results in your object being inaccessible, but you'll
-- still be billed for it" (supabase.com/docs/guides/storage/schema/design). Deletion has to go
-- through the Storage API — the same conclusion 20260815131925 reached for candidacy videos,
-- which erasure-job removes via `storage.from().remove()`. So the split is:
--
--   • `story_segment_reap_candidates` (here, SQL)  — WHICH objects. Sits next to the SELECT
--     policy it inverts, so the two stay in step by construction and pgTAP 0126 can assert
--     the relationship directly (grace 0 ⇒ exactly the hidden set).
--   • `story-segment-reaper` (edge function)        — HOW. Lists through the RPC, deletes
--     through the Storage API in batches of ≤ 1000 (the API ceiling), re-lists each round.
--   • `prune_expired_story_segments()` (here)       — WHEN. The existing nightly job, extended
--     rather than duplicated: same name, same 03:17, row-side soft-delete first, then a pg_net
--     post to the reaper. One job, both halves.
--
-- ── The candidate predicate ────────────────────────────────────────────────────────────────
--
-- An object in `story-segments` is a candidate when no descriptor row for it was live or
-- pinned within the last `p_grace` (1 hour by default), and the object itself is older than
-- `p_grace`. Spelled out:
--
--   not exists (select 1 from story_segments s
--                where s.storage_path = o.name
--                  and coalesce(s.deleted_at, 'infinity') > now() - p_grace   -- not deleted, or only just
--                  and (s.pinned or s.expires_at > now() - p_grace))           -- pinned, or not expired, or only just
--
-- At p_grace = 0 this is `deleted_at is null and (pinned or expires_at > now())` negated —
-- the SELECT policy's descriptor predicate, inverted. The grace makes the reapable set a
-- strictly LATER subset of the hidden set: bytes go only for segments already invisible for
-- an hour. That margin is what carries the three cases the issue names:
--
--   pinned    — a pinned, undeleted row is live at any grace, so its object is never listed.
--               A pinned row the author soft-deleted IS reaped (after the grace), same as the
--               policy hides it: «un passo del percorso» survives the 24h, not a take-down.
--   in-flight — `useStoryUpload` writes the row first (#317), so a row whose upload is still
--               running is live and its object-to-be is not a candidate. The object-age term
--               covers the other order anyway: an object younger than the grace is never
--               listed, whatever its descriptor state, so a bytes-first writer (or a retry)
--               cannot lose an upload to a nightly pass that happens to overlap it.
--   staging   — `staging_refresh_world()` (hourly, :07) revives the seeded rows IN PLACE with
--               `expires_at = now() + 20h, deleted_at = null`; it never re-uploads bytes. A
--               seeded row is therefore live at every instant the refresh is running and its
--               object is never a candidate; and a row the refresh revives after a gap leaves
--               the candidate set the moment the update commits. 0126 asserts both.
--
-- The owner-folder regex and `athanor.not_blocked` from the SELECT policy are NOT mirrored,
-- on purpose: blocks are viewer-relative (a blocked author's live segment keeps its bytes for
-- everyone else), and a malformed key with no descriptor is garbage nobody can read — the
-- reaper removes it rather than keeping it because a regex would never have served it.
--
-- `o.created_at is null` (never written by storage-api, but nullable) evaluates the age term
-- to NULL → false: an object whose age cannot be established is never reaped. Conservative
-- by construction.
--
-- ── Key handling (rule 8's cron half) ──────────────────────────────────────────────────────
--
-- `invoke_story_segment_reaper()` resolves url/key at CALL time through
-- athanor.runtime_setting (GUC first, else Vault) and presents the key on the `apikey`
-- header via athanor.edge_auth_headers — never a literal in cron.job.command, never a
-- hand-built Authorization bearer (an sb_secret_… key is not a JWT). This migration creates
-- NO secret. The operator creates the Vault pair per project (deploy rider,
-- docs/RELEASE-RUNBOOK.md §5):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/story-segment-reaper',
--                              'app.settings.story_segment_reaper_url');
--   select vault.create_secret('sb_secret_…', 'app.settings.story_segment_reaper_key');
-- Until both exist the wrapper no-ops (the guard tests `is null` explicitly — a bare boolean
-- test on a NULL setting would skip the guard, not take it) and the nightly job keeps doing
-- exactly what it did before this migration: soft-delete rows. No error loop on a fresh CI
-- stack or on production before the rider runs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 1. WHICH: the candidate enumeration, service_role-only ─────────────────────────────────

-- SECURITY DEFINER because it reads storage.objects across every owner folder and joins a
-- table whose own policy would otherwise hide the expired rows from the predicate. The caller
-- is the reaper's service-role client (BYPASSRLS anyway) — definer + locked search_path +
-- revoked client EXECUTE is the audited shape of every cron/pg_net helper here. STABLE: it
-- reads, it never writes; the Storage API does the deleting.
create or replace function public.story_segment_reap_candidates(
  p_limit integer default 1000,
  p_grace interval default interval '1 hour'
) returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'story-segments'
     and o.created_at < now() - p_grace
     and not exists (
       select 1
         from public.story_segments s
        where s.storage_path = o.name
          and coalesce(s.deleted_at, 'infinity'::timestamptz) > now() - p_grace
          and (s.pinned or s.expires_at > now() - p_grace)
     )
   -- Oldest first: the backlog drains in the order it accumulated.
   order by o.created_at, o.name
   -- Clamped to the Storage API's per-call ceiling (1000) so the edge function can pass its
   -- batch size straight through, and to ≥ 1 so a zero never means "everything".
   limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

comment on function public.story_segment_reap_candidates(integer, interval) is
  'Objects in story-segments with no descriptor row live or pinned within p_grace (#31): the storage SELECT policy''s predicate inverted, with a margin. Oldest first, ≤ 1000. Read by the story-segment-reaper edge function (service role); the deletion itself goes through the Storage API, never this table.';

revoke execute on function public.story_segment_reap_candidates(integer, interval)
  from public, anon, authenticated;
grant execute on function public.story_segment_reap_candidates(integer, interval) to service_role;

-- ── 2. HOW it is reached: the pg_net caller ────────────────────────────────────────────────

-- SECURITY DEFINER to match every pg_net caller here (invoke_score_engine_decay,
-- invoke_push_receipt_sweep, invoke_fund_settle_sweep, the enqueue_* family): it only posts
-- HTTP, and definer + locked search_path + revoked client EXECUTE is their audited shape.
create or replace function public.invoke_story_segment_reaper() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := athanor.runtime_setting('story_segment_reaper_url');
  v_key text := athanor.runtime_setting('story_segment_reaper_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- reaper not configured (pre-deploy) → no-op; rows are still pruned below
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: an
    -- sb_secret_… key is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object('job', 'prune-expired-story-segments'),
    -- Longer than the 5 s the other callers use: a round deletes up to 1000 objects through
    -- the Storage API and the function answers only when its rounds are done.
    timeout_milliseconds := 30000
  );
end;
$$;

comment on function public.invoke_story_segment_reaper() is
  'Posts to the story-segment-reaper edge function (#31) with the key from Vault on the apikey header. No-op until app.settings.story_segment_reaper_url/_key exist. Called by prune_expired_story_segments() after the row-side soft-delete.';

revoke execute on function public.invoke_story_segment_reaper() from public, anon, authenticated;

-- ── 3. WHEN: the existing nightly job, extended ────────────────────────────────────────────

-- SECURITY INVOKER like live_window_sweep: it does its own DML, and cron runs it as postgres.
-- The UPDATE is 20260614230935's, verbatim — this migration changes nothing about which rows
-- are pruned or when; it only adds the second half after the first.
create or replace function public.prune_expired_story_segments() returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.story_segments
     set deleted_at = now()
   where deleted_at is null
     and pinned = false
     and expires_at <= now();

  -- pg_net queues the request and sends it after this transaction commits, so the reaper
  -- sees the rows soft-deleted above — though with the 1 h grace it reaps tonight the
  -- segments that EXPIRED before 02:17, and tomorrow the ones this pass just caught.
  perform public.invoke_story_segment_reaper();
end;
$$;

comment on function public.prune_expired_story_segments() is
  'Nightly (03:17): soft-deletes expired, unpinned story segments (rows), then asks the story-segment-reaper to free the bytes of everything hidden for over an hour (#31). Cron-only (postgres ctx).';

revoke execute on function public.prune_expired_story_segments() from public, anon, authenticated;

-- Same job name, same schedule; only the command changes from the inline UPDATE to the
-- wrapper. Unschedule-if-present then schedule, so the migration replays cleanly from zero
-- (where 20260614230935 created the job) and is re-runnable on a hosted project.
select cron.unschedule(jobid) from cron.job where jobname = 'prune-expired-story-segments';
select cron.schedule(
  'prune-expired-story-segments',
  '17 3 * * *',
  $$ select public.prune_expired_story_segments() $$
);
