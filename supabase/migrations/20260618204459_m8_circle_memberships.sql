-- M8 Athanor Circle — subscription cache (SRW) + server-derived entitlements view.
-- circle_memberships is written ONLY by the stripe-webhook handler (service role).
-- Circle membership and founding_member award ZERO Aura and never affect ranking (rule #1).

create table public.circle_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  plan text not null check (plan in ('monthly','annual')),
  status text not null
    check (status in ('active','past_due','canceled','incomplete')),
  current_period_end timestamptz,
  founding_member boolean not null default false,        -- cosmetic only — NEVER a score input (rule #1)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.circle_memberships is
  'Cache of Stripe Billing subscription. Written ONLY by stripe-webhook (service role). Owner reads own. founding_member is cosmetic. Circle awards ZERO Aura and never affects ranking (rule #1).';

create trigger circle_memberships_touch_updated_at
  before update on public.circle_memberships
  for each row execute function public.touch_updated_at();

-- SRW: owner reads own; NO insert/update/delete grant to authenticated. Webhook writes as service_role.
revoke all on table public.circle_memberships from anon;
grant select on table public.circle_memberships to authenticated;
grant all on table public.circle_memberships to service_role;

alter table public.circle_memberships enable row level security;

create policy "circle_memberships_select_own"
  on public.circle_memberships for select
  to authenticated
  using ((select auth.uid()) = profile_id);
-- NO insert/update/delete client policy.

-- Server-derived entitlements: security_invoker → runs as caller → only the caller's own row is visible
-- (correct: entitlements are personal). Fase-1 features true for active/past_due members; Fase-2 false.
create view public.entitlements
with (security_invoker = true) as
  select
    p.id                                                   as profile_id,
    coalesce(m.status in ('active','past_due'), false)     as is_member,   -- past_due = grace (policy §9)
    m.plan,
    m.status,
    coalesce(m.founding_member, false)                     as founding,
    coalesce(m.status in ('active','past_due'), false)     as advanced_filters,
    coalesce(m.status in ('active','past_due'), false)     as premium_events,
    coalesce(m.status in ('active','past_due'), false)     as analytics,
    false                                                  as market_reduced_fee   -- Fase 2: declared, not live
  from public.profiles p
  left join public.circle_memberships m on m.profile_id = p.id
  where p.id = (select auth.uid());

grant select on public.entitlements to authenticated;
