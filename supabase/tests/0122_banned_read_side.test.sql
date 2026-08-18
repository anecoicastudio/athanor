-- #314 — a ban ends presence, not other people's history.
--
-- 0091 asserts the WRITE side of #106 (a banned member cannot act). This asserts the READ side:
-- that a banned member disappears from anon, from feed and from search, that their media goes
-- with the row, that their replies inside someone else's thread SURVIVE, and that the
-- member-facing projection returns a tombstone rather than either the real identity or nothing.
--
-- Every section carries its own denominator — an equivalent read by or about an UNBANNED member,
-- asserted in the same role in the same section. A visibility test that only proves rows are
-- missing passes just as well when the fixture never existed, when the role has no grant, or when
-- an unrelated predicate swallowed the query; the paired assertion is what makes the zero mean
-- what it claims. Section (G) then asserts the privileges and the policy/function SHAPE directly,
-- because a behaviour test can pass for the wrong reason and a grant test cannot.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

-- ── setup ────────────────────────────────────────────────────────────────────────────────────
-- alice  — an ordinary member, the observer
-- bruno  — gets banned partway through
-- carla  — an ordinary member; owns the thread bruno replies in
-- admin  — app_metadata.role = admin
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000','a1111111-1111-1111-1111-111111111111','authenticated','authenticated','alice@t.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','b2222222-2222-2222-2222-222222222222','authenticated','authenticated','bruno@t.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','c3333333-3333-3333-3333-333333333333','authenticated','authenticated','carla@t.athanor','{}'::jsonb,'{}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000','d4444444-4444-4444-4444-444444444444','authenticated','authenticated','admin@t.athanor','{}'::jsonb,'{"role":"admin"}'::jsonb,now(),now());

set local role service_role;

-- profiles are created by the on_auth_user_created trigger; name them so the reads below can be
-- keyed on a handle, and open the dream facet so the anon dream path is exercised at all.
update public.profiles set handle = 'bruno', display_name = 'Bruno', avatar_path = 'b2222222-2222-2222-2222-222222222222/b2222222-2222-2222-2222-222222222222.jpg',
       founding_member = true, identity_verified = true,
       visibility = '{"identity":"public","dream":"public"}'::jsonb
 where id = 'b2222222-2222-2222-2222-222222222222';
update public.profiles set handle = 'carla', display_name = 'Carla', avatar_path = 'c3333333-3333-3333-3333-333333333333/c3333333-3333-3333-3333-333333333333.jpg',
       visibility = '{"identity":"public","dream":"public"}'::jsonb
 where id = 'c3333333-3333-3333-3333-333333333333';
update public.profiles set handle = 'alice' where id = 'a1111111-1111-1111-1111-111111111111';

-- bruno's own surface: the things a ban must remove
insert into public.posts (id, author_id, category, body) values
  ('bb000000-0000-0000-0000-000000000001','b2222222-2222-2222-2222-222222222222','human','post di bruno');
insert into public.moments (id, owner_id, kind, media_path) values
  ('bb000000-0000-0000-0000-000000000002','b2222222-2222-2222-2222-222222222222','photo','b2222222-2222-2222-2222-222222222222/bb000000-0000-0000-0000-000000000002.jpg');
insert into public.projects (id, author_id, title, category) values
  ('bb000000-0000-0000-0000-000000000003','b2222222-2222-2222-2222-222222222222','Progetto di Bruno','artistic');
insert into public.dreams (id, profile_id, text, status) values
  ('bb000000-0000-0000-0000-000000000004','b2222222-2222-2222-2222-222222222222','Il sogno di Bruno','active');
insert into storage.objects (bucket_id, name) values
  ('avatars','b2222222-2222-2222-2222-222222222222/b2222222-2222-2222-2222-222222222222.jpg');

-- carla's surface: the denominator, and the thread bruno speaks inside
insert into public.posts (id, author_id, category, body) values
  ('cc000000-0000-0000-0000-000000000001','c3333333-3333-3333-3333-333333333333','human','post di carla');
insert into public.dreams (id, profile_id, text, status) values
  ('cc000000-0000-0000-0000-000000000002','c3333333-3333-3333-3333-333333333333','Il sogno di Carla','active');
insert into storage.objects (bucket_id, name) values
  ('avatars','c3333333-3333-3333-3333-333333333333/c3333333-3333-3333-3333-333333333333.jpg');

-- OTHER PEOPLE'S HISTORY — the rows the ruling protects.
-- bruno's reply inside carla's thread, and bruno's message inside a conversation with carla.
insert into public.post_comments (id, post_id, author_id, body) values
  ('bb000000-0000-0000-0000-000000000005','cc000000-0000-0000-0000-000000000001','b2222222-2222-2222-2222-222222222222','risposta di bruno');
