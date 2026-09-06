-- 0141 — reports can name a message, and the admin read that follows (#574).
--
-- Three migrations meet here: 20260831153523 widens `reports_target_type_check` with
-- 'message'; 20260831153525 adds the two evidence-read policies; 20260831153524 is
-- resolve_report v5, which resolves a message report's SUBJECT through `messages.sender_id`
-- so the verdict lands on the person who wrote it.
--
-- ── what this file is really guarding ───────────────────────────────────────────────────
-- #97's ruling (2026-08-30) is a privacy boundary, and a privacy boundary is only real if a
-- test fails when it moves. The load-bearing assertions are the NEGATIVE ones: an admin
-- reading the reported message must NOT thereby read the message beside it, the conversation
-- row, or the unreported image in the same thread. A policy widened to conversation membership
-- would pass every positive assertion in this file and fail exactly those three.
--
-- Fixture topology: SENDER and REPORTER share a direct conversation (no ice-breakers, so the
-- message counts below are only ours). SENDER writes eight messages; REPORTER reports five of
-- them. ADMIN holds `app_metadata.role = 'admin'` and is a participant of nothing. OUTSIDER is
-- a member of neither the conversation nor the admin role.
--
-- Reads run BEFORE the verdicts: the suspend/ban arms mutate SENDER's standing, and several
-- storage predicates elsewhere in the schema key on exactly that.

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','a1410000-0000-0000-0000-000000000001','authenticated','authenticated','mr_admin@test.athanor','{}'::jsonb,'{"role":"admin"}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1410000-0000-0000-0000-000000000002','authenticated','authenticated','mr_sender@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1410000-0000-0000-0000-000000000003','authenticated','authenticated','mr_reporter@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1410000-0000-0000-0000-000000000004','authenticated','authenticated','mr_outsider@test.athanor','{}'::jsonb,'{}'::jsonb,now(),now());

set local role service_role;
select set_config('test.conv', public.create_conversation_pair(
  'a1410000-0000-0000-0000-000000000002','a1410000-0000-0000-0000-000000000003','direct')::text, true);

-- Eight messages from SENDER. m2 and m4 are NEVER reported and are the whole point of the
-- file: they are the non-reporting party's other words, and they must stay private.
insert into public.messages (id, conversation_id, sender_id, kind, body, media_url) values
  ('bb410000-0000-0000-0000-000000000001', current_setting('test.conv')::uuid,
   'a1410000-0000-0000-0000-000000000002','user','parole segnalate', null),
  ('bb410000-0000-0000-0000-000000000002', current_setting('test.conv')::uuid,
   'a1410000-0000-0000-0000-000000000002','user','parole mai segnalate', null),
  ('bb410000-0000-0000-0000-000000000005', current_setting('test.conv')::uuid,
   'a1410000-0000-0000-0000-000000000002','user','cancellato', null),
  ('bb410000-0000-0000-0000-000000000006', current_setting('test.conv')::uuid,
   'a1410000-0000-0000-0000-000000000002','user','sospensione', null),
  ('bb410000-0000-0000-0000-000000000007', current_setting('test.conv')::uuid,
   'a1410000-0000-0000-0000-000000000002','user','esclusione', null),
  -- The deleted-member shape: kind='user' with a null sender, which messages_user_shape admits
  -- (#336) and `sender_id ON DELETE SET NULL` produces mid-erasure.
  ('bb410000-0000-0000-0000-000000000008', current_setting('test.conv')::uuid,
   null,'user','mittente cancellato', null);

insert into public.messages (id, conversation_id, sender_id, kind, body, media_url) values
  ('bb410000-0000-0000-0000-000000000003', current_setting('test.conv')::uuid,
   'a1410000-0000-0000-0000-000000000002','user', null,
   'a1410000-0000-0000-0000-000000000002/' || current_setting('test.conv')
     || '/cc410000-0000-0000-0000-00000000000a.jpg'),
  ('bb410000-0000-0000-0000-000000000004', current_setting('test.conv')::uuid,
   'a1410000-0000-0000-0000-000000000002','user', null,
   'a1410000-0000-0000-0000-000000000002/' || current_setting('test.conv')
     || '/cc410000-0000-0000-0000-00000000000b.jpg');

update public.messages set deleted_at = now()
  where id = 'bb410000-0000-0000-0000-000000000005';
reset role;

-- The two objects those image messages point at, seeded as the owning role (RLS bypassed) the
-- way 0136 does — the storage API is not involved, and the signed-URL path resolves to exactly
-- the SELECT the behavioural assertions below issue.
insert into storage.objects (bucket_id, name, owner_id)
select 'chat-media', media_url, sender_id from public.messages
 where id in ('bb410000-0000-0000-0000-000000000003','bb410000-0000-0000-0000-000000000004');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (A) the vocabulary widened, and stayed closed
-- ─────────────────────────────────────────────────────────────────────────────────────────
set local role service_role;
select lives_ok(
  $$ insert into public.reports (id, reporter_id, target_type, target_id, category, note)
     values ('dd410000-0000-0000-0000-000000000001','a1410000-0000-0000-0000-000000000003',
             'message','bb410000-0000-0000-0000-000000000001','harassment','queste parole') $$,
  'a report can name a message (#574)');

select throws_ok(
  $$ insert into public.reports (reporter_id, target_type, target_id, category)
     values ('a1410000-0000-0000-0000-000000000003','thread','bb410000-0000-0000-0000-000000000001','spam') $$,
  '23514', null,
  'widening the set did not open it — an unknown target type is still refused (a target is named, so the 23514 is the type CHECK and not #611''s)');

-- Four members and no more. Counted rather than string-compared: the rendered CHECK text is
-- Postgres's to format, but how many values it admits is ours.
select is(
  (select count(*)::int
     from pg_constraint c,
          lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z]+)''::text', 'g')
    where c.conrelid = 'public.reports'::regclass
      and c.conname = 'reports_target_type_check'),
  4, 'reports_target_type_check admits exactly four target types');

