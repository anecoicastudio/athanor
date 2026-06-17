-- M7 countdown-edition: the annual fund edition (public heartbeat) + the live-ticker aggregate cache.
-- Backend spec 06 §2.1 + §2.3. Money/heartbeat tables: service-role write only (rule #6); fund = 0 Aura (rule #1).

-- ── fund_editions (PUB: anon+authenticated read, service-role write only) ──────────────
create table public.fund_editions (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  target_at timestamptz not null,                       -- countdown source of truth (server-authoritative)
  goal_cents bigint not null check (goal_cents > 0),
  phase text not null default 'community'
    check (phase in ('community','reputation','ethics','event','closed')),
  candidacy_window_open boolean not null default false,
  contributions_enabled boolean not null default false, -- ⚠ LEGAL FLAG: contributions gated until counsel clears (PRD §4.11)
  winner_candidacy_id uuid,                              -- forward ref to dream_candidacies; FK added in the M7 candidacy slice
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fund_editions is
  'Dai Vita al Tuo Sogno — one annual edition. Public heartbeat (read), service-role write only. contributions_enabled is the legal feature flag (PRD §4.11). winner_candidacy_id FK is added in the M7 candidacy slice.';

create unique index fund_editions_year_active
  on public.fund_editions (year) where phase <> 'closed';

create trigger fund_editions_touch_updated_at
  before update on public.fund_editions
  for each row execute function public.touch_updated_at();

grant select on table public.fund_editions to anon, authenticated;
grant all on table public.fund_editions to service_role;
-- hosted ALTER DEFAULT PRIVILEGES auto-grants writes to anon/authenticated → make a client write 42501, not silent RLS-0-row:
revoke insert, update, delete on table public.fund_editions from anon, authenticated;

alter table public.fund_editions enable row level security;

create policy "fund_editions_select_public"
  on public.fund_editions for select
  to anon, authenticated
  using (true);
-- no insert/update/delete client policy: admin writes as service_role (bypasses RLS).

-- ── fund_aggregates (PUB read, SRW write, realtime-published) ──────────────────────────
create table public.fund_aggregates (
  edition_id uuid primary key references public.fund_editions (id) on delete cascade,
  raised_cents bigint not null default 0 check (raised_cents >= 0),
  contributor_count bigint not null default 0 check (contributor_count >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.fund_aggregates is
  'Webhook-recomputed cache of raised total + contributor count per edition. Realtime-published (09). Service-role write only; public read (heartbeat). Writer ships in the M7 contributions slice.';

create trigger fund_aggregates_touch_updated_at
  before update on public.fund_aggregates
  for each row execute function public.touch_updated_at();

grant select on table public.fund_aggregates to anon, authenticated;
grant all on table public.fund_aggregates to service_role;
revoke insert, update, delete on table public.fund_aggregates from anon, authenticated;

alter table public.fund_aggregates enable row level security;

create policy "fund_aggregates_select_public"
  on public.fund_aggregates for select
  to anon, authenticated
  using (true);
-- no client write policy; the webhook recomputes as service_role.

-- Realtime: publish so the ticker updates on each webhook-driven change (09).
alter publication supabase_realtime add table public.fund_aggregates;
