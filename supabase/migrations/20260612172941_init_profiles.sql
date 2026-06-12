-- Kaira M0: profiles 1:1 auth.users, RLS deny-by-default, auto-create trigger.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  bio text check (char_length(bio) <= 500),
  locale text not null default 'it' check (locale in ('it', 'en')),
  visibility jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Profilo Evolutivo — one row per member, auto-created on signup.';

-- updated_at touch trigger
create function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- auto-create profile on signup.
-- SECURITY DEFINER required: the trigger fires as supabase_auth_admin which
-- has no insert grant on public.profiles. Locked search_path; not a public API
-- (execute revoked below).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, locale)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'it')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Privileges: profiles are members-only — anon gets no table access at all.
-- Explicit grants make behavior identical across Supabase CLI versions
-- (newer versions stopped auto-granting to anon).
revoke all on table public.profiles from anon;
grant select, insert, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

-- RLS: deny by default, owner-only writes, members-wide reads (field-level
-- visibility enforcement lands at M1 with the public profile pages).
alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- no delete policy: erasure goes through the GDPR erasure job (service role)