select set_config('test.conv',
  public.create_conversation_pair('c3333333-3333-3333-3333-333333333333'::uuid,
                                  'b2222222-2222-2222-2222-222222222222'::uuid, 'direct')::text,
  false);
insert into public.messages (conversation_id, sender_id, kind, body)
  values (current_setting('test.conv')::uuid,'b2222222-2222-2222-2222-222222222222','user','messaggio di bruno');
reset role;

-- ── (A) the denominator: before the ban, bruno is fully present ──────────────────────────────
set local role anon;
select is((select count(*)::int from public.profiles where handle = 'bruno'), 1,
  'A1 anon reads bruno''s shell before the ban');
select is((select count(*)::int from public.dreams where profile_id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'A2 anon reads bruno''s public dream before the ban');
select is((select count(*)::int from storage.objects
            where bucket_id = 'avatars' and name like 'b2222222%'), 1,
  'A3 anon can sign bruno''s avatar before the ban');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.profiles where handle = 'bruno'), 1,
  'A4 alice reads bruno''s profile row before the ban');
select is((select count(*)::int from public.posts where author_id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'A5 alice sees bruno''s post before the ban');
select is((select count(*)::int from public.moments where owner_id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'A6 alice sees bruno''s moment before the ban');
select is((select count(*)::int from public.projects where author_id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'A7 alice sees bruno''s project before the ban');
select is((select count(*)::int from public.dreams where profile_id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'A8 alice sees bruno''s dream before the ban');
select is((select removed from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), false,
  'A9 get_person_profile reports bruno NOT removed before the ban');
select is((select handle from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), 'bruno',
  'A10 get_person_profile projects the real handle before the ban');
reset role;

-- ── (B) the ban ──────────────────────────────────────────────────────────────────────────────
set local role service_role;
update public.profiles set banned_at = now() where id = 'b2222222-2222-2222-2222-222222222222';
reset role;

-- ── (C) presence is gone — anon and members alike ────────────────────────────────────────────
set local role anon;
select is((select count(*)::int from public.profiles where handle = 'bruno'), 0,
  'C1 anon no longer resolves bruno — /@handle 404s and the sitemap drops the row');
select is((select count(*)::int from public.profiles where handle = 'carla'), 1,
  'C2 …and carla still resolves: the anon shell itself is intact');
select is((select count(*)::int from public.dreams where profile_id = 'b2222222-2222-2222-2222-222222222222'), 0,
  'C3 anon loses bruno''s dream too — the cascade through profiles RLS');
select is((select count(*)::int from public.dreams where profile_id = 'c3333333-3333-3333-3333-333333333333'), 1,
  'C4 …and carla''s public dream is untouched');
select is((select count(*)::int from storage.objects
            where bucket_id = 'avatars' and name like 'b2222222%'), 0,
  'C5 anon cannot sign bruno''s avatar — the face does not outlive the 404');
select is((select count(*)::int from storage.objects
            where bucket_id = 'avatars' and name like 'c3333333%'), 1,
  'C6 …and carla''s avatar still signs for anon');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.profiles where handle = 'bruno'), 0,
  'C7 bruno''s profile row is gone for a signed-in member — this is what removes him from search');
select is((select count(*)::int from public.profiles where handle = 'carla'), 1,
  'C8 …and carla''s row is still there');
select is((select count(*)::int from public.posts where author_id = 'b2222222-2222-2222-2222-222222222222'), 0,
  'C9 bruno''s post leaves the feed');
select is((select count(*)::int from public.posts where author_id = 'c3333333-3333-3333-3333-333333333333'), 1,
  'C10 …and carla''s post stays in it');
select is((select count(*)::int from public.moments where owner_id = 'b2222222-2222-2222-2222-222222222222'), 0,
  'C11 bruno''s moment leaves the feed');
select is((select count(*)::int from public.projects where author_id = 'b2222222-2222-2222-2222-222222222222'), 0,
  'C12 bruno''s project leaves search''s project arm');
select is((select count(*)::int from public.dreams where profile_id = 'b2222222-2222-2222-2222-222222222222'), 0,
  'C13 bruno''s dream is gone for members');
select is((select count(*)::int from public.dreams where profile_id = 'c3333333-3333-3333-3333-333333333333'), 1,
  'C14 …and carla''s dream is not');
select is((select count(*)::int from storage.objects
            where bucket_id = 'avatars' and name like 'b2222222%'), 0,
  'C15 a member cannot read bruno''s avatar object either');
reset role;

-- ── (D) other people's history stays ─────────────────────────────────────────────────────────
-- The row the whole ruling turns on. Full removal was rejected precisely so this stays 1.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.post_comments
            where author_id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'D1 bruno''s reply inside carla''s thread SURVIVES the ban — no holes in her conversation');
select is((select count(*)::int from public.posts
            where id = 'cc000000-0000-0000-0000-000000000001'), 1,
  'D2 …and the thread it lives in is still readable');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.messages
            where sender_id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'D3 carla keeps bruno''s message — a ban is not GDPR erasure (#107)');
