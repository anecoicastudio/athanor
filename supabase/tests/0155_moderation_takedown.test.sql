-- 0155 — takedown, ban from a post or behaviour report, child-safety category (#788).
--
-- Migration 20260923062248. What each section guards:
--   (A) the category vocabulary widened by exactly one, and stayed closed;
--   (B) resolve_report v6 — suspend | ban land on a post's author and on a behaviour report's
--       named profile; penalty still refuses a post; a targetless behaviour report still has
--       nobody to enforce against; a child-safety warn tells nobody;
--   (C) admin_report_handles names the subject v6 enforces against;
--   (D) admin_takedown — posture, refusal order, the three soft deletes, ONE audit row each,
--       the conversation preview recomputed;
--   (E) the bytes stop being servable the moment the row goes (post-media and chat-media);
--   (F) admin_purge_post_media — refuses a live post, releases a taken-down one, and the
--       path-keyed hide survives the purge;
--   (G) audit_log's content shape holds in the table, not only in the functions.
--
-- Fixture topology. ADMIN holds app_metadata.role = 'admin'. AUTHOR writes post P1 (one image
-- + a comment K1) and sends RECIPIENT a text message M0-reply and an image message M1.
-- RECIPIENT and REPORTER are ordinary members. SUBJECT writes post P2 and is the member the
-- post-report ban and the behaviour-report suspension land on — kept apart from AUTHOR so the
-- ban's own read-side hiding (not_banned) can never be what hides AUTHOR's bytes in (E).

begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','a1550000-0000-4000-8000-000000000001','authenticated','authenticated','td_admin@test.athanor','{}'::jsonb,'{"role":"admin"}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1550000-0000-4000-8000-000000000002','authenticated','authenticated','td_author@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1550000-0000-4000-8000-000000000003','authenticated','authenticated','td_recipient@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1550000-0000-4000-8000-000000000004','authenticated','authenticated','td_reporter@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1550000-0000-4000-8000-000000000005','authenticated','authenticated','td_subject@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now());

set local role service_role;
update public.profiles set handle = 'td_author'  where id = 'a1550000-0000-4000-8000-000000000002';
update public.profiles set handle = 'td_subject' where id = 'a1550000-0000-4000-8000-000000000005';

insert into public.posts (id, author_id, category, body) values
  ('b1550000-0000-4000-8000-000000000001','a1550000-0000-4000-8000-000000000002','human','post segnalato'),
  ('b1550000-0000-4000-8000-000000000002','a1550000-0000-4000-8000-000000000005','human','post del soggetto');
insert into public.post_media (post_id, kind, storage_path, position) values
  ('b1550000-0000-4000-8000-000000000001','image',
   'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg', 0);
insert into public.post_comments (id, post_id, author_id, body) values
  ('c1550000-0000-4000-8000-000000000001','b1550000-0000-4000-8000-000000000002',
   'a1550000-0000-4000-8000-000000000002','commento da rimuovere');

select set_config('test.conv', public.create_conversation_pair(
  'a1550000-0000-4000-8000-000000000002','a1550000-0000-4000-8000-000000000003','direct')::text, true);
select set_config('test.key',
  'a1550000-0000-4000-8000-000000000002/' || current_setting('test.conv')
    || '/e1550000-0000-4000-8000-00000000000a.jpg', true);
-- M0 first (older), then M1 — the image, and the conversation's newest message.
insert into public.messages (id, conversation_id, sender_id, kind, body, media_url, created_at) values
  ('d1550000-0000-4000-8000-000000000000', current_setting('test.conv')::uuid,
   'a1550000-0000-4000-8000-000000000003','user','ciao', null, now() - interval '2 minutes'),
  ('d1550000-0000-4000-8000-000000000001', current_setting('test.conv')::uuid,
   'a1550000-0000-4000-8000-000000000002','user', null, current_setting('test.key'),
   now() - interval '1 minute');
reset role;

-- The two objects, seeded as the owning role (RLS bypassed), 0141's way.
insert into storage.objects (bucket_id, name, owner_id) values
  ('post-media',
   'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg',
   'a1550000-0000-4000-8000-000000000002'),
  ('chat-media', current_setting('test.key'), 'a1550000-0000-4000-8000-000000000002');

