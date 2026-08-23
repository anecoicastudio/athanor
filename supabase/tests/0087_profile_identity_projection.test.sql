-- 0087_profile_identity_projection.test.sql
-- #76 — the four fixed-projection accessors must hand `display_name` and `avatar_path` on.
--
-- 20260811074859 put both columns in the DIRECT grant tier, so `select display_name from
-- profiles` already works for any member. That is precisely why this file exists: the columns
-- being READABLE proves nothing about the accessors, because each of these projects a FIXED
-- column list and a column it does not name stays invisible to a caller who is fully allowed to
-- read it. Nothing else in the suite would catch that — the grant tests pass either way.
--
-- What each case pins:
--   1. get_person_profile — the third-person hero, PostAuthorRow ×6, AttendeeStack. Also that
--      widening it did not weaken it: bio stays visibility-gated and a blocked pair stays blind.
--   2. get_momenti_suggestion — «Ti potrebbe interessare», where the peer is a stranger and the
--      face is the whole point of the row.
--   3. search_connections — INVOKER, so this doubles as proof the direct grant reaches a plain
--      join and nothing needed elevating.
--   4. search_all — person-arm only. The project/event arms must stay NULL, or a polymorphic
--      row would claim an identity it does not have.
--   5. favor_needs — a view, replaced rather than dropped, so its security_invoker option has to
--      survive the replace. An invoker view that silently became a definer view would hand every
--      caller rows the underlying RLS would have refused.
--
-- CI-only (hosted lacks pgtap).

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
-- ME is the caller. TARGET carries a name and an avatar and is connected to ME. HIDDEN carries
-- both too but has blocked ME — every accessor must stay blind to them.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11110000-0000-4000-8000-000000000087',
   'authenticated','authenticated','me87@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','22220000-0000-4000-8000-000000000087',
   'authenticated','authenticated','target87@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','33330000-0000-4000-8000-000000000087',
   'authenticated','authenticated','hidden87@test.athanor','{}'::jsonb, now(), now());

set local role service_role;

update public.profiles
   set handle = 'me87'
 where id = '11110000-0000-4000-8000-000000000087';

-- bio private on purpose: widening the projection must not have loosened the visibility gate
-- that sits beside the two new columns.
update public.profiles
   set handle = 'target87',
       display_name = 'Marta Bianchi',
       avatar_path = '22220000-0000-4000-8000-000000000087/22220000-0000-4000-8000-000000000087.jpg',
       bio = 'biografia riservata',
       visibility = '{"bio":"private"}'::jsonb
 where id = '22220000-0000-4000-8000-000000000087';

update public.profiles
   set handle = 'hidden87',
       display_name = 'Nascosta',
       avatar_path = '33330000-0000-4000-8000-000000000087/33330000-0000-4000-8000-000000000087.jpg'
 where id = '33330000-0000-4000-8000-000000000087';

insert into public.blocks (blocker_id, blocked_id)
values ('33330000-0000-4000-8000-000000000087','11110000-0000-4000-8000-000000000087');

-- Dream + open milestone: feeds both get_momenti_suggestion and favor_needs.
-- HIDDEN gets a NEWER dream than TARGET on purpose: the suggestion orders by dream recency, so
-- if the block predicate were lost the blocker would win the race and the exclusion case below
-- would be answering about an empty pool instead of about the block.
insert into public.dreams (profile_id, text, created_at)
values
  ('22220000-0000-4000-8000-000000000087','Sogno di Marta', now() - interval '1 day'),
  ('33330000-0000-4000-8000-000000000087','Sogno nascosto', now());

insert into public.dream_milestones (dream_id, body)
select d.id, 'Serve una mano con il laboratorio'
  from public.dreams d
 where d.profile_id = '22220000-0000-4000-8000-000000000087';

-- Ordered pair — connections_ordered_pair requires profile_a < profile_b.
insert into public.connections (profile_a, profile_b)
values ('11110000-0000-4000-8000-000000000087','22220000-0000-4000-8000-000000000087');

-- Isolate the suggestion pool the way 0075 does: seeded dreamers would otherwise win the
-- recency race and the RPC returns exactly one row.
update public.dreams set status = 'archived'
 where profile_id not in ('22220000-0000-4000-8000-000000000087',
                          '33330000-0000-4000-8000-000000000087')
   and status = 'active' and deleted_at is null;

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11110000-0000-4000-8000-000000000087","role":"authenticated"}';

-- ── 1. get_person_profile ─────────────────────────────────────────────────────────────────
select is(
  (select display_name from public.get_person_profile('22220000-0000-4000-8000-000000000087')),
  'Marta Bianchi',
  'get_person_profile projects display_name'
);

select is(
  (select avatar_path from public.get_person_profile('22220000-0000-4000-8000-000000000087')),
  '22220000-0000-4000-8000-000000000087/22220000-0000-4000-8000-000000000087.jpg',
  'get_person_profile projects avatar_path'
);

select is(
  (select bio from public.get_person_profile('22220000-0000-4000-8000-000000000087')),
  null,
  'a private bio is still masked — the wider projection did not loosen the visibility gate'
);