reset role;

-- ── (E) the tombstone ────────────────────────────────────────────────────────────────────────
-- Zero rows would be indistinguishable from blocked-or-deleted and would render the generic «·»
-- placeholder. The projection must RESOLVE, and carry nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), 1,
  'E1 get_person_profile still RESOLVES a banned member — otherwise there is no tombstone to draw');
select is((select removed from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), true,
  'E2 …and flags it removed');
select is((select handle from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), null::text,
  'E3 the tombstone carries no handle');
select is((select display_name from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), null::text,
  'E4 the tombstone carries no display name');
select is((select avatar_path from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), null::text,
  'E5 the tombstone carries no avatar');
select is((select founding_member from public.get_person_profile('b2222222-2222-2222-2222-222222222222')), false,
  'E6 a tombstone wears no badges');
select is((select removed from public.get_person_profile('c3333333-3333-3333-3333-333333333333')), false,
  'E7 …while carla still projects as a live member');
select is((select display_name from public.get_person_profile('c3333333-3333-3333-3333-333333333333')), 'Carla',
  'E8 …with her name intact');
reset role;

-- ── (F) the two carve-outs ───────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.profiles where id = 'b2222222-2222-2222-2222-222222222222'), 1,
  'F1 bruno still sees his OWN row — the ban screen has to render');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated","app_metadata":{"role":"admin"}}';
select is((select count(*)::int from public.profiles where handle = 'bruno'), 1,
  'F2 an admin still sees bruno — banning must not blind the panel that banned him (admin.ts:158)');
reset role;

-- ── (G) shape and privilege, not behaviour ───────────────────────────────────────────────────
-- Every assertion above is a read, and a read can come back empty for reasons that have nothing
-- to do with the policy under test. These do not.
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'athanor' and p.proname = 'not_banned'), true,
  'G1 athanor.not_banned is SECURITY DEFINER — banned_at has no client grant');
select is((select provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'athanor' and p.proname = 'not_banned'), 's',
  'G2 …and STABLE, so it is safe in a policy');
select ok(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'athanor' and p.proname = 'not_banned') @> array['search_path=""'],
  'G3 …with a locked search_path');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(p.proacl) ax
    where n.nspname = 'athanor' and p.proname = 'not_banned'
      and ax.grantee = 0 and ax.privilege_type = 'EXECUTE'), 0,
  'G4 PUBLIC holds no EXECUTE on athanor.not_banned');
select ok(has_function_privilege('anon', 'athanor.not_banned(uuid)', 'execute'),
  'G5 anon executes it — the anon shell policy composes it');
select ok(has_function_privilege('authenticated', 'athanor.not_banned(uuid)', 'execute'),
  'G6 authenticated executes it');
select ok(pg_get_function_result('public.get_person_profile(uuid)'::regprocedure) like '%removed boolean%',
  'G7 get_person_profile projects the removed flag');
select ok(not has_function_privilege('anon', 'public.get_person_profile(uuid)', 'execute'),
  'G8 get_person_profile stays members-only after the drop+create re-grant');
-- The predicate is composed into policies that already existed, under their existing names: no
-- policy is added and none is dropped, which is what keeps 0091's counts and every per-table
-- policies_are list passing untouched. If a future edit renames one, this goes red.
select is(
  (select count(*)::int from pg_policies
    where (schemaname, tablename, policyname) in (
      ('public','profiles','profiles_select_anon_public'),
      ('public','profiles','profiles_select_authenticated'),
      ('public','posts','posts_select_authenticated'),
      ('public','moments','moments_select_authenticated'),
      ('public','story_segments','story_segments_select_live'),
      ('public','projects','projects_select_authenticated'),
      ('public','dreams','dreams_select_authenticated'))), 7,
  'G9 all seven recomposed table policies still exist under their original names');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('avatars_select_anon_shell','avatars_select_member',
                         'post-media_select_member','moments_select_member',
                         'story-segments_select_member')), 5,
  'G10 …and all five storage SELECT policies survived the drop+create');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('post_comments','messages','conversations')
      and qual like '%not_banned%'), 0,
  'G11 the ban predicate was NOT composed into post_comments / messages / conversations');

select * from finish();
rollback;
