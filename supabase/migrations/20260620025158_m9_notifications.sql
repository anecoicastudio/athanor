-- M9 Trust — in-app notification center + per-type preferences.
-- notifications: SRW (service-role writes; recipient reads own + marks read_at only).
-- notification_preferences: OWN (owner CRUD). Master push toggle = profiles.push_enabled.

-- 1. notifications -----------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null
    check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone','projectResponse','connection')),
  template_key text not null,
  params jsonb not null default '{}'::jsonb,
  entity_ref jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'In-app notification center. Written ONLY by fan-out (service role). Recipient reads + marks read_at own. Realtime on recipient_id. Body is template_key + params (server-composed, 09). No vanity badge — presence dot only.';

create index notifications_recipient_feed
  on public.notifications (recipient_id, created_at desc, id desc);   -- cursor (rule #9)
create index notifications_recipient_unread
  on public.notifications (recipient_id) where read_at is null;       -- presence-dot query

revoke all on table public.notifications from anon;
grant select, update on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = recipient_id);

create policy "notifications_update_own_read"
  on public.notifications for update
  to authenticated
  using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id);

-- Narrow the client UPDATE to read_at only (column grant). A broad grant would let a client
-- rewrite template_key/params/type. RLS scopes rows; the column grant scopes columns.
-- NOTE: on hosted, new public tables auto-grant INSERT/DELETE to anon+authenticated via default
-- privileges; the companion migration 20260620025819_m9_notifications_revoke strips those so this
-- table is service-role-write only (clients keep SELECT + the column-narrowed UPDATE(read_at)).
revoke update on table public.notifications from authenticated;
grant update (read_at) on table public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;

-- 2. notification_preferences ------------------------------------------------
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null
    check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone','projectResponse','connection')),
  channel text not null check (channel in ('push','in_app')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, type, channel)
);

comment on table public.notification_preferences is
  'Per-type/channel notification opt-out. Owner CRUD own. Honored by push-dispatch (M5, 09).';

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

revoke all on table public.notification_preferences from anon;
grant select, insert, update on table public.notification_preferences to authenticated;
grant all on table public.notification_preferences to service_role;

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_select_own"
  on public.notification_preferences for select
  to authenticated using ((select auth.uid()) = profile_id);

create policy "notification_preferences_insert_own"
  on public.notification_preferences for insert
  to authenticated with check ((select auth.uid()) = profile_id);

create policy "notification_preferences_update_own"
  on public.notification_preferences for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- 3. master push toggle ------------------------------------------------------
-- profiles uses a COLUMN-SCOPED UPDATE grant for authenticated (m7_candidacy revoked table-level
-- UPDATE and re-granted a fixed column list excluding server-only cols like identity_verified).
-- This new column is NOT in that list, so the companion migration 20260620025819_m9_notifications_revoke
-- grants update(push_enabled) to authenticated — without it setPushEnabled would 42501. Default-on (09 §2.5).
alter table public.profiles add column push_enabled boolean not null default true;
comment on column public.profiles.push_enabled is
  'Master push toggle (M9 «Notifiche push»). push-dispatch checks this FIRST; false suppresses all push (in-app rows unaffected).';
