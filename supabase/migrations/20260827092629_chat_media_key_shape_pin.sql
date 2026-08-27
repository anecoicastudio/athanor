-- #575 — the chat-media key shape is written down in two languages; only one of them pinned it.
--
-- 20260827054252 documented the convention in its own header ({sender_uid}/{conversation_id}/
-- {media_id}.jpg) and then enforced strictly less than that on every DB gate:
--
--   * `messages_insert_own_user` pinned `media_url like '{sender}/{conversation}/%'`. `%` matches
--     zero characters and any depth, so the bare prefix `{sender}/{conversation}/`, a second
--     nested folder, and a `.exe` all satisfied it.
--   * `chat-media_insert_own` / `_update_own` constrained `(storage.foldername(name))[1]` and
--     `[2]` only. `storage.foldername` drops the LAST segment, so the filename was never looked
--     at, and the array is not length-bounded — `{uid}/{conv}/sub/dir/anything` passed both.
--
-- `packages/schemas/src/message.ts` pinned the whole shape all along, anchored, lowercase-only,
-- `.jpg` only. No authorization was ever at risk: the sender-folder and conversation-membership
-- predicates carry that, and this migration does not touch them. What was at risk is the claim
-- that the two mirrors say the same thing — which is why the client refused keys the database
-- would have taken, and why nothing tested the difference.
--
-- The fix is one pattern, spelled identically in SQL and in TypeScript:
--
--   ^{uuid}/{uuid}/{uuid}\.jpg$
--
-- `packages/schemas/src/chat-media-key.mirror.test.ts` reads this file and asserts the literal
-- below is byte-for-byte `chatMediaKey.source`, so the two cannot drift again. That is exact
-- rather than approximate for two reasons: `standard_conforming_strings` is `on`, so `\.` here
-- is backslash-dot and not an escape, matching JS `'\\.'`; and POSIX `~` is case-SENSITIVE,
-- matching a `[0-9a-f]` class with no `i` flag. The old `~*` guards were not — an uppercase-hex
-- key passed SQL and failed Zod.
--
-- Not changed, deliberately: `chat-media_select_participant`. Pinning the shape on the READ side
-- would retroactively hide bytes that are already stored, and it adds nothing — a reader is
-- gated by conversation membership plus not_blocked/not_banned, none of which the filename
-- informs. Shape is enforced where a key is created. (Verified against staging before writing
-- this: zero `chat-media` objects and zero non-null `messages.media_url` rows exist, so no
-- stored row changes meaning either way.)
--
-- Append-only rule: 20260827054252 cannot be edited, so its §2 and §4 prose still describes the
-- prefix-only pin. This header is the correction; `supabase/tests/0136_chat_media.test.sql` is
-- the enforcement.

-- ── 1. messages_insert_own_user — the client write path ─────────────────────────────────────
-- Same name (0030's `policies_are` and 0121's grant derivation both key on it), same three
-- authorization predicates, one added conjunct.
--
-- The prefix LIKE stays alongside the regex rather than being folded into it. It is the
-- security-bearing half — it binds the key to THIS caller and THIS row's conversation, both
-- interpolated as `uuid::text` where neither `%` nor `_` can occur — and keeping it as a plain
-- comparison means a reviewer never has to reason about value-into-pattern interpolation to see
-- that the authorization holds. The regex adds shape only, and interpolates nothing.
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
      or (
        media_url like ((select auth.uid())::text || '/' || conversation_id::text || '/%')
        and media_url ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
      )
    )
  );

comment on column public.messages.media_url is
  '#155 (v2, #575): storage key in the chat-media bucket, exactly '
  '{sender_uid}/{conversation_id}/{media_id}.jpg with lowercase-hex uuid segments — never a URL. '
  'Clients render it via short-lived signed URLs. The insert policy pins a non-null value both '
  'to the sender''s own folder for that conversation and to that full shape; the chatMediaKey '
  'regex in packages/schemas spells the identical pattern.';

-- ── 2. chat-media owner-write policies ──────────────────────────────────────────────────────
-- The per-segment `[2] ~* '^{uuid}$'` guard is replaced by, not added to, the full-name pin: the
-- whole-key pattern already proves segment 2 is a lowercase uuid, so keeping both would leave
-- two guards disagreeing about case for no gain. The ordering property 20260827054252 §2 relied
-- on is preserved — the shape guard still sits ahead of `((storage.foldername(name))[2])::uuid`,
-- so a malformed key denies instead of raising inside the clause (20260808151808's ordering).
--
-- The `[1] = auth.uid()` equality stays a separate, explicit conjunct for the same reason the
-- messages LIKE does: it is the ownership check, and it should read as one.
drop policy "chat-media_insert_own" on storage.objects;
create policy "chat-media_insert_own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );

-- UPDATE is still the upsert-retry path, not an edit path (20260827054252 §2): same predicate in
-- both halves, so a retry may re-PUT the same key and may not move the object elsewhere.
drop policy "chat-media_update_own" on storage.objects;
create policy "chat-media_update_own" on storage.objects for update to authenticated
  using (
    bucket_id = 'chat-media'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  )
  with check (
    bucket_id = 'chat-media'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[2])::uuid
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );
