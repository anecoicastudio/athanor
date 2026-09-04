-- 0136 — chat images (#155, migrations 20260827054252_chat_media_images and, for the key-shape
-- pin, 20260827092629_chat_media_key_shape_pin).
--
-- #575: the original migration's write gates were looser than the convention its own header
-- documented — a prefix LIKE on messages, path SEGMENTS only on the bucket — while
-- `packages/schemas` pinned the whole anchored three-segment `.jpg` key. Nothing was exposed
-- (the sender-folder and membership predicates are untouched) but the two mirrors disagreed, and
-- no test said so. The whole-key assertions below, and the five keys the prefix pin used to
-- accept, are that gap closed from the SQL side;
-- `packages/schemas/src/chat-media-key.mirror.test.ts` closes it from the TypeScript side by
-- comparing the two patterns as strings, which pgTAP alone cannot do.
--
-- Spec-first like 0014: the chat-media policy predicates are asserted from pg_policies (a
-- policy rewritten to `true` keeps its name), and the parts predicate text cannot prove —
-- who actually reads an object, what the messages insert policy actually rejects — are
-- asserted behaviourally under three JWTs.
--
-- Fixture topology: A and B share a momento conversation (AB); A and C share a direct
-- conversation (AC); C has blocked A. So B exercises the participant-read pass, C on AB the
-- non-participant deny, and the AC pair shows what a block does: the conversation row itself
-- disappears for both sides (not_blocked on conversations_select_participant, 20260619222420),
-- so the storage policy's membership EXISTS fails before its own not_blocked gate is reached.

begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'chatmedia_a@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'chatmedia_b@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'chatmedia_c@test.dev')
on conflict do nothing;
insert into public.profiles (id, handle) values
  ('11111111-1111-1111-1111-111111111111', 'chatmedia_a'),
  ('22222222-2222-2222-2222-222222222222', 'chatmedia_b'),
  ('33333333-3333-3333-3333-333333333333', 'chatmedia_c')
on conflict do nothing;

set local role service_role;
select set_config('test.conv_ab', public.create_conversation_pair(
  '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','momento')::text, true);
select set_config('test.conv_ac', public.create_conversation_pair(
  '11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','direct')::text, true);
reset role;

-- C blocks A: not_blocked is symmetric, so A's objects must vanish for C either way round.
insert into public.blocks (blocker_id, blocked_id)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');

-- Objects seeded as postgres (the storage API is not involved; the signed-URL path resolves to
-- exactly the SELECT the behavioural tests below issue). Real key layout:
-- {sender_uid}/{conversation_id}/{media_id}.jpg — plus one malformed key the uuid-shape guard
-- must hide without raising.
insert into storage.objects (bucket_id, name, owner_id)
select 'chat-media',
       '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
         || '/aaaaaaaa-0000-0000-0000-00000000000a.jpg',
       '11111111-1111-1111-1111-111111111111';
insert into storage.objects (bucket_id, name, owner_id)
select 'chat-media',
       '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ac')
         || '/bbbbbbbb-0000-0000-0000-00000000000b.jpg',
       '11111111-1111-1111-1111-111111111111';
insert into storage.objects (bucket_id, name, owner_id) values
  ('chat-media', 'not-a-uuid/also-not-a-uuid/x.jpg', '11111111-1111-1111-1111-111111111111');

