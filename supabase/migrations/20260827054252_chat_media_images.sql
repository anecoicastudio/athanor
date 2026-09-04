-- #155 — chat images: messages.media_url has existed since 20260616123408 with nothing
-- writing or rendering it, and no bucket a private 1:1 image could safely live in. The
-- backend spec (05-schema-momenti.md §958) pointed it at `moments` with "owner-write,
-- participant-read" RLS — a policy that was never built: `moments_select_member` (and
-- `post-media`'s) are members-wide, so either bucket would expose a chat photo to every
-- member. This migration ships the server half the column always needed:
--
--   1. a `chat-media` bucket whose SELECT is scoped to the conversation's participants;
--   2. messages_user_shape v3 — an image-only user message becomes legal (body OR media);
--   3. messages_insert_own_user pins the media key to the sender's own folder for that
--      conversation, closing the hole where media_url was client-writable free text;
--   4. preview + push fallbacks for a body-less message;
--   5. the EXIF/GPS strip trigger learns the new bucket (buckets.ts moves in this commit;
--      media-process/buckets.test.ts asserts the two lists stay equal).
--
-- PRD §4.8 lists «Text + image v1» for chat, so no product-doc change rides along.

-- ── 1. bucket ────────────────────────────────────────────────────────────────────────────────
-- Images only: `message_kind` has no media vocabulary, the client composer offers photo/library
-- only (MediaSheet's default), and a chat video pipeline (posters, duration caps) is a feature
-- nobody has asked for. 10 MiB, not the media buckets' 50: a chat photo is one processed JPEG
-- (`processImage` re-encodes client-side), and half the avatar-bucket rationale applies — the
-- cap is what stops a camera-roll original being stored to be downscaled on every render.
-- Path convention: {sender_uid}/{conversation_id}/{media_id}.jpg — first segment is the owner
-- uid (what every owner-write policy and the not_blocked/not_banned read predicates key on),
-- second is the conversation (what participant-read keys on).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('chat-media', 'chat-media', false, 10485760,
     array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- ── 2. storage policies ──────────────────────────────────────────────────────────────────────
-- Owner-write requires BOTH segments to be honest: the first must be the caller, and the second
-- a conversation the caller is in — without the membership check a member could park bytes
-- under a conversation they can see the id of but were never part of, and the participant-read
-- policy below would then serve those bytes to its members.
create policy "chat-media_insert_own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );

-- UPDATE exists for the transport, not for editing: `processAndUpload` uploads with upsert, so
-- a retry after a half-failed attempt PUTs the same key again, and storage resolves that as an
-- update needing this policy. Same predicate both halves — the retry may not move the object.
create policy "chat-media_update_own" on storage.objects for update to authenticated
  using (
    bucket_id = 'chat-media'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  )
  with check (
    bucket_id = 'chat-media'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );

-- NO delete policy, deliberately breaking the four-policy symmetry of the other buckets:
-- nothing in the product consumes one (messages have no edit/delete, rules note in
-- 20260616123408), and what it would enable is a sender silently deleting the bytes out from
-- under an already-delivered message — the recipient's thread then renders «unavailable» with
-- no soft-delete row explaining why. Erasure/moderation delete via service role, which needs
-- no policy.
--
-- SELECT: the reader must be a participant of the path's conversation, and the OWNER must be
-- neither blocked-either-way nor banned — the same read-side hiding every other media bucket
-- carries (20260818114947). The uuid-shape guards run BEFORE the casts so a malformed key
-- denies instead of raising inside the USING clause (20260808151808's ordering).
create policy "chat-media_select_participant" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and athanor.not_blocked(((storage.foldername(name))[1])::uuid)
    and athanor.not_banned(((storage.foldername(name))[1])::uuid)
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );

-- ── 3. messages_user_shape v3 — image-only messages become legal ────────────────────────────
-- The decision #155 left open: image-only vs caption-required. Image-only wins — a photo IS the
-- message in every chat idiom, and a forced caption manufactures text the sender did not say.
-- A caption stays possible (body + media on one row). `char_length(coalesce(…)) > 0` on the
-- media half too, so an empty-string media_url cannot satisfy the constraint the way a NULL
-- check alone would allow.
-- The system/prompt arm additionally pins media_url null: every such row is server-authored
-- copy (ice-breakers) and none has ever carried media — state it so the constraint, not
-- convention, is what holds it.
-- #336's shape survives: a user row may still have a null sender (the deleted-member shape the
-- sender_id ON DELETE SET NULL action produces mid-erasure) — neither arm reads sender_id on
-- the user side.
alter table public.messages drop constraint messages_user_shape;
alter table public.messages add constraint messages_user_shape check (
  (kind = 'user'
     and (char_length(coalesce(body, '')) > 0 or char_length(coalesce(media_url, '')) > 0)) or
  (kind in ('system', 'prompt') and sender_id is null and media_url is null)
);

comment on constraint messages_user_shape on public.messages is
  '#155 (v3, was #336 v2): a user message needs a non-empty body OR a media key; system/prompt '
  'rows are senderless, mediaful never. A null sender on kind=user remains the deleted-member '
  'shape from sender_id ON DELETE SET NULL — messages_insert_own_user still forces sender = '
  'self on every client insert.';

-- media_url was born (20260616123408) with no comment and, until this migration, no shape: the
-- table-level INSERT grant plus a policy that never mentioned it made it client-writable free
-- text. Name what it now is.
comment on column public.messages.media_url is
  '#155: storage key in the chat-media bucket ({sender_uid}/{conversation_id}/{media_id}.jpg), '
  'never a URL. Clients render it via short-lived signed URLs. The insert policy pins a '
  'non-null value to the sender''s own folder for that conversation.';

-- ── 4. pin the client write path ────────────────────────────────────────────────────────────
-- Same name (pgTAP 0030 pins the policy list by name), wider predicate: a non-null media_url
-- must sit in the sender's own chat-media folder FOR THIS conversation. That closes the
-- pre-#155 hole (arbitrary text was accepted) and stops the cross-referencing move — pointing
-- a message at another conversation's object, which the participant-read storage policy would
-- then happily sign for this thread's members. It does not prove the object exists; a dangling
-- key renders as «unavailable», the same trust level post_media.storage_path lives at.
drop policy "messages_insert_own_user" on public.messages;
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
    and (
      media_url is null
      or media_url like ((select auth.uid())::text || '/' || conversation_id::text || '/%')
    )
  );