-- the rest of the fixtures
insert into public.reports (id, reporter_id, target_type, target_id, category, note) values
  ('dd410000-0000-0000-0000-000000000003','a1410000-0000-0000-0000-000000000003',
   'message','bb410000-0000-0000-0000-000000000003','harassment','questa foto'),
  ('dd410000-0000-0000-0000-000000000005','a1410000-0000-0000-0000-000000000003',
   'message','bb410000-0000-0000-0000-000000000005','spam','cancellato'),
  ('dd410000-0000-0000-0000-000000000006','a1410000-0000-0000-0000-000000000003',
   'message','bb410000-0000-0000-0000-000000000006','harassment','sospensione'),
  ('dd410000-0000-0000-0000-000000000007','a1410000-0000-0000-0000-000000000003',
   'message','bb410000-0000-0000-0000-000000000007','harassment','esclusione'),
  ('dd410000-0000-0000-0000-000000000008','a1410000-0000-0000-0000-000000000003',
   'message','bb410000-0000-0000-0000-000000000008','spam','mittente cancellato'),
  -- a post target is named (#611: a 'post' report cannot be filed without one); no FK, so it
  -- need not resolve — v5 refuses the penalty on the TYPE, not on whether the id resolves
  ('dd410000-0000-0000-0000-00000000000f','a1410000-0000-0000-0000-000000000003',
   'post','cc410000-0000-0000-0000-00000000000f','spam','un post');
reset role;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (B) the evidence policy, from the catalog (a policy rewritten to `true` keeps its name)
-- ─────────────────────────────────────────────────────────────────────────────────────────
select is_empty(
  $$ select policyname::text || ' -> ' || roles::text from pg_policies
      where schemaname = 'public' and tablename = 'messages'
        and policyname = 'messages_select_reported'
        and roles <> '{authenticated}'::name[] $$,
  'the evidence policy is TO authenticated only (never PUBLIC)');

select ok(
  (select qual like '%SELECT athanor.is_admin()%'
     from pg_policies where schemaname = 'public' and tablename = 'messages'
      and policyname = 'messages_select_reported'),
  'admin status is the wrapped (select athanor.is_admin()) form, evaluated once per statement');

select ok(
  (select qual like '%reports%' and qual like '%target_type%'
     from pg_policies where schemaname = 'public' and tablename = 'messages'
      and policyname = 'messages_select_reported'),
  'the evidence policy is scoped through the report join, not through membership');

-- The ruling as a property of the predicate. `conversation` appearing here at all — even as an
-- extra conjunct someone thought was harmless — is how "the reported message" becomes "the
-- thread it came from".
select ok(
  (select qual not like '%conversation%' and qual not like '%participant_a%'
     from pg_policies where schemaname = 'public' and tablename = 'messages'
      and policyname = 'messages_select_reported'),
  'the evidence policy never mentions the conversation (reported content only, #97)');

select ok(
  (select qual like '%deleted_at%'
     from pg_policies where schemaname = 'public' and tablename = 'messages'
      and policyname = 'messages_select_reported'),
  'an erased message is erased for the moderator too — the arm keeps the deleted_at gate');

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (C) behaviour: what the admin reads, and — the point of the file — what they do not
-- ─────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1410000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

select is(athanor.is_admin(), true, 'the admin fixture actually resolves as admin');

-- Named, not counted. A count of 5 would also be satisfied by the wrong five.
select bag_eq(
  $$ select id::text from public.messages
      where conversation_id = current_setting('test.conv')::uuid $$,
  $$ values ('bb410000-0000-0000-0000-000000000001'::text),
            ('bb410000-0000-0000-0000-000000000003'::text),
            ('bb410000-0000-0000-0000-000000000006'::text),
            ('bb410000-0000-0000-0000-000000000007'::text),
            ('bb410000-0000-0000-0000-000000000008'::text) $$,
  'the admin reads exactly the reported, undeleted messages — no more');

select is(
  (select count(*)::int from public.messages
    where id = 'bb410000-0000-0000-0000-000000000002'),
  0, 'the message BESIDE the reported one stays private (the non-reporting party''s words)');

select is(
  (select count(*)::int from public.messages
    where id = 'bb410000-0000-0000-0000-000000000005'),
  0, 'a soft-deleted message is unreadable even though a report names it');

select is(
  (select count(*)::int from public.conversations
    where id = current_setting('test.conv')::uuid),
  0, 'reading the reported message does not make the moderator a participant');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name like '%cc410000-0000-0000-0000-00000000000a%'),
  1, 'the admin reads the REPORTED image');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name like '%cc410000-0000-0000-0000-00000000000b%'),
  0, 'the admin does NOT read the unreported image in the same conversation');

