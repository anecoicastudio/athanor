-- projects — the Costellazioni board (PRD §4.5 / frontend 03 §3.6, M3). A directed
-- "search" — «Cerco videomaker / socio / investitore». Members-only: no anon, no
-- visibility column, no blocks predicate (blocks table = M9). Creating a project
-- emits the +4 domain event the M6 score-engine reads (backend 07); this migration
-- never writes aura (rule #1). No realtime publication (board uses refetch). terms
-- is inline copy only (paid / Tempo Bank) — the time economy is Fase 2.

create type public.project_category as enum ('startup', 'artistic', 'business', 'scientific', 'volunteer');
create type public.project_status   as enum ('open', 'closed');

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 140),
  category    public.project_category not null,
  description text not null default '' check (char_length(description) <= 4000),
  terms       text check (terms is null or char_length(terms) <= 500),
  status      public.project_status not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on table public.projects is
  'A Costellazioni search — «Cerco videomaker / socio / investitore» (PRD §4.5). Author CRUD; members read; cursor by category. Emits the +4 domain event for the M6 score-engine; never writes aura (rule #1). terms = inline paid/Tempo Bank copy (economy = Fase 2).';

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- keyset cursor (created_at desc, id desc); category-scoped variant; author lookup. Rule #9.
create index projects_board     on public.projects (created_at desc, id desc) where deleted_at is null;
create index projects_board_cat on public.projects (category, created_at desc, id desc) where deleted_at is null;
create index projects_author    on public.projects (author_id, created_at desc) where deleted_at is null;

-- privileges — members-only (no anon; board requires auth)
revoke all on table public.projects from anon;
grant select, insert, update on table public.projects to authenticated;
grant all on table public.projects to service_role;

alter table public.projects enable row level security;

-- SELECT: any member reads any live project (members-wide; no visibility/blocks yet)
create policy "projects_select_authenticated"
  on public.projects for select
  to authenticated
  using (deleted_at is null);

-- INSERT: only the author may create their own project
create policy "projects_insert_own"
  on public.projects for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

-- UPDATE: only the author (edit fields / open↔closed / soft-delete) — USING + WITH CHECK (rule #2)
create policy "projects_update_own"
  on public.projects for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

-- no delete policy: soft-delete is an owner update(deleted_at); hard erase = GDPR job (M9)
