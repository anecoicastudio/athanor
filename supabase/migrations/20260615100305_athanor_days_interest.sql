-- athanor_days_interest — the "Avvisami della prossima edizione" registration on the
-- Vicino panel (frontend 04 §3.1.1). Owner inserts; idempotent per (user_id, edition)
-- with NULLS NOT DISTINCT (PG17) so re-tapping general interest is also a no-op.

create table public.athanor_days_interest (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  edition    text check (edition is null or char_length(edition) <= 80),
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id, edition)
);

comment on table public.athanor_days_interest is
  'Athanor Days "Avvisami" registrations (PRD §4.6, frontend 04 §3.1.1). Owner insert; idempotent per (user_id, edition).';

create index athanor_days_interest_by_edition on public.athanor_days_interest (edition);

revoke all on table public.athanor_days_interest from anon;
grant select, insert on table public.athanor_days_interest to authenticated;
grant all on table public.athanor_days_interest to service_role;

alter table public.athanor_days_interest enable row level security;

create policy "athanor_days_interest_select_own"
  on public.athanor_days_interest for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "athanor_days_interest_insert_own"
  on public.athanor_days_interest for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- no update/delete: interest is fire-and-forget.
