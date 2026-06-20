-- M9 Trust · reports slice. Misconduct reports (backend 06 §2.9, frontend 09 §3.3).
-- Reporter INSERTs + reads OWN only — never another's report, never a verdict beyond own status.
-- NO client UPDATE/DELETE: status transitions are admin/service-role (web /admin, role from app_metadata).
-- The −50..−200 Aura penalty on an upheld report is the M6 score-engine's job (07), server-only.
-- Rule #1: reports yield ZERO Aura — this migration writes no aura_events.

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_type  text not null check (target_type in ('person','post','behavior')),
  target_id    uuid,                                  -- nullable for 'behavior' (no specific subject)
  category     text not null
    check (category in ('selling','income','mlm','harassment','spam','impersonation','other')),
  note         text check (char_length(note) <= 2000),
  status       text not null default 'open'
    check (status in ('open','reviewing','upheld','dismissed')),
  resolution   text,                                  -- admin-written
  reviewed_by  uuid references public.profiles (id) on delete set null,  -- admin
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.reports is
  'Misconduct reports. Reporter inserts + reads OWN only (never others, never verdict). No client UPDATE/DELETE — admin/service-role transitions status (web /admin, role from app_metadata). Upheld → −50..−200 Aura is M6 engine, server-only (07). Zero Aura (rule #1).';

create index reports_reporter_feed
  on public.reports (reporter_id, created_at desc, id desc);          -- cursor (own reports)
create index reports_admin_queue
  on public.reports (status, created_at) where status in ('open','reviewing');  -- admin queue (web /admin)

create trigger reports_touch_updated_at
  before update on public.reports
  for each row execute function public.touch_updated_at();

-- Exact grants (hosted auto-grants writes on new public tables → revoke all first, then grant exactly).
-- NO update/delete grant to authenticated: a reporter cannot change their report's verdict (06 §2.9).
revoke all on table public.reports from anon, authenticated;
grant select, insert on table public.reports to authenticated;
grant all on table public.reports to service_role;

alter table public.reports enable row level security;

-- READ own only — never another reporter's report, never beyond own status.
create policy "reports_select_own"
  on public.reports for select
  to authenticated
  using ((select auth.uid()) = reporter_id);

-- INSERT own, pinned to status='open' (you cannot file a pre-"upheld" report).
create policy "reports_insert_own"
  on public.reports for insert
  to authenticated
  with check ((select auth.uid()) = reporter_id and status = 'open');

-- NO client UPDATE/DELETE policy. Admin transitions status as service_role (web /admin, role from app_metadata).
