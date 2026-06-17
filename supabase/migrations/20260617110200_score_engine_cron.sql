-- M6 Aura · nightly decay sweep. Guarded — a no-op until app.settings.score_engine_url
-- / _key are set (deferred live deploy), so the cron never errors pre-config.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_score_engine_decay() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.score_engine_url', true);
  v_key text := current_setting('app.settings.score_engine_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- engine not configured (pre-deploy) → no-op
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('mode', 'decay'),
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function public.invoke_score_engine_decay() from public, anon, authenticated;

-- Nightly schedule (03:17 UTC, off-peak; mirrors the matcher / story-prune cadence).
select cron.schedule(
  'aura-nightly-decay',
  '17 3 * * *',
  $$ select public.invoke_score_engine_decay() $$
);
