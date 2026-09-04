-- Fund settle sweep (#248): a daily pg_cron caller for release-fund-payout's sweep mode.
--
-- The division of labour (ruling #244, #247's executor): the sweep decides WHEN to ask,
-- the executor decides WHETHER anything moves — the refusal ladder (unready account,
-- would-exceed, unsettled, and #231's reserved verification slot) lives in the edge
-- function, never here. This wrapper carries no eligibility logic at all: it posts
-- `{"mode":"sweep"}` and the function answers. Today that answer is zero due tranches BY
-- CONSTRUCTION — the enumeration source is #228/#229's realization-plan schema, which
-- does not exist yet, so the sweep is a deliberately inert skeleton that exercises the
-- cron→pg_net→edge-function path end to end without being able to move money.
--
-- CADENCE — daily, not hourly: eligibility here changes on settlement granularity.
-- Contributions arrive via SEPA-capable Checkout and settle in DAYS (rule 6's delayed-
-- methods note), and a tranche that misses today's pass goes out tomorrow — nothing is
-- time-critical inside a day. The push-receipt sweep is hourly because Expo expires its
-- receipts in ~a day; no such clock exists here. 04:41 UTC sits clear of the 03:11
-- matcher, the 03:17 nightlies and the :23 hourly.
--
-- Key handling (rule 8's cron half): the key resolves at CALL time through
-- athanor.runtime_setting (GUC first, else Vault) and travels on the `apikey` header via
-- athanor.edge_auth_headers — never a literal in cron.job.command (does not follow a
-- rotation), never a hand-built Authorization bearer (an sb_secret_… key is not a JWT).
-- This migration creates NO secret. The operator creates the Vault pair per project
-- (deploy rider, docs/RELEASE-RUNBOOK.md §5):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/release-fund-payout',
--                              'app.settings.release_fund_payout_url');
--   select vault.create_secret('sb_secret_…', 'app.settings.release_fund_payout_key');
-- Until both exist the wrapper no-ops (guard below tests `is null` explicitly — a bare
-- boolean test on a NULL setting would skip the guard, not take it), so the job never
-- error-loops on a project where the payout rail is not configured — which is every
-- fresh CI stack and production until the next release.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- SECURITY DEFINER to match every pg_net caller here (invoke_score_engine_decay,
-- invoke_push_receipt_sweep, the enqueue_* family): cron runs it as postgres either way,
-- and definer + locked search_path + revoked client EXECUTE is the audited shape those
-- wrappers established. (live_window_sweep is invoker because it does its own DML; this
-- one only posts HTTP.)
create or replace function public.invoke_fund_settle_sweep() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := athanor.runtime_setting('release_fund_payout_url');
  v_key text := athanor.runtime_setting('release_fund_payout_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- payout rail not configured (pre-deploy) → no-op
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: an
    -- sb_secret_… key is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object('mode', 'sweep'),
    timeout_milliseconds := 5000
  );
end;
$$;

comment on function public.invoke_fund_settle_sweep() is
  'Daily: asks release-fund-payout''s sweep mode to release any due payout tranches (#248). Inert until #228/#229 supply the tranche schema and #231 the verification gate — the edge function''s refusal ladder decides whether money moves, never this wrapper.';

revoke execute on function public.invoke_fund_settle_sweep() from public, anon, authenticated;

select cron.schedule(
  'fund-settle-sweep',
  '41 4 * * *',
  $$ select public.invoke_fund_settle_sweep() $$
);
