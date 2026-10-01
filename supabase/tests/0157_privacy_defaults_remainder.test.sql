-- 0157_privacy_defaults_remainder.test.sql
-- Issue #790 (20260925143552) — privacy defaults, the remainder. One section per ruling:
--
--   (1) identity facet: a new sign-up lands on «Membri» and is anon-dark; an existing map is
--       left alone (an identity-less map still falls back to public — 0101 property 3).
--   (2) zodiac: its own key. anon never reads zodiac_sign; public_zodiac_sign carries the sign
--       only under zodiac:'public'. Members get it through get_person_profile unless the owner
--       chose «Solo io»; the owner always gets it from get_own_profile.
--   (3) RSVPs: the organiser and the event's attendees read who is going; a member who is
--       neither reads only their own row, and the count through event_going_count.
--   (5) the visibility purge: a change to the identity, dream or zodiac facet posts the live
--       handle to handle-rename-purge; any other visibility change posts nothing.
--
-- Like 0156, net.http_request_queue is the in-txn witness and every read is scoped to this
-- file's fixture uuids and fake purge URL — the queue is a live table on a hosted project.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

select set_config('app.settings.handle_rename_purge_url',
                  'http://purge790.invalid/functions/v1/handle-rename-purge', true);
select set_config('app.settings.handle_rename_purge_key', 'sb_secret_pgtap_dummy_key', true);

-- a = organiser, b = attendee, c = member who is neither, d = the zodiac/identity subject
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a7900000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'p790_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b7900000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'p790_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c7900000-0000-4000-8000-00000000000c',
   'authenticated', 'authenticated', 'p790_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd7900000-0000-4000-8000-00000000000d',
   'authenticated', 'authenticated', 'p790_d@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── (1) identity facet ──────────────────────────────────────────────────────────────────────
select is(
  (select visibility from public.profiles where id = 'd7900000-0000-4000-8000-00000000000d'),
  '{"identity": "members"}'::jsonb,
  'a new sign-up lands on identity:members (#790)');

-- As postgres, so the handle cooldown and the purge WHEN clause (old.handle is null) stay out.
update public.profiles set handle = 'p790_dee', display_name = 'Dee', birth_date = date '1990-08-10'
 where id = 'd7900000-0000-4000-8000-00000000000d';
update public.profiles set handle = 'p790_org' where id = 'a7900000-0000-4000-8000-00000000000a';

set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.profiles where id = 'd7900000-0000-4000-8000-00000000000d'),
  0, 'anon cannot see a new member at the default — no public page until they opt in');
reset role;

-- ── (2) zodiac ──────────────────────────────────────────────────────────────────────────────
select ok(not has_column_privilege('anon', 'public.profiles', 'zodiac_sign', 'SELECT'),
  'anon holds no SELECT on zodiac_sign');
select ok(has_column_privilege('anon', 'public.profiles', 'public_zodiac_sign', 'SELECT'),
  'anon holds SELECT on public_zodiac_sign');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'public_zodiac_sign', 'SELECT'),
  'authenticated holds no SELECT on public_zodiac_sign (0073: publication == grant)');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'public_zodiac_sign', 'UPDATE'),
  'authenticated holds no UPDATE on public_zodiac_sign (generated)');
select is(
  (select attgenerated::text from pg_attribute
    where attrelid = 'public.profiles'::regclass and attname = 'public_zodiac_sign'),
  's', 'public_zodiac_sign is a STORED generated column');

-- D opens the page but leaves zodiac at its default, through the owner's own write path.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d7900000-0000-4000-8000-00000000000d","role":"authenticated"}';
update public.profiles set visibility = '{"identity": "public"}'::jsonb
 where id = 'd7900000-0000-4000-8000-00000000000d';
reset role;

set local role anon;
set local request.jwt.claims = '';
select results_eq(
  $$ select handle, public_zodiac_sign from public.profiles
      where id = 'd7900000-0000-4000-8000-00000000000d' $$,
  $$ values ('p790_dee'::text, null::text) $$,
  'a public page at the default zodiac facet shows no sign to anon');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c7900000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is(
  (select zodiac_sign from public.get_person_profile('d7900000-0000-4000-8000-00000000000d')),
  'leone', 'at the default («Membri») another member sees the sign');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d7900000-0000-4000-8000-00000000000d","role":"authenticated"}';
update public.profiles set visibility = '{"identity": "public", "zodiac": "public"}'::jsonb
 where id = 'd7900000-0000-4000-8000-00000000000d';