-- ── bucket metadata ──────────────────────────────────────────────────────────────────
select is(
  (select public from storage.buckets where id = 'chat-media'),
  false,
  'chat-media bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'chat-media'),
  10485760::bigint,
  'chat-media file_size_limit = 10485760 (one processed JPEG, not a camera-roll original)'
);
-- Pinned as the WHOLE array (0014's #461 lesson): a mime added here without a product
-- decision is what this assertion exists to catch.
--
-- `image/jpeg` alone since the #582 ruling (2026-08-30, migration
-- 20260831*_chat_media_mime_jpeg_only): the bucket now agrees with the `.jpg`-only key pin
-- (#575), so the declared Content-Type and the object name can no longer disagree. The
-- question this comment used to leave open — does Storage serve the stored content-type or
-- infer one from the key name? — was answered by probe against hosted staging on
-- 2026-08-31: it serves the STORED type (PNG bytes under a `.jpg` key came back
-- `content-type: image/png` on both the direct GET and a signed URL). That made the old
-- three-mime allowlist a real mismatch rather than a cosmetic one, which is why it was
-- narrowed by ruling instead of left recorded. Widening again is a product decision; this
-- assertion is where it gets caught.
select is(
  (select allowed_mime_types from storage.buckets where id = 'chat-media'),
  array['image/jpeg'],
  'chat-media accepts exactly image/jpeg (#582)'
);

-- ── the policy set is exactly the four we own ────────────────────────────────────────
-- No delete policy, deliberately (20260827054252 §2): nothing consumes one, and it would let a
-- sender delete the bytes out from under a delivered message.
--
-- The fourth arrived with #574: `chat-media_select_reported` is the moderator's read of a
-- REPORTED object, and it is the one policy in this family that is not participant-scoped —
-- deliberately, because #97's ruling (2026-08-30) scopes the admin read to reported content
-- and a membership predicate would be the conversation-wide reach it forbids. Several
-- assertions below therefore had to learn the difference between "every chat-media policy" and
-- "every participant chat-media policy"; each says which it means and why.
select set_eq(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%' $$,
  $$ values ('chat-media_insert_own'), ('chat-media_update_own'),
            ('chat-media_select_participant'), ('chat-media_select_reported') $$,
  'exactly the four chat-media policies exist on storage.objects (no delete)'
);

-- ── spec assertions on the predicates (0014 patterns, scoped to chat-media) ──────────
select is_empty(
  $$ select policyname::text || ' -> ' || roles::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and roles <> '{authenticated}'::name[] $$,
  'every chat-media policy is TO authenticated only (never PUBLIC)'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and ( btrim(coalesce(qual, ''))       in ('true', '(true)')
           or btrim(coalesce(with_check, '')) in ('true', '(true)') ) $$,
  'no chat-media policy has a bare `true` predicate'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and coalesce(qual, '') || ' ' || coalesce(with_check, '')
            not like '%bucket_id = ''chat-media''%' $$,
  'every chat-media policy pins bucket_id to chat-media'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('chat-media_insert_own', 'chat-media_update_own')
        and not ( coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%auth.uid()%'
              and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%storage.foldername%' ) $$,
  'every chat-media owner-write policy binds auth.uid() to the first path segment'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and replace(replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                            '( SELECT auth.uid() AS uid)', 'WRAPPED'),
                    '(select auth.uid())', 'WRAPPED') like '%auth.uid()%' $$,
  'auth.uid() is always the wrapped (select auth.uid()) form'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and cmd = 'UPDATE'
        and (qual is null or with_check is null) $$,
  'the chat-media UPDATE policy carries both USING and WITH CHECK'
);
-- Every chat-media policy EXCEPT the reported-content arm must reach into public.conversations:
-- the membership EXISTS is what makes the bucket participant-scoped rather than members-wide,
-- which is the entire reason `moments` could not host these bytes.
--
-- The exclusion is named, not a wildcard, so a FIFTH policy cannot slip out of this assertion
-- by being new: anything not on this list still owes the membership predicate.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and policyname <> 'chat-media_select_reported'
        and coalesce(qual, '') || ' ' || coalesce(with_check, '')
            not like '%participant_a%' $$,
  'every participant chat-media policy carries the conversation-membership EXISTS'
);
-- …and the one exception pays for itself with a NARROWER gate, not with no gate. It is
-- admin-only and joined to a report that names the message this object belongs to, so an
-- object becomes readable only while some report points at it. Both halves asserted: an
-- admin-only policy with no report join would hand a moderator the whole bucket, and a report
-- join with no admin gate would hand every member the objects other people reported.
select ok(
  (select qual like '%is_admin%' and qual like '%reports%' and qual like '%target_type%'
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat-media_select_reported'),
  'the reported-content read is gated on BOTH is_admin() and a report naming the message'
);
-- The privacy line from #97's ruling, as a property of the predicate: this policy must not
-- mention the conversation at all. Reaching `conversations` here — even innocently, even as an
-- extra safety conjunct — is how "the reported message" becomes "the thread it came from".
select ok(
  (select qual not like '%participant_a%' and qual not like '%conversation%'
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat-media_select_reported'),
  'the reported-content read never mentions the conversation (reported content only, #97)'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'chat-media_select_participant'
        and ( qual not like '%not_blocked(((storage.foldername(name))[1])::uuid)%'
           or qual not like '%not_banned(((storage.foldername(name))[1])::uuid)%' ) $$,
  'the read policy gates on not_blocked AND not_banned of the owner-from-path'
);
-- Position, not mere presence (#575). Written as "contains a uuid class somewhere", this passed
-- for the write policies by accident once the whole-key regex arrived carrying the same
-- characters — the standalone `(storage.foldername(name))[2] ~* '^{uuid}$'` guards it was
-- written for were dropped, not added to, and it would have gone on passing if the
-- guard-before-cast property itself had regressed. What 20260808151808 established is an
-- ORDERING: the shape guard has to precede `::uuid` in the predicate, so a malformed key denies
-- instead of raising inside the clause. Assert that.
--
-- Scoped to the policies that actually CAST, which is what the property is about. #574's
-- reported-content arm parses no path at all — it compares the object's whole name to
-- `messages.media_url` — so it has no cast to raise inside and nothing to guard. Written as
-- "every policy must contain a uuid class", it would have failed a policy that is safe by
-- having no unsafe operation, which is the wrong shape of test. The `::uuid` predicate below
-- keeps the ordering requirement binding for every policy that does cast, new ones included.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and strpos(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '::uuid') > 0
        and not (
          strpos(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '[0-9a-f]{8}') > 0
          and strpos(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '[0-9a-f]{8}')
              < strpos(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '::uuid')
        ) $$,
  'every chat-media policy that casts uuid-shape-guards the key BEFORE the ::uuid cast (position, not presence)'
);

-- ── the whole-key pin (#575) ─────────────────────────────────────────────────────────
-- The guard above only says a uuid class appears somewhere. Until 20260827092629 that was
-- satisfied by segment guards alone, which is exactly what #575 found: `storage.foldername`
-- drops the LAST segment, so the filename was never looked at and the array was never length-
-- bounded — `{uid}/{conv}/sub/dir/anything` passed every write policy. `strpos`, not LIKE:
-- backslash is LIKE's default escape character, so `like '%\.jpg$%'` would quietly search for
-- `.jpg$` and pass on a policy that pins no extension at all.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('chat-media_insert_own', 'chat-media_update_own')
        and strpos(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '\.jpg$') = 0 $$,
  'both chat-media owner-write policies pin the WHOLE key, extension included (#575)'
);
-- Halves, separately. The assertion above concatenates qual and with_check, so it is satisfied by
-- an UPDATE policy that pins only its USING half — and that is the one arrangement that matters
-- here: the upsert-retry path is the only way a chat-media key can move, so a WITH CHECK without
-- the pin would let an existing object be renamed INTO a shape the insert path refuses.
select ok(
  (select strpos(qual, '\.jpg$') > 0 and strpos(with_check, '\.jpg$') > 0
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat-media_update_own'),
  'the chat-media UPDATE policy pins the whole key in BOTH halves, not just USING'
);
-- Case matters as much as shape. `packages/schemas` spells `[0-9a-f]` with no `i` flag, so a
-- `~*` here would accept an uppercase-hex key the client refuses — the same asymmetry #575 came
-- to close, reintroduced by one character.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('chat-media_insert_own', 'chat-media_update_own')
        and strpos(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '~* ') > 0 $$,
  'the owner-write shape pins are case-SENSITIVE (~, never ~*), matching the lowercase Zod class'
);
-- The read policy is NOT part of that pin, and its absence is a decision rather than an
-- oversight: tightening a read predicate retroactively hides bytes already stored, and a
-- filename tells a reader nothing that membership and not_blocked/not_banned do not decide.
-- Asserted so a later reader finds the reasoning attached to the fact.
select ok(
  (select strpos(qual, '\.jpg$') = 0 and strpos(qual, '~* ') > 0
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat-media_select_participant'),
  'the read policy still pins path SEGMENTS only — shape is enforced where a key is created'
);
-- On messages both halves must survive: the LIKE (rendered `~~`) is what binds the key to THIS
-- sender and THIS conversation, the regex only says what a key looks like. Dropping either one
-- passes the other's test.
select ok(
  (select strpos(with_check, '~~') > 0 and strpos(with_check, '\.jpg$') > 0
     from pg_policies
    where schemaname = 'public' and tablename = 'messages'
      and policyname = 'messages_insert_own_user'),
  'messages_insert_own_user keeps the sender/conversation prefix pin AND adds the shape pin'
);

-- ── the strip trigger covers the bucket ──────────────────────────────────────────────
select ok(
  (select pg_get_triggerdef(t.oid) like '%chat-media%'
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
      and t.tgname = 'media_process_enqueue'),
  'media_process_enqueue WHEN clause includes chat-media (EXIF/GPS strip, buckets.ts mirror)'
);

-- ── the push half of the '📷' fallback ───────────────────────────────────────────────
-- The glyph lives in TWO SECURITY DEFINER bodies (bump_conversation_on_message,
-- on_message_push). The preview half is asserted behaviourally below; the push half cannot
-- be — enqueue_push no-ops while the Vault pair is unset in CI — so pin the source: a later
-- migration recreating on_message_push (the #521 outbox TODO) that drops the fallback goes
-- red here instead of shipping a «marco:» push for every image-only message.
select ok(
  (select prosrc like '%📷%' and prosrc like '%nullif(new.body%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'on_message_push'),
  'on_message_push carries the image-only preview fallback (the glyph and the nullif)'
);

-- ── messages_user_shape v3 (server-side writes, constraint only) ─────────────────────
set local role service_role;
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', '', '') $$,
  '23514', null,
  'empty body AND empty-string media_url violates messages_user_shape (empty string is not media)'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, kind, prompt_key, media_url)
     values (current_setting('test.conv_ab')::uuid, 'prompt', 'chat.prompt.who',
             '11111111-1111-1111-1111-111111111111/x/y.jpg') $$,
  '23514', null,
  'a prompt row cannot carry media_url (system/prompt arm pins it null)'
);
reset role;

-- ── behaviour: the client write path (messages_insert_own_user) ──────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- image-only: legal since v3, media key in the sender's own folder for THIS conversation.
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/aaaaaaaa-0000-0000-0000-00000000000a.jpg') $$,
  'a participant sends an image-only message (media key in own folder, own conversation)'
);
-- one stored preview, two readers, two locales → it can only be author text or a pictograph.
select is(
  (select last_message_preview from public.conversations
    where id = current_setting('test.conv_ab')::uuid),
  '📷',
  'an image-only message previews as the camera pictograph'
);
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', 'guarda qui',
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/cccccccc-0000-0000-0000-00000000000c.jpg') $$,
  'a caption may ride the same row as the image'
);
select is(
  (select last_message_preview from public.conversations
    where id = current_setting('test.conv_ab')::uuid),
  'guarda qui',
  'when a caption exists, the caption is the preview'
);
-- the pre-#155 hole: media_url used to be client-writable free text.
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             'https://evil.example/x.jpg') $$,
  '42501', null,
  'media_url must be a key in the sender''s own folder — free text is refused'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '22222222-2222-2222-2222-222222222222/' || current_setting('test.conv_ab')
               || '/dddddddd-0000-0000-0000-00000000000d.jpg') $$,
  '42501', null,
  'a media key under another member''s uid folder is refused'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ac')
               || '/eeeeeeee-0000-0000-0000-00000000000e.jpg') $$,
  '42501', null,
  'a media key belonging to a DIFFERENT conversation is refused (no cross-thread reference)'
);

