-- M6 Aura · append-only ledger. One row per scoring action (and per decay tick).
-- Service-role write only — NEVER client-writable (PRD §4.9, rule #1). Owner reads own.
create table public.aura_events (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in (
                'identity_verified', 'event_attended', 'event_organized',
                'momento_conversation', 'milestone_help', 'own_milestone',
                'post_starred', 'report_upheld', 'decay'
              )),
  points      integer not null,
  ref_id      uuid,
  reason      jsonb,
  created_at  timestamptz not null default now()
  -- NO updated_at / deleted_at: append-only by rule (PRD §4.9).
);

comment on table public.aura_events is
  'Append-only Aura ledger — one row per scoring action. Service-role write only; never client-writable (PRD §4.9, rule #1).';

create index aura_events_feed on public.aura_events (profile_id, created_at desc, id desc);
create index aura_events_caps on public.aura_events (profile_id, type, created_at desc);
create unique index aura_events_idem on public.aura_events (profile_id, type, ref_id) where ref_id is not null;

-- privileges: members read own; anon nothing; engine (service role) writes
revoke all on table public.aura_events from anon, authenticated;
grant select on table public.aura_events to authenticated;
grant all on table public.aura_events to service_role;

alter table public.aura_events enable row level security;

create policy "aura_events_select_own"
  on public.aura_events for select
  to authenticated
  using ((select auth.uid()) = profile_id);
-- NO insert/update/delete policy: only the service role writes (bypasses RLS).
