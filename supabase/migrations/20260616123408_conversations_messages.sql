-- M5 conversations-chat: 1:1 conversations + messages + ice-breakers + realtime.
-- Backend ref: 05-schema-momenti.md §2.2/§2.3/§3/§5; CONTRACT-MATRIX M5.
-- Rules: #1 (no client Aura write — +5/+5 is M6), #2 (RLS deny-by-default + wrapped auth.uid),
-- #9 (keyset). SECURITY DEFINER fns lock search_path='' and revoke execute from clients (supabase.md).

-- ── enums ───────────────────────────────────────────────────────────────────
create type public.conversation_source as enum ('momento', 'direct');
create type public.message_kind as enum ('user', 'system', 'prompt');

-- ── conversations ───────────────────────────────────────────────────────────
-- last_message_at is NOT NULL default now() (refines spec; see plan note): a fresh match
-- sorts to the top and the (last_message_at, id) keyset stays non-null.
create table public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  participant_a        uuid not null references public.profiles (id) on delete cascade,
  participant_b        uuid not null references public.profiles (id) on delete cascade,
  created_from         public.conversation_source not null default 'momento',
  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint conversations_ordered_pair check (participant_a < participant_b)
);
comment on table public.conversations is
  '1:1 conversation. Server-created on mutual match or via get_or_create_conversation. Pair canonicalized (a < b).';

create unique index conversations_pair_uniq on public.conversations (participant_a, participant_b);
create index conversations_feed on public.conversations (last_message_at desc, id desc);

create trigger conversations_touch_updated_at
  before update on public.conversations
  for each row execute function public.touch_updated_at();

alter table public.conversations enable row level security;

create policy "conversations_select_participant" on public.conversations
  for select to authenticated
  using ((select auth.uid()) in (participant_a, participant_b));

create policy "conversations_update_participant" on public.conversations
  for update to authenticated
  using ((select auth.uid()) in (participant_a, participant_b))
  with check ((select auth.uid()) in (participant_a, participant_b));
-- NO insert policy (server-side creation only). NO delete (GDPR job, M9).

-- grants: members read + update only; NO insert (creation is server-side). The explicit
-- revoke-then-grant makes the grant set exact on hosted, where ALTER DEFAULT PRIVILEGES
-- otherwise auto-grants writes (a missing revoke → silent 0-row, not 42501).
revoke all on table public.conversations from anon, authenticated;
grant select, update on table public.conversations to authenticated;
grant all on table public.conversations to service_role;

-- ── messages ──────────────────────────────────────────────────────────────────
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid references public.profiles (id) on delete set null, -- NULL for system/prompt
  kind            public.message_kind not null default 'user',
  prompt_key      text,
  body            text,
  media_url       text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint messages_user_shape check (
    (kind = 'user'   and sender_id is not null and char_length(coalesce(body,'')) > 0) or
    (kind in ('system','prompt') and sender_id is null)
  ),
  -- F8 prompt_key coherence: user rows carry no key; prompt rows must; system may.
  constraint messages_prompt_key_shape check (
    (kind = 'user'   and prompt_key is null) or
    (kind = 'prompt' and prompt_key is not null) or
    (kind = 'system')
  )
);
comment on table public.messages is
  '1:1 chat messages. Clients insert only kind=user (sender=self). system/prompt ice-breakers are server-only.';

create index messages_thread on public.messages (conversation_id, created_at desc, id desc)
  where deleted_at is null;

alter table public.messages enable row level security;

create policy "messages_select_participant" on public.messages
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );

-- INVARIANT: client inserts ONLY kind='user', sender_id = self, into a conversation they're in.
create policy "messages_insert_own_user" on public.messages
  for insert to authenticated
  with check (
    kind = 'user'
    and sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );
-- NO update/delete policy (edits Fase 2; soft-delete = service role / GDPR job).

revoke all on table public.messages from anon, authenticated;
grant select, insert on table public.messages to authenticated;
grant all on table public.messages to service_role;

