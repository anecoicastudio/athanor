-- Move the DB→edge-function credential from `Authorization: Bearer` to `apikey`.
--
-- The project migrated to Supabase's new API key system. A `sb_secret_…` key is NOT a JWT,
-- and the platform tries to parse an Authorization bearer as one — so once the
-- app.settings.*_key GUCs hold a secret key, every one of these calls would be rejected with
-- "Invalid JWT" before the function ran. New-style keys belong on `apikey`.
--
-- The header is built shape-adaptively rather than switched outright: while a GUC still holds
-- the legacy service_role JWT, both headers are sent (the gate reads `apikey` first, and a
-- legacy JWT on Authorization still parses); the moment a GUC holds an `sb_secret_…`,
-- Authorization is dropped. So reverting the GUC reverts the header shape by itself, with no
-- further migration — which is what makes the key cutover a one-command rollback.
--
-- `create or replace` preserves every trigger binding and grant (same pattern as
-- 20260701160235_m9_notification_producers.sql). Signatures, security definer, locked
-- search_path, and the revokes are all unchanged; only the headers argument differs.
--
-- NOT covered here: the operator-created `gdpr-export-nightly` cron job bakes its header into
-- cron.job.command, so it must be unscheduled and re-created by hand — a GUC change will not
-- move it. See docs/PRODUCTION-READINESS.md Appendix A.

-- Shared header builder: one place to get this right, five callers.
create or replace function athanor.edge_auth_headers(p_key text)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_key like 'sb\_secret\_%' then
      jsonb_build_object('Content-Type', 'application/json', 'apikey', p_key)
    else
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || p_key,
        'apikey', p_key
      )
  end;
$$;
revoke execute on function athanor.edge_auth_headers(text) from public, anon, authenticated;

-- ── 1. push-dispatch (M5) ────────────────────────────────────────────────────
create or replace function public.enqueue_push(
  p_recipient uuid,
  p_type text,
  p_template_key text,
  p_params jsonb,
  p_entity_ref text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.push_dispatch_url', true);
  v_key text := current_setting('app.settings.push_dispatch_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- push not configured (pre-deploy) → no-op, never block the insert
  end if;
  perform net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'recipient_id', p_recipient,
      'type', p_type,
      'template_key', p_template_key,
      'params', coalesce(p_params, '{}'::jsonb),
      'entity_ref', p_entity_ref
    )
  );
end;
$$;
revoke execute on function public.enqueue_push(uuid, text, text, jsonb, text) from public, anon, authenticated;

-- ── 2. score-engine nightly decay (M6) ───────────────────────────────────────
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
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object('mode', 'decay'),
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function public.invoke_score_engine_decay() from public, anon, authenticated;

-- ── 3. score-engine award from a moderation verdict (M9) ─────────────────────
create or replace function athanor.enqueue_score_award(
  p_profile uuid, p_type text, p_ref uuid, p_severity text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text := current_setting('app.settings.score_engine_url', true);
  v_key text := current_setting('app.settings.score_engine_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- engine not configured (pre-deploy) → no-op, never block the verdict
  end if;
  perform net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'mode','award','profileId',p_profile,'type',p_type,'refId',p_ref,
      'ctx', jsonb_build_object('severity', p_severity))
  );
end; $$;
revoke execute on function athanor.enqueue_score_award(uuid, text, uuid, text) from public, anon, authenticated;

-- ── 4. notification-fan-out (M9) ─────────────────────────────────────────────
create or replace function athanor.enqueue_notification(
  p_recipient uuid,
  p_type text,
  p_template_key text,
  p_params jsonb,
  p_entity_ref jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.notification_fanout_url', true);
  v_key text := current_setting('app.settings.notification_fanout_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- fan-out not configured (pre-deploy) → no-op, never block the source write
  end if;
  perform net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'recipient_id', p_recipient,
      'type', p_type,
      'template_key', p_template_key,
      'params', coalesce(p_params, '{}'::jsonb),
      'entity_ref', p_entity_ref
    )
  );
end;
$$;
revoke execute on function athanor.enqueue_notification(uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;

-- ── 5. media-process EXIF strip (P2.2) ───────────────────────────────────────
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
      headers := athanor.edge_auth_headers(v_key),
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
