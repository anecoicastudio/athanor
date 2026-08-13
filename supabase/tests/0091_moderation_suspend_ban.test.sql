-- #106 — suspend/ban enforcement. Verifies both halves of the DB side:
--   • resolve_report v3 writes the state (suspended_until / banned_at) + the audit row and
--     enqueues moderation-enforce with the exact payload the edge function parses;
--   • athanor.is_active() as restrictive policies + DEFINER-RPC guards actually stops a
--     suspended/banned member from posting, messaging, RSVPing, reacting and uploading,
--     while the safety/legal carve-outs (reports, blocks) stay open.
-- The GoTrue half (ban_duration) is asserted in moderation-enforce/logic.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- ── setup ────────────────────────────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','admin@t.athanor','{}'::jsonb,'{"role":"admin"}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','member@t.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','target@t.athanor','{}'::jsonb,'{}'::jsonb,now(),now());

-- content the suspended member will try to act on
insert into public.posts (id, author_id, category, body)
  values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','human','post della member');
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents)
  values ('eeeeeeee-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'Cerchio aperto','benessere',true,'https://stream.athanor.test/x', now() + interval '1 day', 0);
insert into public.momento_proposals (id, user_id, candidate_id)
  values ('99999999-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
-- open reports against the target (person) + one non-person report
insert into public.reports (id, reporter_id, target_type, target_id, category) values
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','person','cccccccc-cccc-cccc-cccc-cccccccccccc','harassment'),
  ('dddddddd-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','person','cccccccc-cccc-cccc-cccc-cccccccccccc','harassment'),
  ('dddddddd-0000-0000-0000-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','person','cccccccc-cccc-cccc-cccc-cccccccccccc','harassment'),
  ('dddddddd-0000-0000-0000-000000000004','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','post', null,'spam');

set local role service_role;
select set_config('test.conv',
  public.create_conversation_pair('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
                                  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'direct')::text,
  false);
reset role;

-- moderation-enforce configured (GUC branch of runtime_setting; rolled back with this txn).
-- pg_net's worker never sees uncommitted rows, so net.http_request_queue witnesses payloads.
select set_config('app.settings.moderation_enforce_url', 'http://enforce.invalid/functions/v1/moderation-enforce', true);
select set_config('app.settings.moderation_enforce_key', 'sb_secret_pgtap_dummy_key', true);
select set_config('test.until', (now() + interval '7 days')::text, false);

-- ── (A) an ACTIVE member writes fine — the cause of every later 42501 is the gate ────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select lives_ok(
  $$ insert into public.posts (id, author_id, category, body)
     values ('aaaaaaaa-0000-0000-0000-000000000002','cccccccc-cccc-cccc-cccc-cccccccccccc','human','pre-sanzione') $$,
  'active target posts fine before the verdict');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('post-media','cccccccc-cccc-cccc-cccc-cccccccccccc/aaaaaaaa-0000-0000-0000-000000000002/1.jpg') $$,
  'active target uploads fine before the verdict');
reset role;

-- ── (B) resolve_report v3 validation ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
select throws_ok(
  $$ select public.resolve_report('dddddddd-0000-0000-0000-000000000001','upheld','x','suspend') $$,
  '22023', null, 'suspend without p_suspend_until raises 22023');
select throws_ok(
  $$ select public.resolve_report('dddddddd-0000-0000-0000-000000000001','upheld','x','dismiss') $$,
  '22023', null, 'dismiss with status upheld raises 22023');
select throws_ok(
  $$ select public.resolve_report('dddddddd-0000-0000-0000-000000000001','upheld','x','warn',null,-100) $$,
  '22023', null, 'penalty_points on a non-penalty action raises 22023');
select throws_ok(
  $$ select public.resolve_report('dddddddd-0000-0000-0000-000000000004','upheld','x','ban') $$,
  '22023', null, 'ban on a non-person target raises 22023');

-- ── (C) warn: the audit row IS the outcome ───────────────────────────────────────────────
select lives_ok(
  $$ select public.resolve_report('dddddddd-0000-0000-0000-000000000001','upheld','richiamo','warn') $$,
  'admin warns');
reset role;
select is(
  (select count(*)::int from public.audit_log
    where report_id = 'dddddddd-0000-0000-0000-000000000001' and action = 'warn' and penalty_points is null),
  1, 'warn writes its audit row');
select is(
  (select suspended_until is null and banned_at is null from public.profiles
    where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  true, 'warn leaves the profile untouched');

-- ── (D) suspend writes state + audit + enqueues the auth half ────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
select lives_ok(
  $$ select public.resolve_report('dddddddd-0000-0000-0000-000000000002','upheld','sospensione','suspend',
                                  null, null, current_setting('test.until')::timestamptz) $$,
  'admin suspends');
reset role;
select is(
  (select suspended_until from public.profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  current_setting('test.until')::timestamptz,
  'suspended_until written');
select is(
  (select count(*)::int from public.audit_log
    where report_id = 'dddddddd-0000-0000-0000-000000000002' and action = 'suspend' and penalty_points is null),
  1, 'suspend writes its audit row');
select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'profileId'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'action' = 'suspend'
    order by q.id desc limit 1),
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'suspend enqueues moderation-enforce for the target');
select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'until'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'action' = 'suspend'
    order by q.id desc limit 1),
  to_char(current_setting('test.until')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'the payload carries until as the ISO instant logic.ts parses');

-- ── (E) the suspended member is frozen ───────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select is(athanor.is_active(), false, 'is_active() false while suspended');
select throws_ok(
  $$ insert into public.posts (author_id, category, body)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc','human','non passa') $$,
  '42501', null, 'suspended cannot post');
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
     values (current_setting('test.conv')::uuid,'cccccccc-cccc-cccc-cccc-cccccccccccc','user','non passa') $$,
  '42501', null, 'suspended cannot message');
select throws_ok(
  $$ insert into public.rsvps (user_id, event_id)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc','eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501', null, 'suspended cannot RSVP');
select throws_ok(
  $$ insert into public.post_reactions (post_id, person_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  '42501', null, 'suspended cannot react');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('post-media','cccccccc-cccc-cccc-cccc-cccccccccccc/aaaaaaaa-0000-0000-0000-000000000002/2.jpg') $$,
  '42501', null, 'suspended cannot upload');
select throws_ok(
  $$ select public.claim_event_seat('eeeeeeee-0000-0000-0000-000000000001') $$,
  '42501', null, 'suspended cannot claim a paid seat (DEFINER guard)');
select throws_ok(
  $$ select public.get_or_create_conversation('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  '42501', null, 'suspended cannot open a conversation (DEFINER guard)');
select throws_ok(
  $$ select public.accept_momento('99999999-0000-0000-0000-000000000001') $$,
  '42501', null, 'suspended cannot accept a Momento (DEFINER guard)');
-- safety/legal carve-outs stay open
select lives_ok(
  $$ insert into public.reports (reporter_id, target_type, target_id, category)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc','person','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','harassment') $$,
  'suspended can still report (safety carve-out)');
select lives_ok(
  $$ insert into public.blocks (blocker_id, blocked_id)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  'suspended can still block (safety carve-out)');
reset role;

-- ── (F) a suspension lifts itself — the predicate compares now() ─────────────────────────
update public.profiles set suspended_until = now() - interval '1 hour'
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select is(athanor.is_active(), true, 'is_active() true once suspended_until passes');
select lives_ok(
  $$ insert into public.posts (author_id, category, body)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc','human','di nuovo qui') $$,
  'an expired suspension no longer blocks');
reset role;

-- ── (G) ban is permanent state ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}';
select lives_ok(
  $$ select public.resolve_report('dddddddd-0000-0000-0000-000000000003','upheld','ban','ban') $$,
  'admin bans');
reset role;
select is(
  (select banned_at is not null from public.profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  true, 'banned_at written');
select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'until'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'action' = 'ban'
    order by q.id desc limit 1),
  null,
  'ban enqueues with no until — logic.ts maps it to the permanent duration');
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select throws_ok(
  $$ insert into public.posts (author_id, category, body)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc','human','non passa più') $$,
  '42501', null, 'banned cannot post');
reset role;

-- ── (H) the state columns are server-only ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set suspended_until = null where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501', null, 'no client UPDATE grant on suspended_until');
select throws_ok(
  $$ select suspended_until from public.profiles where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501', null, 'no client SELECT grant on suspended_until');
reset role;

-- ── (I) coverage: the restrictive net is exactly the declared matrix ─────────────────────
-- 22 social tables × 3 commands + profiles UPDATE = 67; a new social table missing its
-- three policies (or a dropped one) moves these counts and fails here.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and policyname like 'active_write_%' and permissive = 'RESTRICTIVE'),
  67, 'restrictive write net over public is complete');
select is(
  (select count(distinct tablename)::int from pg_policies
    where schemaname = 'public' and policyname like 'active_write_%' and permissive = 'RESTRICTIVE'),
  23, '23 public tables carry the gate');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'active_write_%' and permissive = 'RESTRICTIVE'),
  3, 'storage.objects carries the gate on all three write commands');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_report'),
  1, 'exactly one resolve_report signature (PGRST203 guard — admin.ts NOTE)');

select * from finish();
rollback;
