-- #107: the erasure job runs nightly.
--
-- It has been deployed and unscheduled since M9 — deliberately, because a cron that marked
-- requests without erasing them would have been a misleading audit trail, and because the
-- retention question was open. Both reasons are gone: 20260908071656 lands the controller's
-- 2026-09-07 ruling (#184) and the job now reaches `done`. Article 17's one-month clock is what
-- this migration is actually for; a nightly pass answers it with 29 days to spare.
--
-- Same shape as every other pg_net caller here (invoke_score_engine_decay, #31's reaper,
-- invoke_post_media_reaper): the wrapper resolves url + key at CALL time through
-- athanor.runtime_setting (GUC first, else Vault) and presents the key on the `apikey` header via
-- athanor.edge_auth_headers. Never a literal in cron.job.command — a baked key does not follow a
-- rotation and needs an unschedule to replace — and never a hand-built Authorization bearer,
-- because an sb_secret_… key is not a JWT and the platform rejects it as one.
--
-- This migration creates NO secret. The operator creates the Vault pair per project
-- (deploy rider, docs/RELEASE-RUNBOOK.md §5):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/erasure-job',
--                              'app.settings.erasure_job_url');
--   select vault.create_secret('sb_secret_…', 'app.settings.erasure_job_key');
-- Until both exist the wrapper no-ops — the guard tests `is null` EXPLICITLY, because a bare
-- boolean test on a NULL setting is itself NULL and `if <null>` is false, so the guard would fall
-- open and post to nowhere every night. No error loop on a fresh CI stack, and none on a project
-- that has the migration before it has the rider.
--
-- ORDER MATTERS AT DEPLOY TIME, in both directions:
--   * 20260908071656 must be applied before the erasure-job build that calls its two RPCs is
--     deployed, or every request answers PGRST202 and lands on the terminal `failed` that nothing
--     re-queues — the same trap 20260827110034/`gdpr_storage_footprint` already carries in R-8.
--   * this migration must be applied AFTER that function deploy, or the first nightly pass hits
--     the old build. Applying it early is survivable (the wrapper no-ops until the Vault pair
--     exists) but do not rely on that.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_erasure_job() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := athanor.runtime_setting('erasure_job_url');
  v_key text := athanor.runtime_setting('erasure_job_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- erasure job not configured on this project → no-op
  end if;
  perform net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := '{}'::jsonb,
    -- 30 s, not the 5 s the pure-DB callers use: a pass claims up to 20 requests and each one
    -- walks the Storage API over seven buckets and then sweeps the KV namespace by prefix.
    timeout_milliseconds := 30000
  );
end;
$$;

comment on function public.invoke_erasure_job() is
  'Posts to the erasure-job edge function (#107) with the key from Vault on the apikey header. No-op until app.settings.erasure_job_url/_key exist. Called by the erasure-nightly cron job.';

revoke execute on function public.invoke_erasure_job() from public, anon, authenticated;

-- 03:47 UTC: clear of the 03:11/03:17/03:25 nightly cluster (momenti-matcher, aura-decay + the
-- story prune, gdpr-export) and of purge-waitlist at 04:00, so a slow pass overlaps nothing.
-- After gdpr-export-nightly on purpose: a member who requested an export and then an erasure gets
-- the archive built before the account it describes goes away.
--
-- Unschedule-if-present then schedule, so the migration replays cleanly from zero and is
-- re-runnable on a hosted project.
select cron.unschedule(jobid) from cron.job where jobname = 'erasure-nightly';
select cron.schedule(
  'erasure-nightly',
  '47 3 * * *',
  $$ select public.invoke_erasure_job() $$
);