-- ── the five keys the prefix pin used to accept (#575) ────────────────────────────────
-- All five sit in the sender's own folder for this conversation, so the authorization half of
-- the predicate is satisfied by every one of them — which is the point. Before 20260827092629
-- `like '{sender}/{conversation}/%'` was the whole test and all five landed rows;
-- `messageInsertSchema` refused all five. Each is one way the two mirrors disagreed.
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab') || '/') $$,
  '42501', null,
  'the bare prefix is refused — LIKE''s % matches zero characters, so this used to pass'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/sub/ffffffff-0000-0000-0000-00000000000f.jpg') $$,
  '42501', null,
  'a deeper path under the right prefix is refused (the key is three segments, not at least two)'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/ffffffff-0000-0000-0000-00000000000f.png') $$,
  '42501', null,
  'another extension is refused — processImage re-encodes every pick to JPEG'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/not-a-uuid.jpg') $$,
  '42501', null,
  'a non-uuid media id is refused (the third segment is newMediaId(), not free text)'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body, media_url)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', null,
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/FFFFFFFF-0000-0000-0000-00000000000F.jpg') $$,
  '42501', null,
  'an uppercase-hex media id is refused — the pin is ~ and the class is lowercase-only'
);

-- a plain text message is exactly as legal as it was before v3.
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
     values (current_setting('test.conv_ab')::uuid,
             '11111111-1111-1111-1111-111111111111', 'user', 'solo testo') $$,
  'a text-only message is untouched by the media predicate'
);

