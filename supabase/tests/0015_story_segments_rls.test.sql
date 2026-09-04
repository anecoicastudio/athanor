begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- two deterministic users (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- 1. schema: table exists
select has_table('public'::name, 'story_segments'::name, 'story_segments table exists');

-- 2. schema: RLS enabled
select ok(
  (select relrowsecurity from pg_class where oid = 'public.story_segments'::regclass),
  'RLS enabled on story_segments'
);

-- 3. exactly the three expected policies
select policies_are(
  'public'::name, 'story_segments'::name,
  array['story_segments_select_live', 'story_segments_insert_own', 'story_segments_update_own',
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'exactly the expected policies on story_segments'
);

-- 4. anon is denied entirely (no grant)
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.story_segments $$,
  '42501', null, 'anon cannot read story_segments'
);
reset role;

-- 5. owner A inserts own live segment → lives_ok
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.story_segments (id, author_id, kind, storage_path)
     values ('dddddddd-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', 'photo', '11111111/seg1.jpg') $$,
  'owner A can insert own story segment'
);

-- 6. expires_at defaults to ~now()+24h (within tolerance)
select ok(
  (select expires_at between now() + interval '23 hours' and now() + interval '25 hours'
     from public.story_segments where id = 'dddddddd-0000-0000-0000-000000000001'),
  'expires_at defaults to ~now()+24h'
);

-- 7. member B reads A's live segment → 1 row
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.story_segments
     where author_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'member B can read A''s live segment'
);

-- 8. an expired, unpinned segment is INVISIBLE to B (seed as service_role to bypass insert policy)
reset role;
insert into public.story_segments (id, author_id, kind, storage_path, expires_at, pinned)
values ('dddddddd-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'photo', '11111111/expired.jpg',
        now() - interval '1 hour', false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.story_segments
     where id = 'dddddddd-0000-0000-0000-000000000002' $$,
  $$ values (0) $$,
  'expired unpinned segment is invisible to members'
);

-- 9. a PINNED expired segment IS visible (pinned-to-journey survives TTL)
reset role;
insert into public.story_segments (id, author_id, kind, storage_path, expires_at, pinned, is_step)
values ('dddddddd-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', 'photo', '11111111/pinned.jpg',
        now() - interval '1 hour', true, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.story_segments
     where id = 'dddddddd-0000-0000-0000-000000000003' $$,
  $$ values (1) $$,
  'pinned expired segment is visible (pinned-to-journey)'
);

-- 10. A pins own segment (update pinned=true) → lives_ok
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ update public.story_segments set pinned = true
     where id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'author can pin own segment'
);

-- 11. cross-author update by B on A's segment → 0 rows changed
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.story_segments set caption = 'hijack'
  where id = 'dddddddd-0000-0000-0000-000000000001';
reset role;
select results_eq(
  $$ select count(*)::int from public.story_segments
     where id = 'dddddddd-0000-0000-0000-000000000001' and caption = 'hijack' $$,
  $$ values (0) $$,
  'member B cannot update A''s segment'
);

select * from finish();
rollback;
