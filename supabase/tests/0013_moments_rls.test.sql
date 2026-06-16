begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- two deterministic users (handle_new_user trigger auto-creates their profiles)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'user_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- 1. schema: table exists
select has_table('public'::name, 'moments'::name, 'moments table exists');

-- 2. schema: RLS enabled
select ok(
  (select relrowsecurity from pg_class where oid = 'public.moments'::regclass),
  'RLS enabled on moments'
);

-- 3. exactly the three expected policies
select policies_are(
  'public'::name, 'moments'::name,
  array['moments_select_authenticated', 'moments_insert_own', 'moments_update_own'],
  'exactly the expected policies on moments'
);

-- 4. anon is denied entirely (no grant)
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.moments $$,
  '42501', null, 'anon cannot read moments'
);
reset role;

-- 5. owner A inserts own moment (owner_id = A) → lives_ok
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.moments (id, owner_id, kind, media_path)
     values ('cccccccc-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111',
             'photo', 'moments/11111111/img1.jpg') $$,
  'owner A can insert own moment'
);

-- 6. member B inserts a moment with owner_id = A → 42501
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.moments (owner_id, kind, media_path)
     values ('11111111-1111-1111-1111-111111111111', 'photo', 'moments/22222222/img2.jpg') $$,
  '42501', null, 'member B cannot insert a moment with another user''s owner_id'
);

-- 7. member B reads A's live moment → 1 row
select results_eq(
  $$ select count(*)::int from public.moments
     where owner_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1) $$,
  'member B can read A''s live moment'
);

-- 8. after A soft-deletes the moment, B's SELECT → 0 rows
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.moments set deleted_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from public.moments
     where owner_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (0) $$,
  'soft-deleted moment is invisible to members'
);
reset role;

-- 9. caption of 281 chars on insert → throws 23514 (check constraint)
select throws_ok(
  format(
    $$ insert into public.moments (owner_id, kind, media_path, caption)
       values ('11111111-1111-1111-1111-111111111111', 'photo', 'moments/11111111/img2.jpg', %L) $$,
    repeat('x', 281)
  ),
  '23514', null, 'caption over 280 chars is rejected by check constraint'
);

select * from finish();
rollback;