-- ── behaviour: who reads the bytes ───────────────────────────────────────────────────
-- A: owner and participant of both conversations, but C blocked A — and
-- conversations_select_participant itself gates on not_blocked (20260619222420), so the
-- membership EXISTS in the storage policy, evaluated under A's RLS, cannot see conversation
-- AC at all. A reads the AB object only: the block hides the whole conversation from BOTH
-- sides, storage included, one layer above this policy's own not_blocked gate.
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name like '11111111-%'),
  1, 'the sender reads their chat-media object in the unblocked conversation (the blocked pair''s is hidden one layer up)'
);

-- B: participant of AB only.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name like '%' || current_setting('test.conv_ab') || '%'),
  1, 'the other participant reads the conversation''s image'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name like '%' || current_setting('test.conv_ac') || '%'),
  0, 'a member outside the conversation reads nothing (participant scope, not members-wide)'
);
select lives_ok(
  $$ select count(*) from storage.objects where bucket_id = 'chat-media' $$,
  'a malformed (non-uuid) path segment does not raise inside the USING clause'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name = 'not-a-uuid/also-not-a-uuid/x.jpg'),
  0, 'an object with malformed path segments is unreadable'
);

-- C: participant of AC, but C blocked A. Two independent layers now hide the object — the
-- conversation row itself (not_blocked on conversations_select_participant, 20260619222420)
-- and this policy's own not_blocked(owner) gate, spec-asserted above. Behaviour cannot say
-- which fired; that both exist is the point (the storage gate survives any future change to
-- the conversations policy).
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name like '%' || current_setting('test.conv_ac') || '%'),
  0, 'a block hides the counterpart''s chat image even inside a shared conversation'
);

-- ── behaviour: the bucket's own write gate (#575) ─────────────────────────────────────
-- Every object above was seeded as the owning role, i.e. with RLS bypassed, so nothing in this
-- file had ever exercised chat-media_insert_own. These three do, under A's JWT — the storage
-- half of the claim the messages assertions make, and the half the issue's title actually named.
-- `enqueue_media_process` (the EXIF/GPS strip enqueue) is SECURITY DEFINER, so the trigger these
-- inserts fire behaves the same under `authenticated` as under the seeding role.
-- Last in the file deliberately: a successful insert would move the object counts the read
-- assertions above depend on.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media',
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/99999999-0000-0000-0000-000000000099.jpg',
             '11111111-1111-1111-1111-111111111111') $$,
  'a participant uploads a well-shaped object into their own folder for the conversation'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media',
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/sub/dir/anything.exe',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'a deeper, arbitrarily-named object is refused — foldername() drops the filename, so this passed'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('chat-media',
             '11111111-1111-1111-1111-111111111111/' || current_setting('test.conv_ab')
               || '/99999999-0000-0000-0000-000000000098.png',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'another extension is refused on the bucket too, not only on the messages row'
);

reset role;

select * from finish();
rollback;
