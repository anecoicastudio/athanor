-- Conversation read state (#637 item 4) — the slice 20260616131952 named and deferred
-- ("A future read-state slice (conversation_reads) will introduce its own narrowly-scoped
-- policy + pgTAP").
--
-- Both unread layers already existed as UI with no source behind them: ConversationRow renders
-- the ✦ pip and lifts the preview out of `text-faint` on `unread`, and (modal)/messages.tsx fed
-- that from an in-session Set which was only ever `.delete()`d — never `.add()`ed, because
-- subscribeConversations' callback carries no payload. So the pip was dead code and a member had
-- no way anywhere in the app to learn that someone had replied, short of opening the thread.
--
-- Shape: one row per (member, conversation) holding when that member last read it. Unread is then
-- a comparison the LIST QUERY makes, not a fact any client asserts — which is why the realtime
-- callback's missing payload stops mattering: any change invalidates, the refetch recomputes.
--
-- NOT in #106's restrictive write net, deliberately, and for realization_plans' reason
-- (20260816101609 states the converse case): a read cursor is not a member speaking. Suspension
-- does not touch `messages_select_participant`, so a suspended member still reads their threads —
-- gating the marker would only pin their pips lit forever, telling nobody anything.
--
-- No `deleted_at`: this is not user content but a per-member cursor, in the family of
-- notification_preferences. Erasure travels the profile FK cascade.

-- ── 1. conversations.last_message_sender_id ──────────────────────────────────────────────────
-- The other half of "unread", and the half that is easy to leave out. Without it my own message
-- bumps last_message_at past my own last_read_at and my own thread reads unread until I re-open
-- it — the pip firing on my own words, on every send. With it the comparison can ignore my own
-- sends, so correctness does not depend on the client remembering to re-mark after a send.
alter table public.conversations
  add column last_message_sender_id uuid references public.profiles (id) on delete set null;

comment on column public.conversations.last_message_sender_id is
  'Author of the message that set last_message_at. Written only by bump_conversation_on_message. Lets the unread comparison ignore a member''s own sends.';

-- Backfill deliberately does NOT filter `deleted_at is null`: last_message_at / _preview are set
-- at INSERT and a later soft-delete never reverts them, so filtering here would pair a sender
-- with a timestamp from a different message. Mirror the trigger, including its blind spot.
update public.conversations c
   set last_message_sender_id = (
     select m.sender_id
       from public.messages m
      where m.conversation_id = c.id and m.kind = 'user'
      order by m.created_at desc, m.id desc
      limit 1
   );

-- ── 2. bump_conversation_on_message writes the sender ────────────────────────────────────────
-- Body otherwise identical to 20260827054252's (the '📷' preview fallback for a body-less
-- media message); SECURITY DEFINER + locked search_path as before.
create or replace function public.bump_conversation_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'user' then
    update public.conversations
      set last_message_at = new.created_at,
          last_message_preview = coalesce(
            left(nullif(new.body, ''), 140),
            case when new.media_url is not null then '📷' end),
          last_message_sender_id = new.sender_id
      where id = new.conversation_id;
  end if;
  return new;
end; $$;
revoke execute on function public.bump_conversation_on_message() from public, anon, authenticated;

-- ── 3. conversation_reads ────────────────────────────────────────────────────────────────────
create table public.conversation_reads (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- (profile_id, conversation_id) rather than the reverse: it is both the upsert conflict target
  -- and the index the list query wants, which reads one member's whole cursor set at a time.
  constraint conversation_reads_member_conv_uniq unique (profile_id, conversation_id)
);

comment on table public.conversation_reads is
  'Per-member read cursor on a conversation. Owner-written; unread is DERIVED (conversations.last_message_at > last_read_at and the last sender was someone else), never stored.';

create trigger conversation_reads_touch_updated_at
  before update on public.conversation_reads
  for each row execute function public.touch_updated_at();

alter table public.conversation_reads enable row level security;

create policy "conversation_reads_select_own" on public.conversation_reads
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- Membership is checked on INSERT and not on UPDATE: the row can only have been created by a
-- participant, and `profile_id` is pinned by both clauses, so an update cannot move a cursor onto
-- a conversation the caller was never in.
create policy "conversation_reads_insert_own" on public.conversation_reads
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_reads.conversation_id
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );

create policy "conversation_reads_update_own" on public.conversation_reads
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
-- NO delete policy and no DELETE grant: a read cursor is never withdrawn by hand, and erasure
-- reaches it through the profile FK cascade.

-- Explicit grants: since 20260816164834 a new table is unreachable by the client roles until its
-- own migration says otherwise (rules/supabase-db.md — the symptom of forgetting is a 42501 on a
-- screen whose policies look correct).
revoke all on table public.conversation_reads from anon, authenticated;
grant select, insert, update on table public.conversation_reads to authenticated;
grant all on table public.conversation_reads to service_role;