reset role;

set local role anon;
set local request.jwt.claims = '';
select is(
  (select public_zodiac_sign from public.profiles where id = 'd7900000-0000-4000-8000-00000000000d'),
  'leone', 'zodiac:public puts the sign on the public page');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d7900000-0000-4000-8000-00000000000d","role":"authenticated"}';
update public.profiles set visibility = '{"identity": "public", "zodiac": "private"}'::jsonb
 where id = 'd7900000-0000-4000-8000-00000000000d';
select is(
  (select zodiac_sign from public.get_own_profile()),
  'leone', 'the owner still sees their own sign under «Solo io»');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c7900000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is(
  (select zodiac_sign from public.get_person_profile('d7900000-0000-4000-8000-00000000000d')),
  null::text, '«Solo io» hides the sign from another member');
select is(
  (select display_name from public.get_person_profile('d7900000-0000-4000-8000-00000000000d')),
  'Dee', 'control: the rest of the projection still resolves');
-- has_public_page: the share sheet's cue, the anon row policy's predicate projected.
select is(
  (select has_public_page from public.get_person_profile('d7900000-0000-4000-8000-00000000000d')),
  true, 'has_public_page is true for a member at identity:public');
select is(
  (select has_public_page from public.get_person_profile('a7900000-0000-4000-8000-00000000000a')),
  false, 'has_public_page is false at the new default — the share sheet drops the dead link');
reset role;

set local role anon;
set local request.jwt.claims = '';
select is(
  (select public_zodiac_sign from public.profiles where id = 'd7900000-0000-4000-8000-00000000000d'),
  null::text, '«Solo io» takes the sign off the public page');
reset role;

-- ── (3) RSVPs ───────────────────────────────────────────────────────────────────────────────
set local role service_role;
insert into public.events (id, organizer_id, title, category, is_online, venue, geo, starts_at)
  values ('e7900000-0000-4000-8000-0000000000e1', 'a7900000-0000-4000-8000-00000000000a',
          'Cena 790', 'networking', false, 'Spazio 790',
          extensions.st_point(12.49, 41.89)::extensions.geography, now() + interval '7 days');
reset role;

-- B goes; C goes and then cancels (a cancelled row is not attendance).
set local role authenticated;
set local request.jwt.claims = '{"sub":"b7900000-0000-4000-8000-00000000000b","role":"authenticated"}';
insert into public.rsvps (user_id, event_id, status)
  values ('b7900000-0000-4000-8000-00000000000b', 'e7900000-0000-4000-8000-0000000000e1', 'going');
set local request.jwt.claims = '{"sub":"c7900000-0000-4000-8000-00000000000c","role":"authenticated"}';
insert into public.rsvps (user_id, event_id, status)
  values ('c7900000-0000-4000-8000-00000000000c', 'e7900000-0000-4000-8000-0000000000e1', 'going');
update public.rsvps set status = 'cancelled'
 where user_id = 'c7900000-0000-4000-8000-00000000000c'
   and event_id = 'e7900000-0000-4000-8000-0000000000e1';

-- C: neither organiser nor attending.
select results_eq(
  $$ select user_id from public.rsvps where event_id = 'e7900000-0000-4000-8000-0000000000e1' $$,
  $$ values ('c7900000-0000-4000-8000-00000000000c'::uuid) $$,
  'a member who is not attending reads only their own RSVP row — no names');
select is(
  public.event_going_count('e7900000-0000-4000-8000-0000000000e1'),
  1, 'a member who is not attending still reads the count');

-- D: never touched the event.
set local request.jwt.claims = '{"sub":"d7900000-0000-4000-8000-00000000000d","role":"authenticated"}';
select is(
  (select count(*)::int from public.rsvps where event_id = 'e7900000-0000-4000-8000-0000000000e1'),
  0, 'a member with no RSVP reads no rows on the event');

-- B: attending.
set local request.jwt.claims = '{"sub":"b7900000-0000-4000-8000-00000000000b","role":"authenticated"}';
select results_eq(
  $$ select user_id from public.rsvps where event_id = 'e7900000-0000-4000-8000-0000000000e1' $$,
  $$ values ('b7900000-0000-4000-8000-00000000000b'::uuid) $$,
  'an attendee reads who is going, and not who cancelled (C''s row stays C''s)');

-- A: organiser, not attending.
set local request.jwt.claims = '{"sub":"a7900000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(
  (select count(*)::int from public.rsvps where event_id = 'e7900000-0000-4000-8000-0000000000e1'),
  1, 'the organiser reads who is going on their event — not the cancelled row');