-- fan-out configured, so a warn that DID notify would leave a row in net.http_request_queue.
select set_config('app.settings.notification_fanout_url', 'http://fanout.invalid/functions/v1/notification-fan-out', true);
select set_config('app.settings.notification_fanout_key', 'sb_secret_pgtap_dummy_key', true);
select set_config('app.settings.moderation_enforce_url', 'http://enforce.invalid/functions/v1/moderation-enforce', true);
select set_config('app.settings.moderation_enforce_key', 'sb_secret_pgtap_dummy_key', true);

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (A) the category vocabulary
-- ─────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok(
  $$ insert into public.reports (id, reporter_id, target_type, target_id, category, note)
     values ('f1550000-0000-4000-8000-000000000001','a1550000-0000-4000-8000-000000000004',
             'post','b1550000-0000-4000-8000-000000000001','child_safety','riguarda un minore') $$,
  'A1 a member files a child_safety report through their own insert policy');
select throws_ok(
  $$ insert into public.reports (reporter_id, target_type, target_id, category)
     values ('a1550000-0000-4000-8000-000000000004','post','b1550000-0000-4000-8000-000000000001','csam') $$,
  '23514', null, 'A2 the set is still closed — an unknown category is refused');
reset role;
select is(
  (select count(*)::int
     from pg_constraint c,
          lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g')
    where c.conrelid = 'public.reports'::regclass and c.conname = 'reports_category_check'),
  8, 'A3 reports_category_check admits exactly eight categories');

-- the rest of the reports, filed as the service role (fixtures, not behaviour)
set local role service_role;
insert into public.reports (id, reporter_id, target_type, target_id, category) values
  -- on SUBJECT's post: the ban; and a second one for the penalty refusal
  ('f1550000-0000-4000-8000-000000000002','a1550000-0000-4000-8000-000000000004','post','b1550000-0000-4000-8000-000000000002','harassment'),
  ('f1550000-0000-4000-8000-000000000003','a1550000-0000-4000-8000-000000000004','post','b1550000-0000-4000-8000-000000000002','spam'),
  -- behaviour naming SUBJECT (the seed's shape), and behaviour naming nobody (the app's shape)
  ('f1550000-0000-4000-8000-000000000004','a1550000-0000-4000-8000-000000000004','behavior','a1550000-0000-4000-8000-000000000005','harassment'),
  ('f1550000-0000-4000-8000-000000000005','a1550000-0000-4000-8000-000000000004','behavior',null,'harassment'),
  -- behaviour naming an id that is no member
  ('f1550000-0000-4000-8000-000000000006','a1550000-0000-4000-8000-000000000004','behavior','a1550000-0000-4000-8000-0000000000ff','harassment'),
  -- RECIPIENT reports M1 as child_safety; left OPEN for the resolve-first refusal
  ('f1550000-0000-4000-8000-000000000007','a1550000-0000-4000-8000-000000000003','message','d1550000-0000-4000-8000-000000000001','child_safety'),
  -- a harassment report on AUTHOR's post, for the ordinary-warn control
  ('f1550000-0000-4000-8000-000000000008','a1550000-0000-4000-8000-000000000004','post','b1550000-0000-4000-8000-000000000001','harassment');
reset role;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (C) handles — read BEFORE any verdict, so SUBJECT's standing is untouched
-- ─────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';
select is(
  (select subject_handle from public.admin_report_handles(array['f1550000-0000-4000-8000-000000000002']::uuid[])),
  'td_subject', 'C1 a post report names the post''s AUTHOR — the member v6 bans');
select is(
  (select subject_handle from public.admin_report_handles(array['f1550000-0000-4000-8000-000000000004']::uuid[])),
  'td_subject', 'C2 a behaviour report naming a profile names that member');
select is(
  (select subject_handle from public.admin_report_handles(array['f1550000-0000-4000-8000-000000000005']::uuid[])),
  null, 'C3 a behaviour report naming nobody has no subject');
