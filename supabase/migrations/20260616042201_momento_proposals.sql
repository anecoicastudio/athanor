-- M5 Momenti · swipe-deck-matcher slice — the nightly matcher's output.
-- Recipient reads OWN rows, flips ONLY status (accept/pass). affinity is server-only
-- (column-level SELECT grant excludes it). No client INSERT (matcher service-role writes).
-- Backend spec 05 §2.1; invariants 05 §7 #1–#3.

create type public.momento_status as enum ('pending', 'accepted', 'passed');

create table public.momento_proposals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade, -- recipient
  candidate_id  uuid not null references public.profiles (id) on delete cascade, -- proposed person
  reasons       text[] not null default '{}',           -- affinity strings, shown verbatim (PRD §4.7)
  affinity      numeric not null default 0,             -- score — NEVER returned to the client (col grant)
  status        public.momento_status not null default 'pending',
  proposed_on   date not null default (now() at time zone 'utc')::date, -- the day this counts vs the ≤3 cap
  passed_until  date,                                   -- proposed_on + 90 on pass (PRD §4.7); matcher reads it
  daily_rank    smallint not null default 1 check (daily_rank between 1 and 3),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.momento_proposals is
  'Momenti — nightly matcher proposes ≤3 people/user/day. Recipient reads own, flips only status. affinity is server-only.';

-- never propose the same candidate to the same recipient twice (PRD §4.7 dedupe)
create unique index momento_proposals_user_candidate_uniq
  on public.momento_proposals (user_id, candidate_id);

-- ≤3/day cap, ENFORCED IN SQL (invariant #1): a 4th row for a (user, day) collides on daily_rank.
create unique index momento_proposals_daily_cap
  on public.momento_proposals (user_id, proposed_on, daily_rank);

-- deck read path: own pending rows, newest rank first
create index momento_proposals_deck
  on public.momento_proposals (user_id, status, daily_rank);

create trigger momento_proposals_touch_updated_at
  before update on public.momento_proposals
  for each row execute function public.touch_updated_at();

-- Privileges — column-level grant is the immutability mechanism (invariants #2 & #3).
revoke all on table public.momento_proposals from anon;
-- SELECT excludes affinity → the client literally cannot reference it.
grant select (id, user_id, candidate_id, reasons, status, proposed_on, passed_until, daily_rank, created_at, updated_at)
  on table public.momento_proposals to authenticated;
-- UPDATE only the status column → candidate_id / reasons / affinity / daily_rank are immutable for clients.
grant update (status) on table public.momento_proposals to authenticated;
-- NO insert grant to authenticated — proposals are matcher-only (invariant #2).
grant all on table public.momento_proposals to service_role;

alter table public.momento_proposals enable row level security;

create policy "momento_proposals_select_own"
  on public.momento_proposals for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "momento_proposals_update_own"
  on public.momento_proposals for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- NO insert policy, NO delete policy: matcher (service_role) inserts; deletion via GDPR job.

-- Status-transition guard (WITH CHECK can't see OLD): pins legal moves + sets passed_until on pass.
create function public.guard_momento_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;                          -- idempotent / no-op
  end if;
  if old.status <> 'pending' then
    raise exception 'momento already %', old.status using errcode = 'check_violation';
  end if;
  if new.status not in ('accepted', 'passed') then
    raise exception 'illegal momento transition' using errcode = 'check_violation';
  end if;
  if new.status = 'passed' then
    new.passed_until := new.proposed_on + 90;   -- PRD §4.7: no re-propose for 90 days
  end if;
  return new;
end;
$$;

create trigger momento_proposals_guard_status
  before update on public.momento_proposals
  for each row execute function public.guard_momento_status_change();

-- accept_momento — the «Connetti ✦» path. Flips own pending row to accepted and reports whether
-- the reciprocal proposal is also accepted (mutual match). SECURITY DEFINER because the mutual check
-- must read the candidate's row, which the caller's RLS forbids (directed read). Returns conversation_id
-- = null in this slice; the conversations-chat slice will create the pair here (TODO below).
create function public.accept_momento(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_candidate uuid;
  v_status public.momento_status;
  v_matched boolean := false;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select candidate_id, status into v_candidate, v_status
    from public.momento_proposals
   where id = p_proposal_id and user_id = me
   for update;
  if not found then
    raise exception 'proposal not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'pending' then
    raise exception 'momento already %', v_status using errcode = 'check_violation';
  end if;

  update public.momento_proposals set status = 'accepted' where id = p_proposal_id;

  select exists (
    select 1 from public.momento_proposals p
     where p.user_id = v_candidate and p.candidate_id = me and p.status = 'accepted'
  ) into v_matched;

  -- TODO(m5-conversations-chat): if v_matched then
  --   perform public.create_conversation_pair(me, v_candidate, 'momento');  -- returns conversation_id
  -- The match overlay shows regardless; «Apri il Momento» stays a stub until that slice lands.
  return jsonb_build_object('matched', v_matched, 'conversation_id', null);
end;
$$;

revoke execute on function public.accept_momento(uuid) from public, anon;
grant  execute on function public.accept_momento(uuid) to authenticated;
