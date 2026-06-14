-- posts — the Community feed (PRD §4.5, M3). A "step" shared with members.
-- category = feed tab; is_step ties it to the dream journey. Members-only:
-- no anon, no visibility column, no blocks predicate (blocks table = M9).
-- Creating a post emits the +6 domain event the M6 score-engine reads (backend 07);
-- this migration never writes aura (rule #1). Media (post_media + bucket) = next slice;
-- post_type is declared in full now so that slice needs no enum-alter.

create type public.post_category as enum ('business', 'human', 'creative', 'evolution');
create type public.post_type     as enum ('text', 'image', 'video', 'audio');

create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  category   public.post_category not null,
  type       public.post_type     not null default 'text',
  body       text not null check (char_length(btrim(body)) between 1 and 5000),
  is_step    boolean not null default false,
  tags       text[] not null default '{}'::text[]
               check (array_length(tags, 1) is null or array_length(tags, 1) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.posts is
  'Community feed post — a step shared with members (PRD §4.5). category = feed tab; is_step ties it to the dream journey. Emits the +6 domain event for the M6 score-engine; never writes aura itself (rule #1). Members-only RLS; media = post_media (next slice).';
comment on column public.posts.is_step is 'True when the author frames this as a step of their dream journey, not a fleeting moment.';

create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

-- keyset cursor (created_at desc, id desc); category-scoped variant; author lookup. Rule #9.
create index posts_feed     on public.posts (created_at desc, id desc) where deleted_at is null;
create index posts_feed_cat on public.posts (category, created_at desc, id desc) where deleted_at is null;
create index posts_author   on public.posts (author_id, created_at desc) where deleted_at is null;

-- privileges — members-only (no anon; feed requires auth)
revoke all on table public.posts from anon;
grant select, insert, update on table public.posts to authenticated;
grant all on table public.posts to service_role;

alter table public.posts enable row level security;

-- SELECT: any member reads any live post (members-wide; no visibility/blocks yet)
create policy "posts_select_authenticated"
  on public.posts for select
  to authenticated
  using (deleted_at is null);

-- INSERT: only the author may create their own post
create policy "posts_insert_own"
  on public.posts for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

-- UPDATE: only the author (edit body / soft-delete) — USING + WITH CHECK
create policy "posts_update_own"
  on public.posts for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

-- no delete policy: soft-delete is an owner update(deleted_at); hard erase = GDPR job (M9)

-- realtime: feed "Nuovi passi ›" banner subscribes to INSERTs (client filters by category)
alter publication supabase_realtime add table public.posts;