select is(
  (select subject_handle from public.admin_report_handles(array['f1550000-0000-4000-8000-000000000001']::uuid[])),
  'td_author', 'C4 a child-safety post report names its author too');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (B) resolve_report v6
-- ─────────────────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000003','upheld','x','penalty','low',-50) $$,
  '22023', null, 'B1 a penalty on a post still raises 22023 — the ruling widened suspend/ban only');
select throws_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000005','upheld','x','suspend',null,null, now() + interval '7 days') $$,
  '22023', null, 'B2 suspend on a behaviour report naming nobody raises 22023 — nobody to enforce against');
select throws_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000006','upheld','x','ban') $$,
  '22023', null, 'B3 ban on a behaviour report whose target is no member raises 22023');
select lives_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000004','upheld','insiste','suspend',null,null, now() + interval '7 days') $$,
  'B4 suspend on a behaviour report naming a profile succeeds');
select lives_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000002','upheld','molestie','ban') $$,
  'B5 ban on a post report succeeds');
reset role;
select is(
  (select suspended_until > now() and banned_at is not null from public.profiles
    where id = 'a1550000-0000-4000-8000-000000000005'),
  true, 'B6 both verdicts landed on SUBJECT — the behaviour target and the post''s author');
select is(
  (select count(*)::int from public.audit_log
    where report_id in ('f1550000-0000-4000-8000-000000000002','f1550000-0000-4000-8000-000000000004')),
  2, 'B7 one audit row per verdict');
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'profileId' = 'a1550000-0000-4000-8000-000000000005'),
  2, 'B8 both verdicts enqueued moderation-enforce for SUBJECT (the GoTrue half)');
select is(
  (select banned_at is null and suspended_until is null from public.profiles
    where id = 'a1550000-0000-4000-8000-000000000004'),
  true, 'B9 the reporter is untouched — the verdict never lands on the filer');

-- child-safety warn: audit row, no notification; the control category still notifies.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';
select lives_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000001','upheld','confermata','warn') $$,
  'B10 a child-safety report resolves with a warn');
reset role;
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'template_key' = 'notif.tpl.warn'),
  0, 'B11 a child-safety warn enqueues NO notification — the reason would name the report to its subject');
select is(
  (select count(*)::int from public.audit_log
    where report_id = 'f1550000-0000-4000-8000-000000000001' and action = 'warn'),
  1, 'B12 …and still writes its audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';
select lives_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000008','upheld','richiamo','warn') $$,
  'B13 a harassment report on the same post resolves with a warn');
reset role;
select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'recipient_id' from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'template_key' = 'notif.tpl.warn'),
  'a1550000-0000-4000-8000-000000000002',
  'B14 control: any other category still warns the author (#313 unchanged)');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (E-before) the bytes are servable while the content lives
-- ─────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'post-media'
     and name = 'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg'),
  1, 'E1 before the takedown a member reads the post''s image');
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media' and name = current_setting('test.key')),
  1, 'E2 before the takedown the recipient reads the chat image');
reset role;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (D) admin_takedown
-- ─────────────────────────────────────────────────────────────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'public.admin_takedown(text, uuid, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_takedown(text, uuid, text, uuid)', 'execute'),
  'D1 admin_takedown: authenticated may call it, anon may not');
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
     from pg_proc where oid = 'public.admin_takedown(text, uuid, text, uuid)'::regprocedure),
  'D2 admin_takedown is SECURITY DEFINER with a locked search_path');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_takedown('post','b1550000-0000-4000-8000-000000000001','x') $$,
  '42501', null, 'D3 a member who is not an admin is refused (42501)');

set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';
select throws_ok(
  $$ select public.admin_takedown('story','b1550000-0000-4000-8000-000000000001','x') $$,
  '22023', null, 'D4 an unknown target type is refused');
select throws_ok(
  $$ select public.admin_takedown(null,'b1550000-0000-4000-8000-000000000001','x') $$,
  '22023', null, 'D5 a null target type is refused, not fallen through (IF <null>)');
select throws_ok(
  $$ select public.admin_takedown('post','b1550000-0000-4000-8000-000000000001','   ') $$,
  '22023', null, 'D6 a blank reason is refused — the audit row must say why');
