-- 0086_profile_display_name_avatar.test.sql
-- #75 — profiles.display_name / profiles.avatar_path and the private `avatars` bucket.
--
-- Three things have to hold, and only one of them is about the columns existing:
--
--   1. handle_new_user must NORMALISE the name, never trust it. The column carries a CHECK, the
--      value arrives from auth.users.raw_user_meta_data, and a CHECK violation inside that
--      trigger aborts the entire signup — the exact failure 20260810135250 was written to close
--      for `locale`. So the long/blank/absent cases are asserted through a real signup, not by
--      calling the helper.
--   2. The two columns must be client-WRITABLE by their owner, while identity_verified stays
--      client-unwritable. Since 20260617225450 the table-level UPDATE grant is revoked and
--      re-granted per column, so a new column is unwritable until someone remembers to extend
--      that list — and nothing else in the suite would notice.
--   3. The avatars bucket must be as closed as the other four. Asserted the way
--      0014_storage_media_rls does it: predicate SHAPE, then BEHAVIOUR under three JWTs,
--      because `athanor.not_blocked((select auth.uid()))` is a tautology that would pass any
--      text-only check while opening every member's face to someone who blocked them.
--
-- CI-only (hosted lacks pgtap).

begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
-- A owns the avatar, B is an ordinary member, C is blocked by A. The remaining four exercise
-- the normalisation paths through the real signup trigger.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a0860000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'avatar_a@test.athanor',
   '{"locale":"it","display_name":"Marta Bianchi"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0860000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'avatar_b@test.athanor',
   '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0860000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'avatar_c@test.athanor',
   '{"locale":"it"}'::jsonb, now(), now());

insert into public.blocks (blocker_id, blocked_id)
values ('a0860000-0000-0000-0000-000000000001', 'c0860000-0000-0000-0000-000000000003');

-- Real upload layout: avatars = {uid}/{uid}.{ext}. The malformed key must be rejected by the
-- uuid-shaped guard without raising.
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', 'a0860000-0000-0000-0000-000000000001/a0860000-0000-0000-0000-000000000001.jpg',
   'a0860000-0000-0000-0000-000000000001'),
  ('avatars', 'not-a-uuid/avatar.jpg', 'a0860000-0000-0000-0000-000000000001');

-- ── 1. schema shape ───────────────────────────────────────────────────────────────────────
select has_column('public', 'profiles', 'display_name', 'profiles.display_name exists');
select has_column('public', 'profiles', 'avatar_path', 'profiles.avatar_path exists');

select is(
  (select display_name from public.profiles where id = 'a0860000-0000-0000-0000-000000000001'),
  'Marta Bianchi',
  'handle_new_user carries display_name through from raw_user_meta_data'
);

select is(
  (select display_name from public.profiles where id = 'b0860000-0000-0000-0000-000000000002'),
  null,
  'a signup with no name at all lands a NULL display_name, not an empty string'
);

-- ── 2. normalisation — none of these may abort a signup ───────────────────────────────────
-- An OAuth provider sends `full_name` or `name`, never `display_name`. Without the coalesce a
-- Google signup would land nameless for no reason other than key spelling.
select lives_ok(
  $$ insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', 'd0860000-0000-0000-0000-000000000004',
             'authenticated', 'authenticated', 'avatar_d@test.athanor',
             '{"locale":"en","full_name":"Vera Lombardi"}'::jsonb, now(), now()) $$,
  'a signup carrying full_name instead of display_name succeeds'
);
select is(
  (select display_name from public.profiles where id = 'd0860000-0000-0000-0000-000000000004'),
  'Vera Lombardi',
  'full_name is used when display_name is absent (OAuth key spelling)'
);

select lives_ok(
  $$ insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', 'e0860000-0000-0000-0000-000000000005',
             'authenticated', 'authenticated', 'avatar_e@test.athanor',
             '{"locale":"en","name":"Rocco Esposito"}'::jsonb, now(), now()) $$,
  'a signup carrying name instead of display_name succeeds'
);
select is(
  (select display_name from public.profiles where id = 'e0860000-0000-0000-0000-000000000005'),
  'Rocco Esposito',
  'name is used when display_name and full_name are both absent'
);

-- THE load-bearing one: the column CHECK caps at 60, and an over-long provider value must be
-- truncated rather than raise 23514 and take the whole signup down with it.
select lives_ok(
  $$ insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', 'f0860000-0000-0000-0000-000000000006',
             'authenticated', 'authenticated', 'avatar_f@test.athanor',
             jsonb_build_object('locale', 'it', 'display_name', repeat('x', 200)), now(), now()) $$,
  'a 200-character provider name does NOT abort signup'
);
select is(
  (select char_length(display_name) from public.profiles
     where id = 'f0860000-0000-0000-0000-000000000006'),
  60,
  'an over-long name is truncated to the CHECK ceiling, not rejected'
);

