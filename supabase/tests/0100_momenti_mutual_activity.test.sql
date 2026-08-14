-- #361 — the matcher's sixth affinity term: MUTUAL ACTIVITY (verified co-attendance)
-- and its surfacing through get_momenti_deck()
-- (migration <ts>_momenti_mutual_activity_term.sql).
--
-- The fixture isolates the term the way 0099's does: every pair that must NOT be
-- proposed sits at exactly ONE term (below the threshold of 2), so a term that
-- wrongly fires — RSVP intent scoring, an unpaid ticket scoring, empty arrays
-- matching everything — flips an assertion instead of hiding under the cap.
--
--   ME  artista · CHECKED IN at all six fixture events (organizes them too)
--   CO  no tags · checked in at Serata Alpha + Serata Beta   → 2 shared events = proposed
--   CAP no tags · checked in at Rito Uno…Quattro             → 4 shared events, affinity must CAP at 3
--   ST  artista · NO check-ins, but RSVP 'going' + a PENDING ticket on ME's events
--                                                            → tag 1 only; intent must stay zero
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','11111111-0000-4000-8000-000000000100','authenticated','authenticated','me100@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000100','authenticated','authenticated','co100@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000100','authenticated','authenticated','cap100@test.athanor','{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000','cccccccc-0000-4000-8000-000000000100','authenticated','authenticated','st100@test.athanor','{}'::jsonb, now(), now());

set local role service_role;
update public.profiles set handle='me100', identity_tags=array['artista']
  where id='11111111-0000-4000-8000-000000000100';
update public.profiles set handle='co100'
  where id='aaaaaaaa-0000-4000-8000-000000000100';
update public.profiles set handle='cap100'
  where id='bbbbbbbb-0000-4000-8000-000000000100';
update public.profiles set handle='st100', identity_tags=array['artista']
  where id='cccccccc-0000-4000-8000-000000000100';

insert into public.dreams (profile_id, text) values
  ('11111111-0000-4000-8000-000000000100','Sogno ME'),
  ('aaaaaaaa-0000-4000-8000-000000000100','Sogno CO'),
  ('bbbbbbbb-0000-4000-8000-000000000100','Sogno CAP'),
  ('cccccccc-0000-4000-8000-000000000100','Sogno ST');

-- Isolate the matcher's GLOBAL candidate pool to the four fixture users (the 0028
-- pattern): archive every other active dream so the assertions are deterministic.
update public.dreams set status = 'archived'
  where profile_id not in (
    '11111111-0000-4000-8000-000000000100',
    'aaaaaaaa-0000-4000-8000-000000000100',
    'bbbbbbbb-0000-4000-8000-000000000100',
    'cccccccc-0000-4000-8000-000000000100')
    and status = 'active' and deleted_at is null;

-- Six events, ME organizing, starts_at strictly descending so the deck's
-- newest-first title order is deterministic.
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at) values
  ('eeeeeeee-0000-4000-8000-000000000101','11111111-0000-4000-8000-000000000100','Serata Alpha','networking', true,'https://athanor.test/a', now() - interval '1 day'),
  ('eeeeeeee-0000-4000-8000-000000000102','11111111-0000-4000-8000-000000000100','Serata Beta','networking', true,'https://athanor.test/b', now() - interval '2 days'),
  ('eeeeeeee-0000-4000-8000-000000000103','11111111-0000-4000-8000-000000000100','Rito Uno','arte', true,'https://athanor.test/1', now() - interval '3 days'),
  ('eeeeeeee-0000-4000-8000-000000000104','11111111-0000-4000-8000-000000000100','Rito Due','arte', true,'https://athanor.test/2', now() - interval '4 days'),
  ('eeeeeeee-0000-4000-8000-000000000105','11111111-0000-4000-8000-000000000100','Rito Tre','arte', true,'https://athanor.test/3', now() - interval '5 days'),
  ('eeeeeeee-0000-4000-8000-000000000106','11111111-0000-4000-8000-000000000100','Rito Quattro','arte', true,'https://athanor.test/4', now() - interval '6 days');