-- ── inject_ice_breakers ─────────────────────────────────────────────────────
-- 1 system banner + 3 prompts. prompt_key carries the i18n key (server stores the key,
-- never localized text → IT/EN parity in the app).
create function public.inject_ice_breakers(conv_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.messages (conversation_id, kind, prompt_key) values
    (conv_id, 'system', 'chat.system.iceBreaker'),
    (conv_id, 'prompt', 'chat.prompt.who'),
    (conv_id, 'prompt', 'chat.prompt.seek'),
    (conv_id, 'prompt', 'chat.prompt.dream');
end; $$;
revoke execute on function public.inject_ice_breakers(uuid) from public, anon, authenticated;

-- ── create_conversation_pair (idempotent; ice-breakers only for momento) ──────
create function public.create_conversation_pair(p1 uuid, p2 uuid, src public.conversation_source)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  lo uuid := least(p1, p2);
  hi uuid := greatest(p1, p2);
  conv_id uuid;
begin
  if lo = hi then
    raise exception 'cannot open a conversation with oneself' using errcode = 'check_violation';
  end if;
  insert into public.conversations (participant_a, participant_b, created_from)
    values (lo, hi, src)
  on conflict (participant_a, participant_b) do nothing
  returning id into conv_id;
  if conv_id is null then
    -- already existed; return it without re-injecting ice-breakers
    select id into conv_id from public.conversations where participant_a = lo and participant_b = hi;
    return conv_id;
  end if;
  -- Ice-breakers are the Momento ritual: seed only momento-born pairs (plan refinement #1).
  if src = 'momento' then
    perform public.inject_ice_breakers(conv_id);
  end if;
  return conv_id;
end; $$;
revoke execute on function public.create_conversation_pair(uuid, uuid, public.conversation_source)
  from public, anon, authenticated;

-- ── bump conversation on user message (preview + last_message_at) ─────────────
create function public.bump_conversation_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'user' then
    update public.conversations
      set last_message_at = new.created_at,
          last_message_preview = left(new.body, 140)
      where id = new.conversation_id;
  end if;
  return new;
end; $$;
revoke execute on function public.bump_conversation_on_message() from public, anon, authenticated;

create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function public.bump_conversation_on_message();

-- ── get_or_create_conversation RPC (the «Scrivi» path) ────────────────────────
create function public.get_or_create_conversation(peer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if peer_id = me then
    raise exception 'cannot open a conversation with oneself' using errcode = 'check_violation';
  end if;
  return public.create_conversation_pair(me, peer_id, 'direct');
end; $$;
revoke execute on function public.get_or_create_conversation(uuid) from public, anon;
grant  execute on function public.get_or_create_conversation(uuid) to authenticated;

-- ── wire accept_momento: create the conversation on mutual match ──────────────
-- accept_momento shipped in 20260616042201 (applied/frozen) returning conversation_id=null.
-- Re-define it to create the pair on match. `create or replace` preserves grants; re-assert
-- the authenticated execute grant defensively.
create or replace function public.accept_momento(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_candidate uuid;
  v_status public.momento_status;
  v_matched boolean := false;
  v_conversation_id uuid := null;
begin
  if me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select candidate_id, status into v_candidate, v_status
    from public.momento_proposals where id = p_proposal_id and user_id = me for update;
  if not found then raise exception 'proposal not found' using errcode = 'no_data_found'; end if;
  if v_status <> 'pending' then
    raise exception 'momento already %', v_status using errcode = 'check_violation';
  end if;
  update public.momento_proposals set status = 'accepted' where id = p_proposal_id;
  select exists (
    select 1 from public.momento_proposals p
     where p.user_id = v_candidate and p.candidate_id = me and p.status = 'accepted'
  ) into v_matched;
  if v_matched then
    v_conversation_id := public.create_conversation_pair(me, v_candidate, 'momento');
  end if;
  return jsonb_build_object('matched', v_matched, 'conversation_id', v_conversation_id);
end; $$;
grant execute on function public.accept_momento(uuid) to authenticated;

-- ── realtime: chat thread (C4) + conversation list (C5) — 09-realtime-push.md ──
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
