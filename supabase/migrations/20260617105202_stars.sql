-- M6 Aura · the six-star grants. granted_at null = tracked-but-unearned (own-profile
-- progress only); non-null = earned & world-visible. Service-role write only (rule #1).
create table public.stars (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  star_id     text not null check (star_id in (
                'visionario', 'creatore', 'mentor',
                'innovatore', 'collaboratore', 'ambasciatore'
              )),
  granted_at  timestamptz,
  progress    jsonb not null default jsonb_build_object('done', 0, 'total', 0, 'unit', ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.stars is
  'The six Aura stars — grant rows. granted_at null = tracked progress (own only); non-null = earned & world-visible. Service-role write only.';

create unique index stars_one_per_profile on public.stars (profile_id, star_id);

create trigger stars_touch_updated_at
  before update on public.stars
  for each row execute function public.touch_updated_at();

grant select on table public.stars to anon, authenticated;
grant all on table public.stars to service_role;

alter table public.stars enable row level security;

create policy "stars_select_own"
  on public.stars for select to authenticated
  using ((select auth.uid()) = profile_id);

create policy "stars_select_earned"
  on public.stars for select to authenticated
  using (granted_at is not null);

create policy "stars_select_earned_anon"
  on public.stars for select to anon
  using (granted_at is not null);
-- NO insert/update/delete policy: engine-only.
