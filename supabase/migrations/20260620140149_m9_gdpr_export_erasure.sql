-- M9 Trust — GDPR data-export jobs + erasure requests (06 §2.14, 10 §5.3/§5.4, 11 §3.9).
-- Both tables are GATED: the owner INSERTs a request pinned to status='requested' and READS own
-- status; the service-role backend jobs (gdpr-export-job / erasure-job) set later states. There is
-- NO client UPDATE or DELETE on either table — deletion of account data is exclusively the
-- service-role erasure cascade (10 §5.4 / 00 §4 "no client DELETE policy anywhere").
-- 11th hosted-revoke folded inline: on hosted, new public tables auto-grant I/U/D to
-- anon+authenticated via default privileges → revoke all, then re-grant select+insert only.

-- ── gdpr_export_jobs ────────────────────────────────────────────────────────
create table public.gdpr_export_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested','processing','ready')),
  download_url text,                              -- signed Storage URL (createSignedUrl), set by the backend job
  expires_at timestamptz check (expires_at <= created_at + interval '30 days'),  -- GDPR: ≤30d
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.gdpr_export_jobs is
  'GDPR data-export jobs. Owner requests + reads own status. Backend gdpr-export-job (11) sets processing/ready + signed download_url (expires ≤30d). No client status write.';

create index gdpr_export_jobs_profile_latest
  on public.gdpr_export_jobs (profile_id, created_at desc, id desc);

create trigger gdpr_export_jobs_touch_updated_at
  before update on public.gdpr_export_jobs
  for each row execute function public.touch_updated_at();

revoke all on table public.gdpr_export_jobs from anon, authenticated;
grant select, insert on table public.gdpr_export_jobs to authenticated;  -- no UPDATE/DELETE: backend sets status
grant all on table public.gdpr_export_jobs to service_role;

alter table public.gdpr_export_jobs enable row level security;

create policy "gdpr_export_jobs_select_own"
  on public.gdpr_export_jobs for select to authenticated
  using ((select auth.uid()) = profile_id);

-- INSERT a request only, pinned to status='requested' and no client-supplied url/expiry.
create policy "gdpr_export_jobs_insert_own"
  on public.gdpr_export_jobs for insert to authenticated
  with check (
    (select auth.uid()) = profile_id
    and status = 'requested'
    and download_url is null
    and expires_at is null
  );

-- ── gdpr_erasure_requests (spec-fill: mirrors export-jobs; the RLS-clean erasure enqueue) ─────
create table public.gdpr_erasure_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested','processing','done','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.gdpr_erasure_requests is
  'GDPR right-to-erasure requests (type-to-confirm in-app). Owner inserts a request + reads own status; the service-role erasure-job (11) performs the cascade honoring legal retention (10 §5.4). No client UPDATE/DELETE — deletion is exclusively the service-role path.';

create index gdpr_erasure_requests_profile_latest
  on public.gdpr_erasure_requests (profile_id, created_at desc, id desc);
create index gdpr_erasure_requests_pending
  on public.gdpr_erasure_requests (created_at) where status = 'requested';  -- job picks pending

create trigger gdpr_erasure_requests_touch_updated_at
  before update on public.gdpr_erasure_requests
  for each row execute function public.touch_updated_at();

revoke all on table public.gdpr_erasure_requests from anon, authenticated;
grant select, insert on table public.gdpr_erasure_requests to authenticated;  -- no UPDATE/DELETE
grant all on table public.gdpr_erasure_requests to service_role;

alter table public.gdpr_erasure_requests enable row level security;

create policy "gdpr_erasure_requests_select_own"
  on public.gdpr_erasure_requests for select to authenticated
  using ((select auth.uid()) = profile_id);

create policy "gdpr_erasure_requests_insert_own"
  on public.gdpr_erasure_requests for insert to authenticated
  with check ((select auth.uid()) = profile_id and status = 'requested');

-- ── exports bucket (private; download only via the service-role signed URL) ───────────────────
-- 06 §6: no public read, no client policies — the gdpr-export-job writes the archive as service_role
-- and hands back a time-limited signed URL. To cut off access, the job deletes the object.
insert into storage.buckets (id, name, public, file_size_limit)
values ('exports', 'exports', false, 104857600)
on conflict (id) do nothing;

-- ── email_waitlist retention/purge (MILESTONES note: wire a purge path before launch) ─────────
-- Non-exposed athanor schema + SECURITY DEFINER (reads auth.users to detect converted signups);
-- search_path='' and execute revoked from public/anon/authenticated (10 §3 SECURITY DEFINER discipline).
-- Deletes waitlist rows that (a) have converted to a registered account (email now in auth.users),
-- or (b) are older than the retention window. Scheduled via pg_cron at DEPLOY-TIME (not here).
create or replace function athanor.purge_email_waitlist(retention_days int default 540)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  with deleted as (
    delete from public.email_waitlist w
    where w.created_at < now() - make_interval(days => retention_days)
       or exists (select 1 from auth.users u where lower(u.email) = lower(w.email))
    returning 1
  )
  select count(*)::int into purged from deleted;
  return purged;
end;
$$;

comment on function athanor.purge_email_waitlist(int) is
  'Retention/purge for the pre-launch email_waitlist: drops converted (email now registered) + aged rows. Service-role / pg_cron only (scheduled at deploy-time). GDPR retention path for anon landing captures.';

revoke all on function athanor.purge_email_waitlist(int) from public, anon, authenticated;
grant execute on function athanor.purge_email_waitlist(int) to service_role;