-- Checked-in tickets + attendance: ME everywhere, CO at the two Serate, CAP at the
-- four Riti. ST holds only INTENT: an rsvp and a pending (unpaid) ticket — if either
-- ever scores, ME–ST reaches the threshold and the proposal-set assertion flips.
insert into public.event_tickets (id, user_id, event_id, status) values
  ('ffffffff-0000-4000-8000-000000000111','11111111-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000101','checked_in'),
  ('ffffffff-0000-4000-8000-000000000112','11111111-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000102','checked_in'),
  ('ffffffff-0000-4000-8000-000000000113','11111111-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000103','checked_in'),
  ('ffffffff-0000-4000-8000-000000000114','11111111-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000104','checked_in'),
  ('ffffffff-0000-4000-8000-000000000115','11111111-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000105','checked_in'),
  ('ffffffff-0000-4000-8000-000000000116','11111111-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000106','checked_in'),
  ('ffffffff-0000-4000-8000-000000000121','aaaaaaaa-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000101','checked_in'),
  ('ffffffff-0000-4000-8000-000000000122','aaaaaaaa-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000102','checked_in'),
  ('ffffffff-0000-4000-8000-000000000131','bbbbbbbb-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000103','checked_in'),
  ('ffffffff-0000-4000-8000-000000000132','bbbbbbbb-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000104','checked_in'),
  ('ffffffff-0000-4000-8000-000000000133','bbbbbbbb-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000105','checked_in'),
  ('ffffffff-0000-4000-8000-000000000134','bbbbbbbb-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000106','checked_in'),
  ('ffffffff-0000-4000-8000-000000000141','cccccccc-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000101','pending');

insert into public.event_attendance (ticket_id, event_id, scanned_by)
select t.id, t.event_id, '11111111-0000-4000-8000-000000000100'
  from public.event_tickets t
 where t.status = 'checked_in'
   and t.event_id in (
     'eeeeeeee-0000-4000-8000-000000000101','eeeeeeee-0000-4000-8000-000000000102',
     'eeeeeeee-0000-4000-8000-000000000103','eeeeeeee-0000-4000-8000-000000000104',
     'eeeeeeee-0000-4000-8000-000000000105','eeeeeeee-0000-4000-8000-000000000106');

insert into public.rsvps (user_id, event_id, status) values
  ('cccccccc-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000101','going'),
  ('cccccccc-0000-4000-8000-000000000100','eeeeeeee-0000-4000-8000-000000000102','going');

-- ── the matcher scores verified co-attendance, capped (#361) ────────────────
select ok(public.run_momenti_matcher() >= 2, 'matcher inserts at least ME''s two proposals');

select results_eq(
  $$ select candidate_id from public.momento_proposals
      where user_id='11111111-0000-4000-8000-000000000100' and affinity >= 2
      order by candidate_id $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000100'::uuid),
            ('bbbbbbbb-0000-4000-8000-000000000100'::uuid) $$,
  'ME is proposed exactly CO and CAP — ST''s RSVPs and unpaid ticket stay at zero, strangers share nothing'
);

select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000100'
      and candidate_id='aaaaaaaa-0000-4000-8000-000000000100'),
  2::numeric,
  'each shared checked-in event counts one, at tag parity: two reach the threshold with nothing else'
);
select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000100'
      and candidate_id='bbbbbbbb-0000-4000-8000-000000000100'),
  3::numeric,
  'MUTUAL_ACTIVITY_CAP: four shared events score exactly 3 — a serial event-goer cannot dominate'
);
reset role;

-- ── the deck names the shared rooms, titles only, newest first (#361) ───────
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000100","role":"authenticated"}';

select is((select count(*)::int from public.get_momenti_deck()), 2,
  'the deck deals exactly the two co-attendance cards');
select is(
  (select mutual_activity from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000100'),
  array['Serata Alpha','Serata Beta'],
  'mutual_activity carries the shared events'' TITLES, newest event first — never ids'
);
select is(
  (select mutual_activity from public.get_momenti_deck()
    where candidate_id='bbbbbbbb-0000-4000-8000-000000000100'),
  array['Rito Uno','Rito Due','Rito Tre','Rito Quattro'],
  'the term array is the FULL intersection — the cap is a scoring rule, not a truncation'
);
reset role;

-- A soft-deleted event still scored (the shared evening happened) but is no longer
-- NAMED: the listing is gone, so the next read drops its title, prose-free (#273 D).
set local role service_role;
update public.events set deleted_at = now()
  where id = 'eeeeeeee-0000-4000-8000-000000000102';
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-0000-4000-8000-000000000100","role":"authenticated"}';
select is(
  (select mutual_activity from public.get_momenti_deck()
    where candidate_id='aaaaaaaa-0000-4000-8000-000000000100'),
  array['Serata Alpha'],
  'a soft-deleted event disappears from the reason on the next read'
);
reset role;

select is(
  (select affinity from public.momento_proposals
    where user_id='11111111-0000-4000-8000-000000000100'
      and candidate_id='aaaaaaaa-0000-4000-8000-000000000100'),
  2::numeric,
  'the stored score does not chase the deletion — the shared evening happened'
);

select * from finish();
rollback;