-- ── 5. conversation preview for a body-less message ─────────────────────────────────────────
-- last_message_preview is ONE stored value read by TWO members whose locales may differ, so it
-- cannot hold localized copy at all — it holds either the author's own words (same for both
-- readers) or something language-neutral. '📷' is a pictograph, not copy: the i18n rule (#5)
-- exists so no member reads a sentence their locale did not produce, and a camera glyph reads
-- the same in both catalogs' languages. A caption, when present, stays the preview.
-- Body unchanged otherwise; SECURITY DEFINER + locked search_path as before.
create or replace function public.bump_conversation_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'user' then
    update public.conversations
      set last_message_at = new.created_at,
          last_message_preview = coalesce(
            left(nullif(new.body, ''), 140),
            case when new.media_url is not null then '📷' end)
      where id = new.conversation_id;
  end if;
  return new;
end; $$;
revoke execute on function public.bump_conversation_on_message() from public, anon, authenticated;

-- ── 6. push preview for a body-less message ─────────────────────────────────────────────────
-- Same fallback, same reasoning — the push body composes as «{name}: {preview}» in the
-- dispatch mirror (_shared/notif-templates.ts), which previously rendered «marco:» for an
-- image-only row. Messages remain on public.enqueue_push (push transport only, no in-app
-- row) — that consolidation is #521's outbox territory, not this migration's.
create or replace function public.on_message_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_name text;
begin
  select case when c.participant_a = new.sender_id then c.participant_b else c.participant_a end
    into v_recipient
  from public.conversations c
  where c.id = new.conversation_id;
  if v_recipient is not null and new.kind = 'user' then
    select handle into v_name from public.profiles where id = new.sender_id;
    perform public.enqueue_push(
      v_recipient, 'message', 'notif.tpl.message',
      jsonb_build_object(
        'name', coalesce(v_name, ''),
        'preview', coalesce(
          left(nullif(new.body, ''), 140),
          case when new.media_url is not null then '📷' else '' end)),
      new.conversation_id::text);
  end if;
  return new;
end; $$;
revoke execute on function public.on_message_push() from public, anon, authenticated;

-- ── 7. server-side EXIF/GPS strip covers the new bucket ─────────────────────────────────────
-- Append-only rule: extending the WHEN clause means drop + recreate here, exactly as
-- 20260811072211 did for avatars. The function body is untouched. buckets.ts gains
-- 'chat-media' in this same commit; media-process/buckets.test.ts fails both ways otherwise.
-- A chat photo is the highest-stakes object this trigger covers: it is taken inside a private
-- 1:1 exchange, often indoors, straight off the camera — exactly the shot whose EXIF carries a
-- home GPS fix.
drop trigger if exists media_process_enqueue on storage.objects;
create trigger media_process_enqueue
  after insert or update of version on storage.objects
  for each row
  when (new.bucket_id in ('post-media', 'moments', 'story-segments', 'candidacy-videos', 'avatars', 'chat-media'))
  execute function public.enqueue_media_process();
