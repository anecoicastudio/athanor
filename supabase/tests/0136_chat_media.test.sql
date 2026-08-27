-- 0136 — chat images (#155, migration 20260827054252_chat_media_images).
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
select plan(30);

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
-- Pinned as the WHOLE array (0014's #461 lesson): images only, no video, no audio — a mime
-- added here without a product decision is what this assertion exists to catch.
select is(
  (select allowed_mime_types from storage.buckets where id = 'chat-media'),
  array['image/jpeg','image/png','image/webp'],
  'chat-media accepts exactly image/jpeg, image/png, image/webp'
);

-- ── the policy set is exactly the three we own ───────────────────────────────────────
-- No delete policy, deliberately (migration §2): nothing consumes one, and it would let a
-- sender delete the bytes out from under a delivered message.
select set_eq(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%' $$,
  $$ values ('chat-media_insert_own'), ('chat-media_update_own'),
            ('chat-media_select_participant') $$,
  'exactly the three chat-media policies exist on storage.objects (no delete)'
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
-- Every chat-media policy — reads AND writes — must reach into public.conversations: the
-- membership EXISTS is what makes the bucket participant-scoped rather than members-wide,
-- which is the entire reason `moments` could not host these bytes.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and coalesce(qual, '') || ' ' || coalesce(with_check, '')
            not like '%participant_a%' $$,
  'every chat-media policy carries the conversation-membership EXISTS'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'chat-media_select_participant'
        and ( qual not like '%not_blocked(((storage.foldername(name))[1])::uuid)%'
           or qual not like '%not_banned(((storage.foldername(name))[1])::uuid)%' ) $$,
  'the read policy gates on not_blocked AND not_banned of the owner-from-path'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'chat-media\_%'
        and coalesce(qual, '') || ' ' || coalesce(with_check, '')
            not like '%[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}%' $$,
  'every chat-media policy uuid-shape-guards the path segments before casting'
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

reset role;

select * from finish();
rollback;