select is(
  (select handle from public.get_person_profile('22220000-0000-4000-8000-000000000087')),
  'target87',
  'the handle is unchanged — @handle stays the identity the name enriches'
);

select is(
  (select count(*)::int from public.get_person_profile('33330000-0000-4000-8000-000000000087')),
  0,
  'a member who blocked the caller exposes neither a name nor a face'
);

-- ── 2. get_momenti_suggestion ─────────────────────────────────────────────────────────────
-- Two arms since #124, and BOTH have to carry the projection. The four cases below exercise
-- the COLD-START arm — no momento_suggestions row exists for ME, so the function falls back to
-- the dream-recency query it used to be in full; the ranked arm is exercised after them, off a
-- planted row. A fixed projection can rot on one arm without the other noticing, which is this
-- whole file's premise.
select is(
  (select display_name from public.get_momenti_suggestion()),
  'Marta Bianchi',
  'get_momenti_suggestion carries the peer''s display_name'
);

select is(
  (select avatar_path from public.get_momenti_suggestion()),
  '22220000-0000-4000-8000-000000000087/22220000-0000-4000-8000-000000000087.jpg',
  'get_momenti_suggestion carries the peer''s avatar_path'
);

select is(
  (select dream_text from public.get_momenti_suggestion()),
  'Sogno di Marta',
  'the suggestion still carries the dream text it existed to deliver'
);

select is(
  (select count(*)::int from public.get_momenti_suggestion(
     array['22220000-0000-4000-8000-000000000087']::uuid[])),
  0,
  'a member who blocked the caller is still not suggested, newer dream or not'
);

-- The RANKED arm (#124): a planted momento_suggestions row must project the same five columns
-- plus the reason kinds. `reasons` is the sixth column and the only one the client renders as
-- copy, so it is checked by value; `affinity` is deliberately not in the OUT list at all.
reset role;
set local role service_role;
insert into public.momento_suggestions (user_id, candidate_id, affinity, reasons, computed_on, rank)
values ('11110000-0000-4000-8000-000000000087','22220000-0000-4000-8000-000000000087',
        3, array['skills','city'], (now() at time zone 'utc')::date, 1);
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11110000-0000-4000-8000-000000000087","role":"authenticated"}';

select results_eq(
  $$ select candidate_id, display_name, avatar_path, dream_text
       from public.get_momenti_suggestion() $$,
  $$ values ('22220000-0000-4000-8000-000000000087'::uuid, 'Marta Bianchi'::text,
             '22220000-0000-4000-8000-000000000087/22220000-0000-4000-8000-000000000087.jpg'::text,
             'Sogno di Marta'::text) $$,
  'the ranked arm carries the same name, face and dream the recency arm does'
);

select is(
  (select reasons from public.get_momenti_suggestion()),
  array['skills','city'],
  'and the reason kinds the row was written with — the chip stops saying «Sogno nuovo» by default'
);

-- ── 3. search_connections (SECURITY INVOKER) ──────────────────────────────────────────────
select is(
  (select peer_display_name from public.search_connections()),
  'Marta Bianchi',
  'search_connections resolves the peer''s display_name through a plain join'
);

select is(
  (select peer_avatar_path from public.search_connections()),
  '22220000-0000-4000-8000-000000000087/22220000-0000-4000-8000-000000000087.jpg',
  'search_connections resolves the peer''s avatar_path'
);

select is(
  (select peer_handle from public.search_connections('target')),
  'target87',
  'search still matches on handle, not on the name'
);

select is(
  (select count(*)::int from public.search_connections('Marta')),
  0,
  'a name is not searchable — it is neither unique nor stable, and #76 did not make it a key'
);

-- ── 4. search_all — person arm only ───────────────────────────────────────────────────────
select is(
  (select display_name from public.search_all('target87', 'people')),
  'Marta Bianchi',
  'the person arm of search_all carries display_name'
);

select is(
  (select avatar_path from public.search_all('target87', 'people')),
  '22220000-0000-4000-8000-000000000087/22220000-0000-4000-8000-000000000087.jpg',
  'the person arm of search_all carries avatar_path'
);

select is(
  (select title from public.search_all('target87', 'people')),
  'target87',
  'title is still the handle — the name is an extra column, not a replacement'
);

select has_column('public', 'favor_needs', 'target_display_name',
  'favor_needs exposes the target''s display_name');
select has_column('public', 'favor_needs', 'target_avatar_path',
  'favor_needs exposes the target''s avatar_path');

select is(
  (select target_display_name from public.favor_needs
    where target_id = '22220000-0000-4000-8000-000000000087'),
  'Marta Bianchi',
  'favor_needs carries the name of the member whose need it is'
);

reset role;

-- ── 5. the replaced view kept its invoker semantics ───────────────────────────────────────
-- `create or replace view` does NOT carry the reloptions forward on its own; they are part of
-- the definition. A view that silently became security_definer would hand every caller rows the
-- underlying RLS refused — a wider leak than the columns this migration added.
select ok(
  (select 'security_invoker=true' = any (c.reloptions)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'favor_needs'),
  'favor_needs is still security_invoker after the replace'
);

select * from finish();
rollback;
