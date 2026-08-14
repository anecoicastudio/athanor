-- 0101_public_handle_shell.test.sql
-- #251 — the default public shell (migration 20260814151601).
--
-- The ruling: handle + display_name + avatar_path are anon-readable BY DEFAULT through the
-- `identity` visibility facet; a member may set identity:'members' and the whole row goes
-- anon-dark (control beats the default, the dead link is accepted). Four properties carry it:
--
--   1. A plain signup lands the default map — the shell is opt-OUT, not opt-in.
--   2. identity:'members' hides the ROW, not just the columns — the role-wide column grant
--      cannot leak name/face through a row made reachable by some OTHER public facet. This is
--      the assertion that forced the row policy onto the identity facet alone.
--   3. An absent identity key (an older client replacing the whole map) falls back to
--      'public' — the DEFAULT — never to an accidental opt-out.
--   4. The storage read mirrors the row policy: anon signs a shell member's avatar and
--      nobody else's.
--
-- The flips this migration forced in older tests: 0001 (anon signup count 0→2),
-- 0007 (reachability now keys on the identity facet), 0086 (anon column grant + fifth
-- avatars policy). CI-only (hosted lacks pgtap).

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
-- S = untouched default (the shell case). M = explicit opt-out with OTHER facets public —
-- the leak probe. F = a map written without an identity key (old-client whole-map replace).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1010000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'shell_s@test.athanor',
   '{"locale":"it","display_name":"Sara Shell"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1010000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'optout_m@test.athanor',
   '{"locale":"it","display_name":"Marco Opt-out"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1010000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'legacy_f@test.athanor',
   '{"locale":"it"}'::jsonb, now(), now());

-- ── 1. the default map, through the real signup path ──────────────────────────────────────
select is(
  (select visibility from public.profiles where id = 'a1010000-0000-0000-0000-000000000001'),
  '{"identity": "public"}'::jsonb,
  'a plain signup lands visibility = {identity: public} — the shell is the default'
);

-- S keeps the default and adds dream:'public' (|| preserves the identity key); M opts the
-- identity facet out while holding bio+dream public; F simulates an old client replacing the
-- whole map without an identity entry.
update public.profiles set handle = 'shell_s',
  avatar_path = 'a1010000-0000-0000-0000-000000000001/a1010000-0000-0000-0000-000000000001.jpg',
  visibility = visibility || '{"dream": "public"}'::jsonb
  where id = 'a1010000-0000-0000-0000-000000000001';
update public.profiles set handle = 'optout_m', bio = 'Bio M',
  avatar_path = 'b1010000-0000-0000-0000-000000000002/b1010000-0000-0000-0000-000000000002.jpg',
  visibility = '{"identity": "members", "bio": "public", "dream": "public"}'::jsonb
  where id = 'b1010000-0000-0000-0000-000000000002';
update public.profiles set handle = 'legacy_f',
  visibility = '{"bio": "members"}'::jsonb
  where id = 'c1010000-0000-0000-0000-000000000003';

insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', 'a1010000-0000-0000-0000-000000000001/a1010000-0000-0000-0000-000000000001.jpg',
   'a1010000-0000-0000-0000-000000000001'),
  ('avatars', 'b1010000-0000-0000-0000-000000000002/b1010000-0000-0000-0000-000000000002.jpg',
   'b1010000-0000-0000-0000-000000000002'),
  ('avatars', 'not-a-uuid/avatar.jpg', 'a1010000-0000-0000-0000-000000000001');

-- dreams as their owners (RLS insert-own), so the dream-combo assertions run against real rows
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1010000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('a1010000-0000-0000-0000-000000000001', 'Sogno di S');
set local request.jwt.claims = '{"sub":"b1010000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.dreams (profile_id, text)
  values ('b1010000-0000-0000-0000-000000000002', 'Sogno di M');
reset role;

-- ── 2. the anon shell ─────────────────────────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '';

select results_eq(
  $$ select handle, display_name, avatar_path from public.profiles where handle = 'shell_s' $$,
  $$ values ('shell_s', 'Sara Shell',
             'a1010000-0000-0000-0000-000000000001/a1010000-0000-0000-0000-000000000001.jpg') $$,
  'anon reads exactly the shell of a default member: handle, name, avatar key'
);

-- Content facets stay behind the grant boundary no matter what the visibility map says.
select throws_ok(
  $$ select bio from public.profiles $$,
  '42501', null, 'anon cannot read bio — even M''s, whose map says bio:public'
);
select throws_ok(
  $$ select mission from public.profiles $$,
  '42501', null, 'anon cannot read mission (#149 content facet, never in the shell)'
);

-- THE leak probe (property 2). M holds bio:'public' and dream:'public' — under the old
-- any-key-public reachability that row would be anon-visible and the role-wide column grant
-- would hand out name and face against M's explicit identity:'members'. The row must be gone.
select is(
  (select count(*)::int from public.profiles where handle = 'optout_m'),
  0,
  'identity:members hides the whole row even when other facets are public — no name/face leak'
);

-- Property 3: F's map has no identity key at all — reachable, because absent = the default.
select results_eq(
  $$ select handle from public.profiles order by handle $$,
  $$ values ('legacy_f'), ('shell_s') $$,
  'an identity-less map falls back to public (old-client whole-map replace keeps the shell)'
);

-- Dream combo, both directions. S: dream:public + shell ⇒ visible. M: dream:public but
-- identity:members ⇒ the dreams anon policy reaches M's profile row THROUGH profiles RLS and
-- finds nothing — the dead link takes the dream quote with it, deliberately (migration §2).
select results_eq(
  $$ select text from public.dreams $$,
  $$ values ('Sogno di S') $$,
  'a shell member''s public dream stays anon-readable'
);
select is(
  (select count(*)::int from public.dreams
     where profile_id = 'b1010000-0000-0000-0000-000000000002'),
  0,
  'identity:members takes the public dream anon-dark too (the page it rendered on is dead)'
);

-- ── 3. storage mirrors the row policy (property 4) ────────────────────────────────────────
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'avatars' and name like 'a1010000-%'),
  1, 'anon reads a shell member''s avatar object (the #288 grant-half)'
);
select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'avatars' and name like 'b1010000-%'),
  0, 'anon cannot read an opted-out member''s avatar object'
);
select lives_ok(
  $$ select count(*) from storage.objects where bucket_id = 'avatars' $$,
  'a malformed (non-uuid) first path segment does not raise inside the anon USING clause'
);

reset role;

-- ── 4. members-side reads are untouched ───────────────────────────────────────────────────
-- The identity facet gates the ANON shell only: a signed-in member still sees M's name.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1010000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select display_name from public.profiles where handle = 'optout_m'),
  'Marco Opt-out',
  'identity:members does not hide the name from signed-in members (anon-only gate)'
);
reset role;

-- ── 5. predicate shape — a revert of either policy must fail loudly ───────────────────────
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'public' and tablename = 'profiles'
        and policyname = 'profiles_select_anon_public'
        and qual not like '%identity%' $$,
  'profiles anon reachability keys on the identity facet'
);
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'avatars_select_anon_shell'
        and qual not like '%identity%' $$,
  'the anon avatar read keys on the identity facet'
);

select * from finish();
rollback;