select throws_ok(
  $$ select public.admin_takedown('message','d1550000-0000-4000-8000-000000000001','x',
                                  'f1550000-0000-4000-8000-000000000007') $$,
  '22023', null, 'D7 a report still OPEN is refused — resolve first, take down second');
select throws_ok(
  $$ select public.admin_takedown('post','b1550000-0000-4000-8000-000000000001','x',
                                  'f1550000-0000-4000-8000-0000000000ff') $$,
  'P0002', null, 'D8 an unknown report is refused');
select throws_ok(
  $$ select public.admin_takedown('comment','c1550000-0000-4000-8000-0000000000ff','x') $$,
  'P0002', null, 'D9 a target that names no row is refused');
reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'takedown'),
  0, 'D10 every refusal above wrote nothing');

-- the post, on its upheld child-safety report
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';
select lives_ok(
  $$ select public.admin_takedown('post','b1550000-0000-4000-8000-000000000001','rimosso: tutela minori',
                                  'f1550000-0000-4000-8000-000000000001') $$,
  'D11 the admin takes the post down on its upheld report');
-- the comment, with no report at all (comments cannot be reported; an email report has no row)
select lives_ok(
  $$ select public.admin_takedown('comment','c1550000-0000-4000-8000-000000000001','segnalazione via email') $$,
  'D12 a comment is taken down with no report');
-- the message, once its report is resolved
select lives_ok(
  $$ select public.resolve_report('f1550000-0000-4000-8000-000000000007','upheld','confermata','warn') $$,
  'D13 the message report is resolved first (a warn: a ban here would hide AUTHOR''s bytes through not_banned and let (E) pass for the wrong reason)');
select lives_ok(
  $$ select public.admin_takedown('message','d1550000-0000-4000-8000-000000000001','rimosso',
                                  'f1550000-0000-4000-8000-000000000007') $$,
  'D14 …and then its message is taken down');
reset role;

select is(
  (select count(*)::int from public.posts
    where id = 'b1550000-0000-4000-8000-000000000001' and deleted_at is not null),
  1, 'D15 the post is soft-deleted');
select is(
  (select count(*)::int from public.post_comments
    where id = 'c1550000-0000-4000-8000-000000000001' and deleted_at is not null),
  1, 'D16 the comment is soft-deleted');
select is(
  (select count(*)::int from public.messages
    where id = 'd1550000-0000-4000-8000-000000000001' and deleted_at is not null),
  1, 'D17 the message is soft-deleted');
select is(
  (select count(*)::int from public.post_media where post_id = 'b1550000-0000-4000-8000-000000000001'),
  1, 'D18 the takedown KEEPS the post''s media rows — the bytes wait for the police report');
select results_eq(
  $$ select target_type, target_id, report_id, actor_id from public.audit_log
      where action = 'takedown' order by target_type $$,
  $$ values ('comment'::text, 'c1550000-0000-4000-8000-000000000001'::uuid, null::uuid,
             'a1550000-0000-4000-8000-000000000001'::uuid),
            ('message'::text, 'd1550000-0000-4000-8000-000000000001'::uuid,
             'f1550000-0000-4000-8000-000000000007'::uuid, 'a1550000-0000-4000-8000-000000000001'::uuid),
            ('post'::text, 'b1550000-0000-4000-8000-000000000001'::uuid,
             'f1550000-0000-4000-8000-000000000001'::uuid, 'a1550000-0000-4000-8000-000000000001'::uuid) $$,
  'D19 exactly one audit row per takedown, naming its target, its report (or none) and the admin');
select results_eq(
  $$ select last_message_preview, last_message_sender_id from public.conversations
      where id = current_setting('test.conv')::uuid $$,
  $$ values ('ciao'::text, 'a1550000-0000-4000-8000-000000000003'::uuid) $$,
  'D20 the chat list no longer previews the removed message — it falls back to the newest survivor');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.posts where id = 'b1550000-0000-4000-8000-000000000001'),
  0, 'D21 a member no longer reads the post');
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.messages where id = 'd1550000-0000-4000-8000-000000000001'),
  0, 'D22 the recipient no longer reads the message');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (E) the bytes stop being servable
