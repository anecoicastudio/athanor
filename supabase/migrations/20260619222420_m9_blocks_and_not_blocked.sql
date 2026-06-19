-- M9 Trust · blocks slice. The blocks table + the shared mutual-invisibility predicate
-- athanor.not_blocked (canonical home: backend 10 §2A.2), composed into the SELECT policy of
-- every person-attributable content table per the block-application matrix (10 §2A.2).
-- blocks is IMMUTABLE: no updated_at/deleted_at — unblock is a hard DELETE (06 §2.10).
-- Rule #1: blocks yield ZERO Aura — this migration writes no aura_events.

-- ── blocks table ────────────────────────────────────────────────────────────
create table public.blocks (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

comment on table public.blocks is
  'Blocker CRUD own (immutable: create/delete only). Mutual-invisibility enforced in the read policies of profiles/posts/post_comments/story_segments/momento_proposals/conversations/messages via athanor.not_blocked. pgTAP asserts both directions. Zero Aura (rule #1).';

create unique index blocks_pair on public.blocks (blocker_id, blocked_id);
create index blocks_blocked on public.blocks (blocked_id);  -- reverse lookup for the predicate

-- Exact grants (hosted auto-grants writes on new public tables → revoke all first, then grant exactly).
-- No UPDATE grant: a block is immutable.
revoke all on table public.blocks from anon, authenticated;
grant select, insert, delete on table public.blocks to authenticated;
grant all on table public.blocks to service_role;

alter table public.blocks enable row level security;

create policy "blocks_select_own"
  on public.blocks for select
  to authenticated
  using ((select auth.uid()) = blocker_id);

create policy "blocks_insert_own"
  on public.blocks for insert
  to authenticated
  with check ((select auth.uid()) = blocker_id);

create policy "blocks_delete_own"
  on public.blocks for delete
  to authenticated
  using ((select auth.uid()) = blocker_id);

-- ── athanor.not_blocked — the shared mutual-invisibility predicate (10 §2A.2) ──
-- SECURITY DEFINER: detects a block in EITHER direction without letting a blocked user learn
-- who blocked them (blocks keeps a blocker-only SELECT policy). Lives in the non-exposed athanor
-- schema; execute revoked from public/anon. Locked search_path; auth.uid() is schema-qualified.
create schema if not exists athanor;
grant usage on schema athanor to authenticated, service_role;

create or replace function athanor.not_blocked(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = other)
       or (b.blocker_id = other and b.blocked_id = (select auth.uid()))
  );
$$;

revoke execute on function athanor.not_blocked(uuid) from public, anon;
grant execute on function athanor.not_blocked(uuid) to authenticated;

-- ── compose into the SELECT policies of every person-attributable table ───────
-- profiles (the root of mutual invisibility). The anon public-@handle policy is untouched.
drop policy "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (athanor.not_blocked(id));

-- posts
drop policy "posts_select_authenticated" on public.posts;
create policy "posts_select_authenticated"
  on public.posts for select
  to authenticated
  using (deleted_at is null and athanor.not_blocked(author_id));

-- post_comments
drop policy "post_comments_select_authenticated" on public.post_comments;
create policy "post_comments_select_authenticated"
  on public.post_comments for select
  to authenticated
  using (
    deleted_at is null
    and athanor.not_blocked(author_id)
    and exists (select 1 from public.posts p where p.id = post_comments.post_id and p.deleted_at is null)
  );

-- story_segments (the TODO(M9) this migration closes)
drop policy "story_segments_select_live" on public.story_segments;
create policy "story_segments_select_live"
  on public.story_segments for select
  to authenticated
  using (
    deleted_at is null
    and (expires_at > now() or pinned)
    and athanor.not_blocked(author_id)
  );

-- momento_proposals (recipient reads own; hide proposals naming a blocked candidate)
drop policy "momento_proposals_select_own" on public.momento_proposals;
create policy "momento_proposals_select_own"
  on public.momento_proposals for select
  to authenticated
  using ((select auth.uid()) = user_id and athanor.not_blocked(candidate_id));

-- conversations (hide a thread with a blocked partner — either direction)
drop policy "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant" on public.conversations
  for select to authenticated
  using (
    (select auth.uid()) in (participant_a, participant_b)
    and athanor.not_blocked(
      case when (select auth.uid()) = participant_a then participant_b else participant_a end
    )
  );

-- messages (fold not_blocked into the conversation-membership check)
drop policy "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (select auth.uid()) in (c.participant_a, c.participant_b)
        and athanor.not_blocked(
          case when (select auth.uid()) = c.participant_a then c.participant_b else c.participant_a end
        )
    )
  );