reset role;

set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select public.event_going_count('e7900000-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'anon cannot call event_going_count');
reset role;
select ok(
  (select prosecdef from pg_proc where oid = 'athanor.sees_event_attendees(uuid)'::regprocedure),
  'sees_event_attendees is SECURITY DEFINER (a plain subquery would recurse, 42P17)');
select ok(not has_function_privilege('anon', 'athanor.sees_event_attendees(uuid)', 'execute'),
  'anon cannot execute sees_event_attendees');

-- A deleted event has no count.
set local role service_role;
update public.events set deleted_at = now() where id = 'e7900000-0000-4000-8000-0000000000e1';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c7900000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is(
  public.event_going_count('e7900000-0000-4000-8000-0000000000e1'),
  0, 'a deleted event counts 0');
reset role;

-- ── (5) the visibility purge ────────────────────────────────────────────────────────────────
-- D changed identity (members → public), zodiac members → public and public → private above,
-- all under the handle p790_dee: three changes to what anon sees.
select has_trigger('public', 'profiles', 'profiles_visibility_purge',
  'profiles carries the visibility-purge trigger');
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge790.invalid/functions/v1/handle-rename-purge'),
  3, 'each of D''s three facet changes posted one purge');
select is(
  (select count(distinct convert_from(q.body, 'utf8')::jsonb)::int from net.http_request_queue q
    where q.url = 'http://purge790.invalid/functions/v1/handle-rename-purge'),
  1, 'every purge names the same body');
select is(
  (select convert_from(q.body, 'utf8')::jsonb from net.http_request_queue q
    where q.url = 'http://purge790.invalid/functions/v1/handle-rename-purge' limit 1),
  '{"handle":"p790_dee"}'::jsonb,
  'the purge names the live handle and nothing else');

-- A facet the page does not show: no purge. Whole-map literals, as the app writes them —
-- authenticated holds no SELECT on visibility (M10), so `visibility || …` would 42501.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d7900000-0000-4000-8000-00000000000d","role":"authenticated"}';
update public.profiles set visibility = '{"identity": "public", "zodiac": "private", "bio": "private"}'::jsonb
 where id = 'd7900000-0000-4000-8000-00000000000d';
-- An explicit key equal to its fallback: no change, no purge.
update public.profiles set visibility = '{"identity": "public", "zodiac": "private", "bio": "private", "dream": "members"}'::jsonb
 where id = 'd7900000-0000-4000-8000-00000000000d';
-- «Membri» → «Solo io»: anon saw neither, so the page did not change.
update public.profiles set visibility = '{"identity": "public", "zodiac": "private", "bio": "private", "dream": "private"}'::jsonb
 where id = 'd7900000-0000-4000-8000-00000000000d';
reset role;
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge790.invalid/functions/v1/handle-rename-purge'),
  3, 'a bio change, a key equal to its default, or members → private posts no purge');

-- The dream facet does.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d7900000-0000-4000-8000-00000000000d","role":"authenticated"}';
update public.profiles set visibility = '{"identity": "public", "zodiac": "private", "bio": "private", "dream": "public"}'::jsonb
 where id = 'd7900000-0000-4000-8000-00000000000d';
reset role;
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge790.invalid/functions/v1/handle-rename-purge'),
  4, 'a dream facet change posts a purge (the quote is on the card)');

-- No handle, no page: C has none.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c7900000-0000-4000-8000-00000000000c","role":"authenticated"}';
update public.profiles set visibility = '{"identity": "public"}'::jsonb
 where id = 'c7900000-0000-4000-8000-00000000000c';
reset role;
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge790.invalid/functions/v1/handle-rename-purge'),
  4, 'a member without a handle posts no purge');

-- A rename that also flips the facet belongs to the rename trigger alone: one post, old handle.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7900000-0000-4000-8000-00000000000a","role":"authenticated"}';
update public.profiles set handle = 'p790_org2', visibility = '{"identity": "public"}'::jsonb
 where id = 'a7900000-0000-4000-8000-00000000000a';
reset role;
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge790.invalid/functions/v1/handle-rename-purge'
      and convert_from(body, 'utf8')::jsonb = '{"handle":"p790_org"}'::jsonb),
  1, 'a rename plus a facet change posts once, for the old handle');
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'http://purge790.invalid/functions/v1/handle-rename-purge'),
  5, 'and nothing else');

select * from finish();
rollback;
