-- M9 Trust — GDPR consent records (06 §2.13).
-- consent: OWN, owner CRUD-MINUS-DELETE (rows persist as an audit trail). One row per (profile_id, kind).
-- Kinds: comms (marketing-email opt-in), analytics (crash-report opt-in, 12 §9), location_approx
-- (coarse location, privacy-preserving default-on). The «dati non venduti» guarantee is
-- constitutional — it has NO row here (it is not a toggle; 09 §3.1/§3.5.3).

create table public.consent (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('comms','analytics','location_approx')),
  granted boolean not null,
  granted_at timestamptz not null default now(),
  source text not null check (source in ('signup','settings')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, kind)
);

comment on table public.consent is
  'GDPR consent records (comms/analytics/location_approx). Owner CRUD own (minus delete). The "data never sold" guarantee is constitutional — it has NO row (not a toggle).';

create trigger consent_touch_updated_at
  before update on public.consent
  for each row execute function public.touch_updated_at();

-- Grants + 10th hosted-revoke. On hosted Supabase, new public tables auto-grant
-- INSERT/UPDATE/DELETE to anon+authenticated via default privileges; RLS-only leaves a silent
-- 0-row write hole. consent is owner-CRUD-MINUS-DELETE → strip anon entirely, keep
-- select/insert/update for authenticated, and revoke the auto-granted DELETE (folded into this
-- same migration since the shape is known upfront).
revoke all on table public.consent from anon;
grant select, insert, update on table public.consent to authenticated;
revoke delete on table public.consent from authenticated;
grant all on table public.consent to service_role;

alter table public.consent enable row level security;

create policy "consent_select_own"
  on public.consent for select to authenticated
  using ((select auth.uid()) = profile_id);

create policy "consent_insert_own"
  on public.consent for insert to authenticated
  with check ((select auth.uid()) = profile_id);

create policy "consent_update_own"
  on public.consent for update to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);
