-- remote_config: boot-time config / kill-switches (min app version, maintenance, feature flags).
-- NOT a domain table: PUBLIC read (anon + authenticated, read pre-auth at boot), service-role write ONLY.
-- Backs frontend 12 §10 (force-update / maintenance / feature flags). Backend 00 §7a. F9.

create table public.remote_config (
  key        text primary key,                  -- well-known key; text PK (the key IS the identity, no surrogate uuid)
  value      jsonb not null,                     -- payload; shape depends on key (guarded below)
  updated_at timestamptz not null default now(),
  -- value-shape guard: a fat-fingered service-role write to a boot kill-switch is an app-wide
  -- outage (the gate reads these pre-auth), so validate the well-known keys. A new well-known
  -- key with a different shape extends this CHECK in a NEW migration (append-only).
  constraint remote_config_value_shape check (
    case key
      when 'min_app_version'  then value ? 'ios' and value ? 'android'
                                   and jsonb_typeof(value -> 'ios') = 'string'
                                   and jsonb_typeof(value -> 'android') = 'string'
      when 'maintenance_mode' then value ? 'enabled'
                                   and jsonb_typeof(value -> 'enabled') = 'boolean'
      else value ? 'enabled'                       -- feature-flag keys: { "enabled": bool, ... }
                                   and jsonb_typeof(value -> 'enabled') = 'boolean'
    end
  )
);

comment on table public.remote_config is
  'Boot-time remote config / kill-switches (min app version, maintenance, feature flags). PUBLIC read (anon+authenticated, read pre-auth at boot). Service-role write only — no client write path. Backs frontend 12 §10.';

create trigger remote_config_touch_updated_at
  before update on public.remote_config
  for each row execute function public.touch_updated_at();

-- PUBLIC read (the app reads it before auth — anon must SELECT); nobody writes but service_role.
grant select on table public.remote_config to anon, authenticated;
grant all    on table public.remote_config to service_role;

-- HOSTED default-privilege trap (13th instance): new public tables auto-grant write to anon/
-- authenticated on the hosted project, turning a client write into a silent 0-row instead of 42501.
-- Revoke explicitly so a client INSERT/UPDATE/DELETE is permission-denied (42501), as pgTAP asserts.
revoke insert, update, delete on table public.remote_config from anon, authenticated;

alter table public.remote_config enable row level security;

create policy "remote_config_select_public"
  on public.remote_config for select
  to anon, authenticated
  using (true);
-- NO insert/update/delete policy: the team writes as service_role (bypasses RLS); the revoke above
-- makes the absence a hard 42501, not a silent RLS filter.
