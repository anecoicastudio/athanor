-- #239: fund_contributions.profile_id becomes NOT NULL — the contributor count becomes true.
--
-- D24 dropped anonymous contributions: create-contribution-session mints metadata.profile_id
-- from the verified caller (requireUser → getUser), so no legitimate Checkout session lacks it.
-- The nullable column survived from the pre-D24 shape (20260618153032 line 8, "anonymous
-- contributions allowed"), which let raised_cents (sum over ALL succeeded rows) and
-- contributor_count (count(distinct profile_id) — NULLs excluded by SQL semantics) describe
-- two different populations. With NOT NULL both aggregates describe the same set: every
-- counted cent belongs to a counted contributor.
--
-- No backfill: staging holds zero rows (verified 2026-08-15), production holds zero rows
-- (fund not launched). If this push ever fails on a NULL row, stop — do not delete money rows.

alter table public.fund_contributions
  alter column profile_id set not null;

-- ON DELETE SET NULL contradicts NOT NULL: a profiles delete would fail with a confusing
-- not-null violation (23502) while trying to detach the row. RESTRICT states the real rule —
-- money rows pin their contributor (matching the edition_id FK) — and fails honestly (23503).
-- The erasure path (D50, #184/#250) plans tombstone reassignment BEFORE profile deletion,
-- which RESTRICT is compatible with.
alter table public.fund_contributions
  drop constraint fund_contributions_profile_id_fkey,
  add constraint fund_contributions_profile_id_fkey
    foreign key (profile_id) references public.profiles (id) on delete restrict;

-- Same arithmetic as 20260618153032 — replaced only because that migration's line-57 comment
-- ("anon (null profile_id) excluded (MVP)") is now wrong and applied migrations are append-only,
-- so the correction lives here. count(distinct profile_id) over succeeded rows now counts every
-- row that raised_cents sums. Idempotent; SECURITY DEFINER + locked search_path preserved.
create or replace function public.recompute_fund_aggregate(p_edition_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fund_aggregates (edition_id, raised_cents, contributor_count, updated_at)
  select p_edition_id,
         coalesce(sum(amount_cents), 0),
         count(distinct profile_id),   -- profile_id NOT NULL → same population as raised_cents
         now()
  from public.fund_contributions
  where edition_id = p_edition_id and status = 'succeeded'
  on conflict (edition_id) do update
    set raised_cents = excluded.raised_cents,
        contributor_count = excluded.contributor_count,
        updated_at = now();
$$;

comment on function public.recompute_fund_aggregate(uuid) is
  'Recompute fund_aggregates from succeeded fund_contributions (rule #6 webhook cache). Service-role only.';

-- create or replace preserves ACLs; restated so this migration reads complete on its own.
revoke all on function public.recompute_fund_aggregate(uuid) from public, anon, authenticated;
grant execute on function public.recompute_fund_aggregate(uuid) to service_role;

comment on column public.fund_contributions.profile_id is
  'NOT NULL since #239 (D24: no anonymous contributions). Minted by create-contribution-session from the verified caller; stripe-webhook fails loud on a session without it.';
