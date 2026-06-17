-- M6 Aura · computed snapshot, one row per profile. The score is PUBLIC (PRD §4.9):
-- anon (web @handle) + authenticated read any row. Service-role write only (rule #1).
create table public.aura_scores (
  profile_id                uuid primary key references public.profiles (id) on delete cascade,
  score                     integer not null default 0 check (score between 0 and 1000),
  breakdown                 jsonb not null default jsonb_build_object(
                              'contributi', 0, 'eventi', 0, 'collaborazioni', 0,
                              'valore', 0, 'recensioni', 0, 'affidabilita', 0
                            ),
  peak_score                integer not null default 0 check (peak_score between 0 and 1000),
  last_qualifying_action_at timestamptz,
  computed_at               timestamptz not null default now()
);

comment on table public.aura_scores is
  'Computed Aura snapshot (0–1000 + six breakdown buckets). World-readable; service-role write only (rule #1).';

grant select on table public.aura_scores to anon, authenticated;
grant all on table public.aura_scores to service_role;

alter table public.aura_scores enable row level security;

create policy "aura_scores_select_anon"
  on public.aura_scores for select to anon using (true);
create policy "aura_scores_select_authenticated"
  on public.aura_scores for select to authenticated using (true);
-- NO insert/update/delete policy: engine-only.
