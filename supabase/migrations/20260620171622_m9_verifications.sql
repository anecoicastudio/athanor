-- M9 identity-verify slice: verifications cache (SRW) for Stripe Identity sessions.
-- Backend spec 06 §2.8, 08 §3.5/§4 (W9/W10), 09 C14 (verify-status realtime on profiles).
-- Written ONLY by stripe-webhook (service_role), which also flips profiles.identity_verified.
-- The +50 «Identity verified» Aura is the M6 score-engine's job (07) — NOT written here (rule #1).

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  stripe_session_id text not null unique,
  status text not null default 'pending'
    check (status in ('pending','verified','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.verifications is
  'Cache of Stripe Identity sessions. Written ONLY by stripe-webhook (service role), which also sets profiles.identity_verified. Owner reads own. +50 Aura is the M6 engine''s job (07), not written here (rule #1).';

create index verifications_profile_latest
  on public.verifications (profile_id, created_at desc, id desc);

create trigger verifications_touch_updated_at
  before update on public.verifications
  for each row execute function public.touch_updated_at();

-- Privilege lockdown. On hosted, new public tables auto-grant INSERT/UPDATE/DELETE to
-- anon+authenticated (ALTER DEFAULT PRIVILEGES) → RLS-only would yield silent 0-row, not 42501.
-- 12th hosted-revoke: strip ALL from both roles, re-grant SELECT to authenticated only.
revoke all on table public.verifications from anon, authenticated;
grant select on table public.verifications to authenticated;
grant all on table public.verifications to service_role;

alter table public.verifications enable row level security;

create policy "verifications_select_own"
  on public.verifications for select
  to authenticated
  using ((select auth.uid()) = profile_id);
-- No client write: stripe-webhook writes as service_role and flips profiles.identity_verified.

-- C14 (09): publish profiles so the app observes its own identity_verified flip.
-- RLS still filters delivery to rows the subscriber can SELECT; publication grants no write.
alter publication supabase_realtime add table public.profiles;
