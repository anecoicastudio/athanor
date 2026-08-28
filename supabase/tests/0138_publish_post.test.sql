-- 0138_publish_post.test.sql — the atomic publish (#588).
--
-- The defect this closes is invisible from the client: `createPost` committed, then
-- `replacePostMedia` ran as a SECOND request, so a media write that failed left a `posts` row
-- whose `type` claimed media with nothing behind it and the card published as silently
-- text-only. `publish_post` is one function, therefore one transaction.
--
-- What these assertions can and cannot see is worth stating, because a function body is always
-- one transaction and no test can tell "one function" from "two functions called inside one".
-- What they CAN pin is the property a future edit would break: a media row that cannot be
-- written takes the post row down with it. An `exception when others` added inside
-- `publish_post` — the shape that looks like resilience — restores #588 exactly, and fails
-- here.

begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

-- two deterministic users (handle_new_user auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- Seeded service-role so the RPC's own behaviour is what is under test:
--   * B owns a post A must never converge onto
--   * A owns a post that has since been soft-deleted
--   * A owns a post with a created_at in the past, so a converge that REPLACED the row instead
--     of updating it would be visible (inside one transaction now() is constant, so the
--     updated_at trigger cannot distinguish them — an old created_at can).
insert into public.posts (id, author_id, category, body, created_at)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'human', 'Il passo di B', now()),
       ('aaaaaaaa-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'human', 'Bozza iniziale',
        '2026-01-01T00:00:00Z');

insert into public.posts (id, author_id, category, body, deleted_at)
values ('cccccccc-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'human', 'Un passo ritirato', now());

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1 — the function, its posture and its EXECUTE surface
-- ─────────────────────────────────────────────────────────────────────────────────────

select has_function('public'::name, 'publish_post'::name, 'publish_post exists');

-- SECURITY INVOKER is the decision, not a detail: DEFINER bypasses RLS, and RLS is where
-- #106's active_write_* net and the soft-delete predicate both live.
select ok(
  (select not prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'publish_post'),
  'publish_post is SECURITY INVOKER — it adds atomicity, not privilege'
);

-- Stored as `search_path=""`, not `search_path=` — 0080's sweep matches it with a LIKE and
-- only polices DEFINER functions, so the exact empty form is asserted here instead.
select is(
  (select proconfig from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'publish_post'),
  array['search_path=""'],
  'publish_post pins an empty search_path — every reference is schema-qualified'
);

select ok(
  has_function_privilege('authenticated',
    'public.publish_post(public.post_category, text, uuid, public.post_type, boolean, text[], jsonb)',
    'EXECUTE'),
  'authenticated may execute publish_post'
);

-- The 'f' default ACL hands every new function to anon and PUBLIC; 0121 pins both allow-lists
-- by name, so a forgotten revoke is a red test there and a reachable write here.
select ok(
  not has_function_privilege('anon',
    'public.publish_post(public.post_category, text, uuid, public.post_type, boolean, text[], jsonb)',
    'EXECUTE'),
  'anon may not execute publish_post'
);

select is_empty(
  $$ select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ax
      where n.nspname = 'public' and p.proname = 'publish_post'
        and ax.privilege_type = 'EXECUTE' and ax.grantee = 0 $$,
  'PUBLIC may not execute publish_post'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2 — the happy paths
-- ─────────────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- A fresh text post. author_id is derived from auth.uid(), never passed.
select is(
  (public.publish_post(
     p_category => 'human',
     p_body     => 'Primo passo',
     p_id       => 'aaaaaaaa-0000-0000-0000-000000000001',
     p_is_step  => true,
     p_tags     => array['inizio']
   ) -> 'post' ->> 'author_id'),
  '11111111-1111-1111-1111-111111111111',
  'author_id is auth.uid(), not a parameter'
);

select is(
  (select is_step from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  true,
  'the scalar parameters reach the row (is_step)'
);

select is(
  (select tags from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  array['inizio'],
  'the tags array reaches the row'
);

select is(
  (select count(*)::int from public.post_media
    where post_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'a text post carries no media rows'
);

-- The same id, now with two images: the post converges and both rows land in one call.
select is(
  jsonb_array_length(
    public.publish_post(
      p_category => 'human',
      p_body     => 'Primo passo, con foto',
      p_id       => 'aaaaaaaa-0000-0000-0000-000000000001',
      p_type     => 'image',
      p_media    => '[{"kind":"image","storage_path":"11111111/p/0.jpg","position":0,"width":1080,"height":1350},
                      {"kind":"image","storage_path":"11111111/p/1.jpg","position":1,"width":1080,"height":1350}]'::jsonb
    ) -> 'media'),
  2,
  'the media set is returned whole'
);

select is(
  (select body from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Primo passo, con foto',
  'a second publish converges the post on the draft as it now stands'
);

-- The converge must UPDATE in place. `subscribeNewPosts` filters `event: 'INSERT'`, so a
-- delete-and-reinsert would re-fire the "Nuovi passi ›" banner for a post the feed already
-- showed (#579). The seeded post's created_at is the only witness that survives one
-- transaction, where now() — and therefore the updated_at trigger — is constant.
select lives_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Bozza ripresa',
       p_id => 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'a publish onto an existing live post converges it'
);

select is(
  (select created_at from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'the converge is an UPDATE — created_at survives, so realtime still sees UPDATE not INSERT'
);

-- A shorter set sweeps the tail the new one does not fill.
select is(
  jsonb_array_length(
    public.publish_post(
      p_category => 'human',
      p_body     => 'Una foto sola',
      p_id       => 'aaaaaaaa-0000-0000-0000-000000000001',
      p_type     => 'image',
      p_media    => '[{"kind":"image","storage_path":"11111111/p/0.jpg","position":0}]'::jsonb
    ) -> 'media'),
  1,
  'a shorter set sweeps the positions it no longer fills'
);

-- And an EMPTY set sweeps them all — the case a caller-side `if (rows.length > 0)` can never
-- see (#586): the member removed every attachment between two taps.
select lives_ok(
  $$ select public.publish_post(
       p_category => 'human',
       p_body     => 'Senza foto, ora',
       p_id       => 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'an empty media set is a publish, not a no-op'
);

select is(
  (select count(*)::int from public.post_media
    where post_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'an empty set removes every remaining row'
);

-- `post_id` in the payload is ignored: the function assigns it, so a row aimed at another
-- member's post is unrepresentable rather than merely refused.
select lives_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Con una riga contrabbandata',
       p_id => 'aaaaaaaa-0000-0000-0000-000000000001', p_type => 'image',
       p_media => '[{"post_id":"bbbbbbbb-0000-0000-0000-000000000001","kind":"image",
                     "storage_path":"11111111/p/smuggled.jpg","position":0}]'::jsonb) $$,
  'a media payload carrying a foreign post_id is accepted'
);

select is(
  (select post_id from public.post_media
    where storage_path = '11111111/p/smuggled.jpg'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  '…and the smuggled post_id is ignored, not honoured'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3 — atomicity: the whole point (#588)
-- ─────────────────────────────────────────────────────────────────────────────────────
-- A clip longer than the 60s bound fails the post_media CHECK. The post row is written FIRST
-- and must not survive it.

select throws_ok(
  $$ select public.publish_post(
       p_category => 'human',
       p_body     => 'Un video troppo lungo',
       p_id       => 'dddddddd-0000-0000-0000-000000000001',
       p_type     => 'video',
       p_media    => '[{"kind":"video","storage_path":"11111111/d/0.mp4","position":0,"duration_s":600}]'::jsonb) $$,
  '23514', null,
  'a media row that violates its CHECK fails the publish'
);

select is(
  (select count(*)::int from public.posts where id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  '#588: a failing media write leaves NO post row behind — no silently text-only card'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4 — the guards that refuse before anything is written
-- ─────────────────────────────────────────────────────────────────────────────────────

select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Due volte la stessa posizione',
       p_id => 'eeeeeeee-0000-0000-0000-000000000001', p_type => 'image',
       p_media => '[{"kind":"image","storage_path":"a.jpg","position":0},
                    {"kind":"image","storage_path":"b.jpg","position":0}]'::jsonb) $$,
  '23505', null,
  'two rows sharing a position are refused with a message about the caller''s set'
);

select is(
  (select count(*)::int from public.posts where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  0,
  'the duplicate-position refusal writes nothing'
);

-- The row cap (#591). `MEDIA_LIMITS.MAX_POST_MEDIA` is 10 and was, until `post_media_position_
-- check` gained an upper bound, a property of the composer screen and nothing else: this
-- function counts the set for duplicates and for the type biconditional, never for its size, so
-- a direct call could attach an unbounded media set to a post the caller genuinely authors.
--
-- What refuses it is the TABLE, not a guard added here — which is the point. The same
-- constraint binds `POST /rest/v1/post_media`, the path no function-level check could ever
-- reach, and it cannot be raced the way a counting trigger could. A CHECK is not
-- privilege-mediated, so these arms are NOT about who calls: 0012 already pins that the table
-- refuses an eleventh row whoever writes it, and a DEFINER rewrite of this function would meet
-- the same 23514.
--
-- What they pin is what 0012 cannot see, because 0012 never calls the function: that
-- `publish_post` meets the refusal by FAILING rather than by absorbing it. An
-- `exception when others` here, or a caller-shaped `limit` on the media payload, would truncate
-- an over-cap set to ten and report success — publishing a card missing the attachments the
-- member watched upload. The `lives_ok` arm is the other half: the RPC must still accept a full
-- ten, so a future guard cannot buy safety by refusing at nine.
select lives_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Dieci allegati',
       p_id => 'eeeeeeee-0000-0000-0000-000000000006', p_type => 'image',
       p_media => (select jsonb_agg(jsonb_build_object(
                            'kind', 'image',
                            'storage_path', '11111111/p6/' || g || '.jpg',
                            'position', g))
                     from generate_series(0, 9) as g)) $$,
  'a ten-row media set publishes — the cap is ten, not nine'
);

select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Undici allegati',
       p_id => 'eeeeeeee-0000-0000-0000-000000000007', p_type => 'image',
       p_media => (select jsonb_agg(jsonb_build_object(
                            'kind', 'image',
                            'storage_path', '11111111/p7/' || g || '.jpg',
                            'position', g))
                     from generate_series(0, 10) as g)) $$,
  '23514', null,
  'an eleven-row media set is refused — the cap binds the RPC path too'
);

select is(
  (select count(*)::int from public.posts where id = 'eeeeeeee-0000-0000-0000-000000000007'),
  0,
  'the over-cap refusal writes nothing — atomicity holds for it as for any other failure'
);

-- The #588 invariant itself: a post is text if and only if it carries no media. Atomicity
-- closes the failure path to a text-only card; this closes the caller-error path to the same
-- card.
select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Tipo immagine, nessuna foto',
       p_id => 'eeeeeeee-0000-0000-0000-000000000002', p_type => 'image') $$,
  '23514', null,
  'a media type with an empty set is refused — that IS the orphan card'
);

select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Tipo testo, con foto',
       p_id => 'eeeeeeee-0000-0000-0000-000000000003', p_type => 'text',
       p_media => '[{"kind":"image","storage_path":"a.jpg","position":0}]'::jsonb) $$,
  '23514', null,
  'a text type with a media set is refused too — the invariant is a biconditional'
);

select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Media non è un array',
       p_id => 'eeeeeeee-0000-0000-0000-000000000004', p_media => '{}'::jsonb) $$,
  '22023', null,
  'p_media must be a json array'
);

select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Una riga senza posizione',
       p_id => 'eeeeeeee-0000-0000-0000-000000000005', p_type => 'image',
       p_media => '[{"kind":"image","storage_path":"a.jpg"}]'::jsonb) $$,
  '23502', null,
  'a media row with no position is refused before the insert, not by the column'
);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5 — who may publish what
-- ─────────────────────────────────────────────────────────────────────────────────────

-- The soft-delete edge, refused deterministically rather than met as a 42501 from
-- post_media_select_authenticated. Republishing into a tombstone is not a converge.
select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Torna in vita',
       p_id => 'cccccccc-0000-0000-0000-000000000001') $$,
  'P0002', null,
  'a converge onto a soft-deleted post is refused'
);

select is(
  (select body from public.posts where id = 'cccccccc-0000-0000-0000-000000000001'),
  'Un passo ritirato',
  'the tombstone is left exactly as it was'
);

-- A colliding id belonging to someone else: posts_update_own carries the ownership predicate
-- in USING as well as WITH CHECK, so it is refused rather than merged.
select throws_ok(
  $$ select public.publish_post(
       p_category => 'human', p_body => 'Rubo il post di B',
       p_id => 'bbbbbbbb-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a post id belonging to another member is refused, not merged'
);

select is(
  (select body from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'Il passo di B',
  'nothing of the other member''s post is changed'
);

-- No session at all: the function's first statement, before any I/O.
set local request.jwt.claims = '';
select throws_ok(
  $$ select public.publish_post(p_category => 'human', p_body => 'Senza sessione') $$,
  '42501', null,
  'publish_post refuses a caller with no auth.uid()'
);

reset role;

select * from finish();
rollback;
