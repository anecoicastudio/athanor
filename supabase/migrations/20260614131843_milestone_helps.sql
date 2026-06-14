-- milestone_helps — a helper's offer against a tappa (skill/connection/opportunity).
-- Two writers, disjoint column rights: helper INSERTs (status forced 'offered'),
-- dream owner UPDATEs status only along legal edges. NO money (Fase 1, PRD §4.3).
-- status='completed' is the +40 helper event the M6 engine reads — NO client Aura write (rule #1).

create type public.help_type   as enum ('skill', 'connection', 'opportunity');  -- NO 'contribution' (Fase 1)
create type public.help_status as enum ('offered', 'accepted', 'declined', 'completed');

create table public.milestone_helps (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.dream_milestones (id) on delete cascade,
  helper_id uuid not null references public.profiles (id) on delete cascade,
  type public.help_type not null,
  message text check (message is null or char_length(message) <= 500),
  link text check (link is null or link ~ '^https?://'),
  status public.help_status not null default 'offered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (milestone_id, helper_id)        -- one offer per helper per tappa (PRD §4.3)
);

comment on table public.milestone_helps is
  'A helper''s offer against a tappa (skill/connection/opportunity — NO money, Fase 1). Helper inserts; dream owner transitions status. status->completed emits the +40 helper event (engine, 07).';

create trigger milestone_helps_touch_updated_at
  before update on public.milestone_helps
  for each row execute function public.touch_updated_at();

create index milestone_helps_by_milestone
  on public.milestone_helps (milestone_id, created_at desc, id desc) where deleted_at is null;
create index milestone_helps_by_helper
  on public.milestone_helps (helper_id, created_at desc, id desc) where deleted_at is null;

-- helper owns the milestone's parent dream? (one hop past owns_dream)
create function public.owns_help_milestone(p_milestone_id uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.dream_milestones m
    join public.dreams d on d.id = m.dream_id
    where m.id = p_milestone_id
      and d.profile_id = (select auth.uid())
  );
$$;
revoke execute on function public.owns_help_milestone(uuid) from public, anon;
grant execute on function public.owns_help_milestone(uuid) to authenticated;

revoke all on table public.milestone_helps from anon;     -- never anon (private negotiation)
grant select, insert, update on table public.milestone_helps to authenticated;
grant all on table public.milestone_helps to service_role;

alter table public.milestone_helps enable row level security;

-- SELECT: helper sees own offers; dream owner sees offers on their milestones
create policy "milestone_helps_select_party"
  on public.milestone_helps for select
  to authenticated
  using (
    deleted_at is null
    and (
      (select auth.uid()) = helper_id
      or public.owns_help_milestone(milestone_id)
    )
  );

-- INSERT: only the helper, as themselves, only status 'offered', not on own tappa
create policy "milestone_helps_insert_helper"
  on public.milestone_helps for insert
  to authenticated
  with check (
    (select auth.uid()) = helper_id
    and status = 'offered'
    and not public.owns_help_milestone(milestone_id)
  );

-- UPDATE: only the dream owner; column lockdown + legal transitions via the guard below
create policy "milestone_helps_update_owner"
  on public.milestone_helps for update
  to authenticated
  using (public.owns_help_milestone(milestone_id))
  with check (public.owns_help_milestone(milestone_id));
-- no helper UPDATE policy (no Fase 1 withdraw); no delete policy (soft-delete by service/GDPR)

-- Owner may change only `status`, only along offered->accepted|declined and accepted->completed.
create function public.milestone_helps_guard()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;  -- engine/service path unrestricted (detect, not authorize — rule #2 note)
  end if;
  if new.helper_id     is distinct from old.helper_id
     or new.milestone_id is distinct from old.milestone_id
     or new.type        is distinct from old.type
     or new.message     is distinct from old.message
     or new.link        is distinct from old.link then
    raise exception 'owner may change only status' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not (
         (old.status = 'offered'  and new.status in ('accepted', 'declined'))
      or (old.status = 'accepted' and new.status = 'completed')
    ) then
      raise exception 'illegal help status transition % -> %', old.status, new.status
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.milestone_helps_guard() from public, anon, authenticated;

create trigger milestone_helps_guard
  before update on public.milestone_helps
  for each row execute function public.milestone_helps_guard();
