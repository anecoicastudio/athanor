-- post_comments — a reply on a post (conversation, NOT a vanity score; PRD §4.5).
-- parent_id threads replies (null = top-level). Author CRUD own; members read live
-- comments on live posts. Emits the M6 +2 domain event; never writes aura (rule #1).

create table public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  parent_id  uuid references public.post_comments (id) on delete cascade,   -- reply thread (null = top-level)
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.post_comments is
  'A reply on a post (conversation, not a vanity score — PRD §4.5). parent_id threads replies. Author CRUD; members read. Emits the M6 +2 domain event; never writes aura (rule #1).';

create trigger post_comments_touch_updated_at
  before update on public.post_comments
  for each row execute function public.touch_updated_at();

create index post_comments_thread on public.post_comments (post_id, created_at desc, id desc) where deleted_at is null;
create index post_comments_parent on public.post_comments (parent_id) where deleted_at is null;

revoke all on table public.post_comments from anon;
grant select, insert, update on table public.post_comments to authenticated;
grant all on table public.post_comments to service_role;

alter table public.post_comments enable row level security;

-- members read live comments on live posts (the «{n} risposte» nav cue; frontend §1.0)
create policy "post_comments_select_authenticated"
  on public.post_comments for select
  to authenticated
  using (
    deleted_at is null
    and exists (select 1 from public.posts p where p.id = post_comments.post_id and p.deleted_at is null)
  );

create policy "post_comments_insert_own"
  on public.post_comments for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (select 1 from public.posts p where p.id = post_comments.post_id and p.deleted_at is null)
  );

create policy "post_comments_update_own"
  on public.post_comments for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);
-- no delete policy: author soft-deletes (deleted_at); hard erase = GDPR job (M9)

-- realtime: live append on an open post detail (client filters post_id=eq.<id>)
alter publication supabase_realtime add table public.post_comments;
