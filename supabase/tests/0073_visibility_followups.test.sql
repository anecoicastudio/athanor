-- M10 visibility follow-ups (migration 20260807174758): matcher privacy filtering,
-- DEFINER helper lockdown, owner's tappe under a soft-deleted dream, realtime
-- publication column list.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000073','authenticated','authenticated','a73@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000073','authenticated','authenticated','b73@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000073','authenticated','authenticated','c73@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000073','authenticated','authenticated','d73@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
-- A: recipient. B: matching tags, dream PRIVATE. C: matching tags, tags PRIVATE.
-- D: matching tags, all defaults ⇒ the only legitimate proposal for A.
update public.profiles set identity_tags=array['design'], seeking=array['music'], locale='it'
  where id='aaaaaaaa-0000-4000-8000-000000000073';
update public.profiles set identity_tags=array['music'], seeking=array['design'], locale='it',
  visibility='{"dream":"private"}'::jsonb
  where id='bbbbbbbb-0000-4000-8000-000000000073';
update public.profiles set identity_tags=array['music'], seeking=array['design'], locale='it',
  visibility='{"identity_tags":"private","seeking":"private"}'::jsonb
  where id='cccccccc-0000-4000-8000-000000000073';
update public.profiles set identity_tags=array['music'], seeking=array['design'], locale='it'
  where id='dddddddd-0000-4000-8000-000000000073';

insert into public.dreams (profile_id, text) values
  ('aaaaaaaa-0000-4000-8000-000000000073','Sogno A'),
  ('bbbbbbbb-0000-4000-8000-000000000073','Sogno B'),
  ('cccccccc-0000-4000-8000-000000000073','Sogno C'),
  ('dddddddd-0000-4000-8000-000000000073','Sogno D');

-- Isolate the matcher's global pool to the four fixtures (0028 precedent).
update public.dreams set status='archived'
  where profile_id not in (
    'aaaaaaaa-0000-4000-8000-000000000073','bbbbbbbb-0000-4000-8000-000000000073',
    'cccccccc-0000-4000-8000-000000000073','dddddddd-0000-4000-8000-000000000073')
    and status='active' and deleted_at is null;

select ok(public.run_momenti_matcher() >= 1, 'matcher runs');

select is(
  (select count(*) from public.momento_proposals
    where user_id='aaaaaaaa-0000-4000-8000-000000000073'
      and candidate_id='bbbbbbbb-0000-4000-8000-000000000073'),
  0::bigint,
  'private dream keeps a candidate out of the deck'
);
select is(
  (select count(*) from public.momento_proposals
    where user_id='aaaaaaaa-0000-4000-8000-000000000073'
      and candidate_id='cccccccc-0000-4000-8000-000000000073'),
  0::bigint,
  'private identity_tags/seeking ⇒ affinity 0 ⇒ no match (intended privacy trade)'
);
select is(
  (select count(*) from public.momento_proposals
    where user_id='aaaaaaaa-0000-4000-8000-000000000073'
      and candidate_id='dddddddd-0000-4000-8000-000000000073'),
  1::bigint,
  'default-visibility candidate is still proposed'
);
reset role;

-- ── DEFINER helper lockdown ─────────────────────────────────────────────────
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='athanor' and p.proname in ('field_visible','profile_search_text','visible_bio','owns_dream','not_blocked')
      and p.proconfig @> array['search_path=""']),
  5::bigint,
  'every athanor helper pins an empty search_path'
);

set local role anon;
select throws_ok(
  $$ select athanor.profile_search_text('aaaaaaaa-0000-4000-8000-000000000073') $$,
  '42501', null, 'anon cannot execute profile_search_text'
);
select throws_ok(
  $$ select athanor.visible_bio('aaaaaaaa-0000-4000-8000-000000000073') $$,
  '42501', null, 'anon cannot execute visible_bio'
);
select throws_ok(
  $$ select athanor.owns_dream('00000000-0000-0000-0000-000000000000') $$,
  '42501', null, 'anon cannot execute owns_dream'
);
reset role;

-- the new auth.uid() guard itself: authenticated role, no JWT claims → no caller
set local role authenticated;
select is(
  (select athanor.profile_search_text('aaaaaaaa-0000-4000-8000-000000000073')),
  null,
  'profile_search_text returns NULL when there is no auth.uid()'
);
reset role;

-- blocked peers get nothing from the search helpers even called directly
set local role service_role;
insert into public.blocks (blocker_id, blocked_id)
  values ('aaaaaaaa-0000-4000-8000-000000000073','dddddddd-0000-4000-8000-000000000073');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dddddddd-0000-4000-8000-000000000073","role":"authenticated"}';
select is(
  (select athanor.profile_search_text('aaaaaaaa-0000-4000-8000-000000000073')),
  null,
  'blocked peer gets NULL search text (no oracle for a direct caller)'
);
select is(
  (select athanor.visible_bio('aaaaaaaa-0000-4000-8000-000000000073')),
  null,
  'blocked peer gets NULL bio from visible_bio'
);
reset role;

-- ── owner keeps tappe of a soft-deleted dream ───────────────────────────────
set local role service_role;
insert into public.dream_milestones (id, dream_id, body)
  select 'eeeeeeee-0000-4000-8000-000000000073', d.id, 'Tappa di A'
  from public.dreams d where d.profile_id='aaaaaaaa-0000-4000-8000-000000000073' limit 1;
update public.dreams set deleted_at = now()
  where profile_id='aaaaaaaa-0000-4000-8000-000000000073';
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000073","role":"authenticated"}';
select is(
  (select count(*) from public.dream_milestones where id='eeeeeeee-0000-4000-8000-000000000073'),
  1::bigint,
  'owner still reads own tappe under a soft-deleted dream'
);
reset role;

-- ── realtime publication carries only the granted columns ───────────────────
-- Defense in depth: this Realtime version DOES filter payload columns by
-- has_column_privilege, so the column list is a second lock on the same door,
-- not the only one (the migration header overstates the risk — see 0072 for the
-- grant that is the primary control).
select bag_eq(
  $$ select unnest(attnames) from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='profiles' $$,
  $$ values ('id'),('handle'),('founding_member'),('identity_verified'),('created_at'),('updated_at') $$,
  'profiles realtime payload exposes only the authenticated-granted columns'
);

select * from finish();
rollback;