-- Whitespace-only is a name the form can produce and the CHECK would reject (btrim length 0).
select lives_ok(
  $$ insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', '10860000-0000-0000-0000-000000000007',
             'authenticated', 'authenticated', 'avatar_g@test.athanor',
             '{"locale":"it","display_name":"   "}'::jsonb, now(), now()) $$,
  'a whitespace-only name does NOT abort signup'
);
select is(
  (select display_name from public.profiles where id = '10860000-0000-0000-0000-000000000007'),
  null,
  'a whitespace-only name collapses to NULL'
);

-- ── 3. column grants — writable by the owner, and only these two ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0860000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ update public.profiles
        set display_name = 'Marta B.',
            avatar_path  = 'a0860000-0000-0000-0000-000000000001/a0860000-0000-0000-0000-000000000001.jpg'
      where id = 'a0860000-0000-0000-0000-000000000001' $$,
  'a member writes their own display_name and avatar_path'
);

-- Regression guard on the per-column grant list: adding columns must not have re-opened the
-- table-level UPDATE that 20260617225450 revoked.
select throws_ok(
  $$ update public.profiles set identity_verified = true
      where id = 'a0860000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'identity_verified is still client-unwritable after the new grants'
);

-- ── the client write path is the ONLY reason these constraints exist ──────────────────────
-- The signup trigger normalises its input, so nothing it produces can violate them. The grant
-- above lets a member write both columns directly, unnormalised — so the constraints have to
-- hold against a hostile UPDATE, and that is what is exercised here.

-- Impersonation: the bucket policies bind an object's folder to its uploader, but nothing bound
-- the COLUMN, and the read policy is members-wide. Pointing avatar_path at another member's
-- object would wear their face everywhere a name and photo are rendered.
select throws_ok(
  $$ update public.profiles
        set avatar_path = 'b0860000-0000-0000-0000-000000000002/b0860000-0000-0000-0000-000000000002.jpg'
      where id = 'a0860000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a member cannot point avatar_path at another member''s avatar object'
);
select lives_ok(
  $$ update public.profiles
        set avatar_path = 'a0860000-0000-0000-0000-000000000001/a0860000-0000-0000-0000-000000000001.jpg'
      where id = 'a0860000-0000-0000-0000-000000000001' $$,
  'a member can point avatar_path at their own avatar object'
);

-- btrim() defaults to stripping spaces only, so a trimmed-length bound alone lets a padded
-- string of any size through — the unbounded name the CHECK exists to prevent.
select throws_ok(
  $$ update public.profiles set display_name = repeat(' ', 5000) || 'x'
      where id = 'a0860000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a space-padded 5001-character name is rejected (raw length is bounded too)'
);
-- And a name made only of tabs/newlines does not trim to empty under the default btrim, so it
-- would store non-null and render as a blank where a name should be.
select throws_ok(
  $$ update public.profiles set display_name = E'\t\n\r'
      where id = 'a0860000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a whitespace-only name is rejected on the client write path'
);

set local request.jwt.claims = '{"sub":"b0860000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.profiles
     where id = 'a0860000-0000-0000-0000-000000000001' and display_name = 'Marta B.'),
  1,
  'another member reads the name (it renders on the person card)'
);

-- READ grants, explicitly. 20260807170813 column-scoped the authenticated SELECT grant on
-- profiles down to the non-sensitive set and routes the rest through DEFINER accessors, so a
-- column added afterwards is unreadable by every client until it is deliberately placed in one
-- tier or the other — and the failure is a flat 42501 on any select that so much as names it in
-- a WHERE. These two belong in the direct tier with handle: identity surface, not profile
-- content. Asserted as grants and not only through the behavioural read above, because the
-- behavioural one fails for several reasons and this says which.
select lives_ok(
  $$ select display_name, avatar_path from public.profiles
      where id = 'a0860000-0000-0000-0000-000000000001' $$,
  'a member can SELECT display_name and avatar_path by name'
);

reset role;

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'SELECT'),
  'authenticated holds column SELECT on both new columns'
);

-- anon holds (id, handle, visibility, updated_at) for the public @handle pages. A name and a
-- face there would publish every member's photograph to the unauthenticated internet, which
-- needs the visibility gate first — so their absence is the assertion.
select ok(
  not has_column_privilege('anon', 'public.profiles', 'display_name', 'SELECT')
  and not has_column_privilege('anon', 'public.profiles', 'avatar_path', 'SELECT'),
  'anon holds NO select on the name or the avatar (deliberate — see 20260811074859)'
);

-- ── 4. bucket metadata ────────────────────────────────────────────────────────────────────
select is(
  (select public from storage.buckets where id = 'avatars'),
  false,
  'avatars bucket is private (a public bucket makes every face enumerable by uid)'
);
select is(
  (select file_size_limit from storage.buckets where id = 'avatars'),
  5242880::bigint,
  'avatars file_size_limit = 5242880 (5 MiB, not the 50 MiB the media buckets allow)'
);
select ok(
  (select 'image/webp' = any(allowed_mime_types) from storage.buckets where id = 'avatars'),
  'avatars allowed_mime_types contains image/webp'
);
select ok(
  (select not ('video/mp4' = any(allowed_mime_types)) from storage.buckets where id = 'avatars'),
  'avatars allowed_mime_types excludes video/mp4'
);

