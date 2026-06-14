begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- schema
select has_table('public', 'email_waitlist', 'email_waitlist table exists');
select has_column('public', 'email_waitlist', 'email', 'email_waitlist.email exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.email_waitlist'::regclass),
  'RLS enabled on email_waitlist'
);
select policies_are(
  'public', 'email_waitlist',
  array['email_waitlist_insert_anon'],
  'exactly the expected (insert-only) policy on email_waitlist'
);

-- anon (a landing visitor) may insert
set local role anon;
set local request.jwt.claims = '';
select lives_ok(
  $$ insert into public.email_waitlist (email, locale, source)
     values ('first@test.athanor', 'it', 'landing-hero') $$,
  'anon can join the waitlist'
);

-- duplicate email is rejected (23505) — API helper swallows this as a no-op
select throws_ok(
  $$ insert into public.email_waitlist (email) values ('first@test.athanor') $$,
  '23505', null, 'duplicate email rejected by unique index'
);

-- locale check constraint (23514)
select throws_ok(
  $$ insert into public.email_waitlist (email, locale) values ('bad@test.athanor', 'fr') $$,
  '23514', null, 'invalid locale rejected'
);

-- anon cannot read the list (no select grant/policy) → permission denied
select throws_ok(
  $$ select count(*) from public.email_waitlist $$,
  '42501', null, 'anon cannot read the waitlist'
);
reset role;

-- authenticated is also granted INSERT only: insert OK, read denied (prove the grant we made)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into public.email_waitlist (email, locale) values ('member@test.athanor', 'en') $$,
  'authenticated can join the waitlist'
);
select throws_ok(
  $$ select count(*) from public.email_waitlist $$,
  '42501', null, 'authenticated cannot read the waitlist'
);
reset role;

select * from finish();
rollback;
