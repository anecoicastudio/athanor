-- M1 onboarding: identity answers on profiles + dreams table (PRD §4.1, §4.3).

alter table public.profiles
  add column identity_tags text[] not null default '{}',
  add column seeking text[] not null default '{}';

comment on column public.profiles.identity_tags is '«Chi sei?» — curated keys from @kaira/core';
comment on column public.profiles.seeking is '«Cosa cerchi?» — curated keys from @kaira/core';

create table public.dreams (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) <= 500),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.dreams is 'Il Sogno — one active per profile, history kept as archived rows.';

create trigger dreams_touch_updated_at
  before update on public.dreams
  for each row execute function public.touch_updated_at();

-- one active dream per profile
create unique index dreams_one_active
  on public.dreams (profile_id)
  where status = 'active' and deleted_at is null;

-- privileges: members only, anon nothing
revoke all on table public.dreams from anon;
grant select, insert, update on table public.dreams to authenticated;
grant all on table public.dreams to service_role;

-- RLS deny-by-default
alter table public.dreams enable row level security;

create policy "dreams_select_authenticated"
  on public.dreams for select
  to authenticated
  using (true);

create policy "dreams_insert_own"
  on public.dreams for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

create policy "dreams_update_own"
  on public.dreams for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- no delete policy: erasure via GDPR job (service role)
