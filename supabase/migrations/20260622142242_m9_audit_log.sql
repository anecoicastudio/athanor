-- M9 Trust · audit_log (backend 06 §2.15, never built). Append-only moderation trail.
-- Written ONLY by the resolve_report DEFINER RPC (Task 2). No client INSERT/UPDATE/DELETE.
-- Read-gated to admins via athanor.is_admin() (Task 2). Rule #1: records penalty_points,
-- never writes aura_events (the engine applies the Aura penalty).

create table public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.reports (id) on delete cascade,
  actor_id       uuid not null references public.profiles (id), -- retained for integrity (no set null)
  action         text not null check (action in ('dismiss','warn','penalty','suspend','ban')),
  penalty_points integer check (penalty_points between -200 and -50),
  reason         text check (char_length(reason) <= 2000),
  created_at     timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only moderation audit. Written only by resolve_report (DEFINER). Admin-read only (athanor.is_admin). MVP actions: dismiss, penalty. Zero Aura (rule #1) — penalty_points is a record; the engine applies it.';

create index audit_log_report on public.audit_log (report_id, created_at desc);

-- Hosted auto-grants writes on new public tables → revoke all, then grant exactly.
revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;   -- gated by RLS policy (Task 2)
grant all on table public.audit_log to service_role;

alter table public.audit_log enable row level security;
-- NO client insert/update/delete policy (append-only; DEFINER RPC writes it).
-- Admin SELECT policy is created in the Task 2 migration (depends on athanor.is_admin()).
