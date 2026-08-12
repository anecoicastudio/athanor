-- Edge-function URLs + secret keys move from `app.settings.*` GUCs to Supabase Vault.
--
-- WHY: on Supabase projects as they are provisioned today, `alter database … set` and
-- `alter role … set` are BOTH rejected for any custom parameter — supautils allows only the
-- fixed list in `supautils.privileged_role_allowed_configs` (pgrst.*, pgaudit.*, log_*, …),
-- and no `app.settings.*`/`athanor.*` name is on it. Verified on kwzeiqvrnnaagccyoose:
--   alter database postgres set "app.settings.probe" = 'x';
--   → ERROR 42501: permission denied to set parameter "app.settings.probe"
-- The database IS owned by `postgres`, so this is a parameter-class refusal, not ownership.
-- Consequence: every `current_setting('app.settings.<x>', true)` in the pg_net callers has
-- always read NULL on a hosted project, and each caller's "not configured → no-op" guard
-- turned that into silence. score-engine, push-dispatch, notification-fan-out and
-- media-process were therefore unreachable from the database.
--
-- The replacement is `athanor.runtime_setting(name)`: the GUC first (so a local
-- `supabase start`, where GUCs DO work, and any pgTAP test that sets one, keep working
-- unchanged), else the Vault secret of the same name. Vault is encrypted at rest and
-- `vault.decrypted_secrets` is granted to `postgres`/`service_role` ONLY — never to
-- `anon`/`authenticated` — so a secret key stays unreachable from any client, which a
-- role-level GUC could not have guaranteed (`pg_db_role_setting` is world-readable).
--
-- Secret VALUES are set by the operator per project and are not in this file (rule #8):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/score-engine',
--                              'app.settings.score_engine_url');
--   select vault.create_secret('sb_secret_…', 'app.settings.score_engine_key');
-- …for the four url/key pairs: score_engine, push_dispatch, notification_fanout,
-- media_process. Re-running is `vault.update_secret(id, …)`; names are unique.
--
-- The seven function bodies below are the live definitions, unchanged except that the two
-- `current_setting('app.settings.…', true)` initialisers became `athanor.runtime_setting(…)`.

create or replace function athanor.runtime_setting(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := nullif(current_setting('app.settings.' || p_name, true), '');
begin
  if v is not null then
    return v;                       -- GUC wins: local stack + pgTAP set_config keep working
  end if;
  begin
    execute 'select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1 limit 1'
      into v using 'app.settings.' || p_name;
  exception when others then
    v := null;                      -- no vault on this stack → same as unconfigured, never raise
  end;
  return v;
end;
$$;

comment on function athanor.runtime_setting(text) is
  'Resolves an edge-function URL/key: app.settings.<name> GUC first, else the Vault secret of that name. SECURITY DEFINER because vault.decrypted_secrets is readable only by postgres/service_role.';

revoke all on function athanor.runtime_setting(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION athanor.enqueue_notification(p_recipient uuid, p_type text, p_template_key text, p_params jsonb, p_entity_ref jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text := athanor.runtime_setting('notification_fanout_url');
  v_key text := athanor.runtime_setting('notification_fanout_key');
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
$function$;

CREATE OR REPLACE FUNCTION athanor.enqueue_score_award(p_profile uuid, p_type text, p_ref uuid, p_severity text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text := athanor.runtime_setting('score_engine_url');
  v_key text := athanor.runtime_setting('score_engine_key');
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
end; $function$;

CREATE OR REPLACE FUNCTION athanor.enqueue_score_award(p_profile uuid, p_type text, p_ref uuid, p_severity text, p_counterparty uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text := athanor.runtime_setting('score_engine_url');
  v_key text := athanor.runtime_setting('score_engine_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- engine not configured (pre-deploy) → no-op, never block the write
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: a new-style
    -- sb_secret_… key is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'mode','award','profileId',p_profile,'type',p_type,'refId',p_ref,
      'counterpartyId', p_counterparty,
      'ctx', jsonb_build_object('severity', p_severity))
  );
end; $function$;

CREATE OR REPLACE FUNCTION athanor.enqueue_score_award(p_profile uuid, p_type text, p_ref uuid, p_severity text, p_counterparty uuid, p_reviewer_score integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text := athanor.runtime_setting('score_engine_url');
  v_key text := athanor.runtime_setting('score_engine_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- engine not configured (pre-deploy) → no-op, never block the write
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: a new-style
    -- sb_secret_… key is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'mode','award','profileId',p_profile,'type',p_type,'refId',p_ref,
      'counterpartyId', p_counterparty,
      'ctx', jsonb_build_object('severity', p_severity, 'reviewerScore', p_reviewer_score))
  );
end; $function$;

CREATE OR REPLACE FUNCTION public.enqueue_media_process()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text := athanor.runtime_setting('media_process_url');
  v_key text := athanor.runtime_setting('media_process_key');
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_push(p_recipient uuid, p_type text, p_template_key text, p_params jsonb, p_entity_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text := athanor.runtime_setting('push_dispatch_url');
  v_key text := athanor.runtime_setting('push_dispatch_key');
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
$function$;

CREATE OR REPLACE FUNCTION public.invoke_score_engine_decay()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text := athanor.runtime_setting('score_engine_url');
  v_key text := athanor.runtime_setting('score_engine_key');
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
$function$;