-- OUTSIDER: a member, neither participant nor admin. Every arm above must be closed to them —
-- the evidence policies are the newest permissive arms on two tables, and a permissive arm
-- that leaks is indistinguishable from one that works until someone asks.
set local request.jwt.claims = '{"sub":"a1410000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(athanor.is_admin(), false, 'the outsider fixture is not an admin');
select is(
  (select count(*)::int from public.messages
    where conversation_id = current_setting('test.conv')::uuid),
  0, 'a non-admin member reads none of the reported messages');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'chat-media'
     and name like '%cc410000-0000-0000-0000-0000000000%'),
  0, 'a non-admin member reads none of the reported images');

-- The participant is untouched by all of this: their thread still reads in full.
set local request.jwt.claims = '{"sub":"a1410000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.messages
    where conversation_id = current_setting('test.conv')::uuid),
  7, 'a participant still reads the whole thread (all eight less the soft-deleted one)');
reset role;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (D) resolve_report v5 — the verdict lands on the sender
-- ─────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1410000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';

select lives_ok(
  $$ select public.resolve_report('dd410000-0000-0000-0000-000000000001','dismissed','niente','dismiss') $$,
  'a message report can be dismissed');

select lives_ok(
  $$ select public.resolve_report('dd410000-0000-0000-0000-000000000006','upheld','sospeso','suspend',
                                  null, null, now() + interval '7 days') $$,
  'a message report can be upheld with a suspension');

select lives_ok(
  $$ select public.resolve_report('dd410000-0000-0000-0000-000000000007','upheld','escluso','ban') $$,
  'a message report can be upheld with a ban');

-- An erased sender leaves nothing to enforce against, and v5 says so with 22023 rather than
-- silently updating zero rows.
select throws_ok(
  $$ select public.resolve_report('dd410000-0000-0000-0000-000000000008','upheld','x','penalty','low',-50) $$,
  '22023', null,
  'a penalty on a message whose sender is erased raises 22023 rather than enforcing on nobody');

-- v4's behaviour for the other target types survives untouched.
select throws_ok(
  $$ select public.resolve_report('dd410000-0000-0000-0000-00000000000f','upheld','x','penalty','low',-50) $$,
  '22023', null,
  'a penalty on a post target still raises 22023 (v4 behaviour preserved)');
reset role;

-- The enforcement state, read as the owning role: `profiles` carries COLUMN-level ACLs and
-- `suspended_until` / `banned_at` are deliberately not among the columns a member may read
-- (they are moderation state, not profile data), so an `authenticated` read of them is a 42501
-- rather than an empty row — which is the grant half of #106 working, one table over.
select ok(
  (select suspended_until > now() from public.profiles
    where id = 'a1410000-0000-0000-0000-000000000002'),
  'the suspension was written against the message''s sender, not its id');
select ok(
  (select banned_at is not null from public.profiles
    where id = 'a1410000-0000-0000-0000-000000000002'),
  'the ban was written against the message''s sender');

select is(
  (select count(*)::int from public.audit_log
    where report_id in ('dd410000-0000-0000-0000-000000000001',
                        'dd410000-0000-0000-0000-000000000006',
                        'dd410000-0000-0000-0000-000000000007')),
  3, 'every message verdict journalled its audit row');

-- Rule #1, on this path too: a moderation verdict never writes Aura. The engine does, and only
-- when the enqueue reaches it.
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('a1410000-0000-0000-0000-000000000002',
                         'a1410000-0000-0000-0000-000000000003')),
  0, 'resolving message reports produced zero aura_events (rule #1)');
reset role;

-- The report the dismissal resolved keeps its evidence readable: the panel renders a resolved
-- report with its audit trail, and evidence that vanished at the verdict would make that page
-- a claim nobody could check.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1410000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}';
select is(
  (select count(*)::int from public.messages
    where id = 'bb410000-0000-0000-0000-000000000001'),
  1, 'a resolved report still resolves its evidence (no status predicate on the read)');
reset role;

select * from finish();
rollback;