-- ─────────────────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'post-media'
     and name = 'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg'),
  0, 'E3 after the takedown a member can no longer read (sign) the post''s image');
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media' and name = current_setting('test.key')),
  0, 'E4 after the takedown the recipient can no longer read (sign) the chat image');
reset role;
select is(
  (select count(*)::int from storage.objects
    where name in ('a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg',
                   current_setting('test.key'))),
  2, 'E5 …while both objects still exist — hidden, not removed');
select ok(
  not athanor.media_taken_down('post-media', 'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-0000000000aa/0.jpg')
  and not athanor.media_taken_down('post-media', 'a1550000-0000-4000-8000-000000000002/not-a-uuid/0.jpg')
  and not athanor.media_taken_down('moments', 'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg'),
  'E6 an upload whose post does not exist yet, a malformed key, and another bucket are never hidden');
select ok(
  has_function_privilege('authenticated', 'athanor.media_taken_down(text, text)', 'execute')
  and not has_function_privilege('anon', 'athanor.media_taken_down(text, text)', 'execute'),
  'E7 media_taken_down: callable by the policies'' role, not by anon');
select ok(
  (select qual like '%media_taken_down%' and qual like '%not_banned%' and qual like '%not_blocked%'
     from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'post-media_select_member'),
  'E8 post-media_select_member kept its standing gates and gained the takedown hide');
select ok(
  (select qual like '%media_taken_down%' and qual like '%participant_a%' and qual like '%not_banned%'
     from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat-media_select_participant'),
  'E9 chat-media_select_participant kept its membership gate and gained the takedown hide');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (F) admin_purge_post_media
-- ─────────────────────────────────────────────────────────────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'public.admin_purge_post_media(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_purge_post_media(uuid, text)', 'execute'),
  'F1 admin_purge_post_media: authenticated may call it, anon may not');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_purge_post_media('b1550000-0000-4000-8000-000000000001','x') $$,
  '42501', null, 'F2 a member who is not an admin is refused');
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';
select throws_ok(
  $$ select public.admin_purge_post_media('b1550000-0000-4000-8000-000000000002','x') $$,
  'P0001', null, 'F3 a live post is refused — purge only follows a takedown');
select is(
  public.admin_purge_post_media('b1550000-0000-4000-8000-000000000001','denuncia inoltrata'),
  1, 'F4 a taken-down post releases its one media row');
reset role;
select is(
  (select count(*)::int from public.post_media where post_id = 'b1550000-0000-4000-8000-000000000001'),
  0, 'F5 its post_media rows are gone — post-media-reaper will free the object');
select is(
  (select count(*)::int from public.post_media_reap_candidates(1000, interval '-1 hour')
    where name = 'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg'),
  1, 'F6 …and the reaper''s own predicate now lists it (grace aside)');
select is(
  (select report_id from public.audit_log where action = 'purge_media'
    and target_id = 'b1550000-0000-4000-8000-000000000001'),
  'f1550000-0000-4000-8000-000000000001'::uuid,
  'F7 the purge is audited and carries the takedown''s report');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1550000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'post-media'
     and name = 'a1550000-0000-4000-8000-000000000002/b1550000-0000-4000-8000-000000000001/0.jpg'),
  0, 'F8 the hide survives the purge — keyed on the post, not on the rows the purge deleted');
reset role;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (G) the content shape, in the table
-- ─────────────────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.audit_log (actor_id, action, reason)
     values ('a1550000-0000-4000-8000-000000000001','takedown','senza bersaglio') $$,
  '23514', null, 'G1 a takedown row without a target is refused by the table itself');
select throws_ok(
  $$ insert into public.audit_log (report_id, actor_id, action, reason, target_type, target_id)
     values ('f1550000-0000-4000-8000-000000000003','a1550000-0000-4000-8000-000000000001','dismiss','x',
             'post','b1550000-0000-4000-8000-000000000002') $$,
  '23514', null, 'G2 a verdict row cannot carry a content target');

select * from finish();
rollback;