-- ── 5. policy shape (same assertions 0014 makes, applied to this bucket) ──────────────────
select set_eq(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars\_%' $$,
  $$ values ('avatars_insert_own'), ('avatars_update_own'),
            ('avatars_delete_own'), ('avatars_select_member') $$,
  'exactly the four avatars policies exist on storage.objects'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars\_%'
        and roles <> '{authenticated}'::name[] $$,
  'every avatars policy is TO authenticated only (never PUBLIC)'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars\_%'
        and ( btrim(coalesce(qual, ''))       in ('true', '(true)')
           or btrim(coalesce(with_check, '')) in ('true', '(true)') ) $$,
  'no avatars policy has a bare `true` predicate'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars\_%'
        and coalesce(qual, '') || ' ' || coalesce(with_check, '') not like '%bucket_id = ''avatars''%' $$,
  'every avatars policy pins bucket_id to its own bucket'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('avatars_insert_own', 'avatars_update_own', 'avatars_delete_own')
        and not ( coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%auth.uid()%'
              and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%storage.foldername%' ) $$,
  'every avatars owner-write policy binds auth.uid() to the first path segment'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars\_%'
        and replace(replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                            '( SELECT auth.uid() AS uid)', 'WRAPPED'),
                    '(select auth.uid())', 'WRAPPED') like '%auth.uid()%' $$,
  'auth.uid() is always the wrapped (select auth.uid()) form'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars\_%' and cmd = 'UPDATE'
        and (qual is null or with_check is null) $$,
  'the avatars UPDATE policy carries both USING and WITH CHECK'
);

-- not_blocked must be applied to the OBJECT'S OWNER, derived from the path — applied to the
-- caller's own uid it is a tautology (blocks_no_self) and the read policy is open again.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'avatars_select_member'
        and qual not like '%not_blocked(((storage.foldername(name))[1])::uuid)%' $$,
  'the avatars read policy gates on not_blocked(owner-from-path), not the caller''s own uid'
);

select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'avatars_select_member'
        and qual not like '%[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}%' $$,
  'the avatars read policy uuid-shape-guards the path segment before casting it'
);

-- ── 6. BEHAVIOUR: who can actually read the bytes ─────────────────────────────────────────
set local role authenticated;

set local request.jwt.claims = '{"sub":"a0860000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'avatars' and name like 'a0860000-%'),
  1, 'owner reads their own avatar object'
);

set local request.jwt.claims = '{"sub":"b0860000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'avatars' and name like 'a0860000-%'),
  1, 'a member who has not been blocked reads another member''s avatar'
);
select lives_ok(
  $$ select count(*) from storage.objects where bucket_id = 'avatars' $$,
  'a malformed (non-uuid) first path segment does not raise inside the USING clause'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'avatars' and name = 'not-a-uuid/avatar.jpg'),
  0, 'an avatar whose first path segment is not a uuid is unreadable'
);

-- Writing into someone else's folder is the whole point of the owner-write predicate. INSERT is
-- the obvious one; UPDATE and DELETE matter just as much, because overwriting or deleting
-- another member's face needs no read access at all.
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('avatars', 'a0860000-0000-0000-0000-000000000001/a0860000-0000-0000-0000-000000000001.png') $$,
  '42501', null,
  'a member cannot write into another member''s avatar folder'
);
-- Bare statements, then assert the object is unchanged. A data-modifying CTE cannot sit inside
-- a scalar subquery ("WITH clause containing a data-modifying statement must be at the top
-- level"), and RLS answers a non-matching UPDATE/DELETE by affecting zero rows rather than
-- raising — so the evidence is that the row survived, not that the statement threw.
-- B can already see this object (asserted above), so a surviving row is a real denial and not
-- an invisible one.
update storage.objects set name = name || '.hijacked'
 where bucket_id = 'avatars' and name like 'a0860000-%';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'avatars' and name like '%.hijacked'),
  0,
  'a member cannot rename another member''s avatar object (UPDATE policy denies)'
);

-- The DELETE policy gets no behavioural assertion, and cannot have one: this Storage version
-- raises `Direct deletion from storage tables is not allowed. Use the Storage API instead.`
-- from a trigger that fires ahead of RLS, so a pgTAP DELETE aborts the file rather than being
-- denied by the policy under test. Its shape is covered above with the other two owner-write
-- policies (auth.uid() bound to the first path segment, wrapped form, bucket pinned).

set local request.jwt.claims = '{"sub":"c0860000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'avatars' and name like 'a0860000-%'),
  0, 'a blocked member cannot read the blocker''s avatar'
);

reset role;

-- ── 7. the metadata strip covers avatars ──────────────────────────────────────────────────
-- 20260703154523 shipped the trigger with four buckets and called avatars a "future one-line
-- WHEN extension". A face photo straight off a phone carries GPS in EXIF, so this is the
-- bucket that most needs the backstop.
select ok(
  (select pg_get_triggerdef(t.oid) like '%avatars%'
     from pg_trigger t
    where t.tgname = 'media_process_enqueue' and t.tgrelid = 'storage.objects'::regclass),
  'the media_process_enqueue WHEN clause covers the avatars bucket'
);

select * from finish();
rollback;
