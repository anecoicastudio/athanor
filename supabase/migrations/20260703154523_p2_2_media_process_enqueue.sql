-- P2.2 — enqueue the media-process edge fn on every user-media upload (server-side
-- EXIF/GPS/metadata strip, backend 10 §4.1a / 11 §3.9a; closes the "server-side strip =
-- TODO before launch" flag in 20260614204500_storage_media_buckets.sql).
--
-- Pattern = 20260617083714_push_enqueue.sql: SECURITY DEFINER enqueue fn that reads
-- app.settings.media_process_url / _key GUCs and NO-OPS while they are unset — inert
-- until the P1.1 deploy, and an enqueue failure can never fail a user upload (the strip
-- is a backstop; the client already strips, apps/mobile/src/lib/media/process.ts).
--
-- Trigger fires on INSERT and on UPDATE OF version (a client upsert-overwrite bumps
-- storage.objects.version; unrelated row touches don't fire). The edge fn's own in-place
-- rewrite re-fires it once — the second invocation finds nothing left to strip and stops
-- (strip convergence, see supabase/functions/media-process/strip.ts). Covered buckets =
-- the four user-media buckets; avatars/events are future one-line WHEN extensions.
create extension if not exists pg_net;

create or replace function public.enqueue_media_process() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.media_process_url', true);
  v_key text := current_setting('app.settings.media_process_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return new; -- strip not configured (pre-deploy) → no-op, never block the upload
  end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('bucket_id', new.bucket_id, 'name', new.name),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- enqueue failure must never fail the upload (backstop, fail-open)
  end;
  return new;
end;
$$;
revoke execute on function public.enqueue_media_process() from public, anon, authenticated;

create trigger media_process_enqueue
  after insert or update of version on storage.objects
  for each row
  when (new.bucket_id in ('post-media', 'moments', 'story-segments', 'candidacy-videos'))
  execute function public.enqueue_media_process();
