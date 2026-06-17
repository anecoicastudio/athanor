-- push_tokens (M5): one row per (profile, device) Expo push token.
-- Owner-only RLS in every dimension; push-dispatch reads cross-user as service_role.
-- No deleted_at — device registration, not content; stale tokens are hard-deleted.
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token text not null check (char_length(token) between 1 and 512),
  platform text not null check (platform in ('ios', 'android')),
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_profile_token_unique unique (profile_id, token)
);

comment on table public.push_tokens is
  'Expo push tokens, one per member device. Owner-only RLS; the push-dispatch edge fn reads cross-user as service_role.';

create trigger push_tokens_touch_updated_at
  before update on public.push_tokens
  for each row execute function public.touch_updated_at();

create index push_tokens_profile_idx on public.push_tokens (profile_id);

-- privileges: members only, anon nothing
revoke all on table public.push_tokens from anon;
grant select, insert, update, delete on table public.push_tokens to authenticated;
grant all on table public.push_tokens to service_role;

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_own"
  on public.push_tokens for select
  to authenticated
  using ((select auth.uid()) = profile_id);

create policy "push_tokens_insert_own"
  on public.push_tokens for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

create policy "push_tokens_update_own"
  on public.push_tokens for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

create policy "push_tokens_delete_own"
  on public.push_tokens for delete
  to authenticated
  using ((select auth.uid()) = profile_id);
