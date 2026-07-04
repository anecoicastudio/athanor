-- 0068_profile_stat_counts.test.sql
-- P3.1 — profile_stat_counts(uuid) DEFINER RPC: aggregate-only stat-line counts.
-- Asserts: function exists · SECURITY DEFINER · anon revoked / authenticated granted ·
-- collabs = completed non-deleted milestone_helps as helper (offered + soft-deleted
-- excluded) · events = distinct attended events (paid-but-unattended ticket excluded) ·
-- block in either direction → zero rows (invisibility, client coalesces 0) · self-call ok.
-- CI-only (hosted lacks pgtap); seeds transition-guarded rows as service_role.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ── seed two users (profiles auto-created by handle_new_user trigger) ─────────
-- A = the profile being counted (helper + attendee), B = the viewer (dream owner + organizer).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000068',
   'authenticated', 'authenticated', 'stat_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb0000-0000-0000-0000-000000000068',
   'authenticated', 'authenticated', 'stat_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- ── seed content as service_role (status='completed' is transition-guarded) ───
set local role service_role;

insert into public.dreams (profile_id, text)
  values ('bbbb0000-0000-0000-0000-000000000068', 'stat counts dream');

insert into public.dream_milestones (dream_id, body)
select d.id, m.body
  from public.dreams d, (values ('tappa completed'), ('tappa offered'), ('tappa deleted')) as m(body)
 where d.profile_id = 'bbbb0000-0000-0000-0000-000000000068';

-- one completed (counts), one merely offered (excluded), one completed-but-soft-deleted (excluded)
insert into public.milestone_helps (milestone_id, helper_id, type, status, deleted_at)
select m.id, 'aaaa0000-0000-0000-0000-000000000068', 'skill',
       case m.body when 'tappa offered' then 'offered' else 'completed' end::public.help_status,
       case m.body when 'tappa deleted' then now() else null end
  from public.dream_milestones m
  join public.dreams d on d.id = m.dream_id
 where d.profile_id = 'bbbb0000-0000-0000-0000-000000000068';

-- e1 attended (counts once), e2 paid ticket but never checked in (excluded)
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents)
values
  ('eeee0001-0000-0000-0000-000000000068', 'bbbb0000-0000-0000-0000-000000000068',
   'Serata stat uno', 'networking', true, 'https://x.test', now() + interval '1 day', 0),
  ('eeee0002-0000-0000-0000-000000000068', 'bbbb0000-0000-0000-0000-000000000068',
   'Serata stat due', 'networking', true, 'https://x.test', now() + interval '2 days', 0);

insert into public.event_tickets (id, user_id, event_id, status, qr_token)
values
  ('cccc0001-0000-0000-0000-000000000068', 'aaaa0000-0000-0000-0000-000000000068',
   'eeee0001-0000-0000-0000-000000000068', 'paid', 'stat.token.one'),
  ('cccc0002-0000-0000-0000-000000000068', 'aaaa0000-0000-0000-0000-000000000068',
   'eeee0002-0000-0000-0000-000000000068', 'paid', 'stat.token.two');

insert into public.event_attendance (ticket_id, event_id, scanned_by)
values ('cccc0001-0000-0000-0000-000000000068', 'eeee0001-0000-0000-0000-000000000068',
        'bbbb0000-0000-0000-0000-000000000068');

reset role;

-- ── shape + security posture ──────────────────────────────────────────────────
select has_function('public'::name, 'profile_stat_counts'::name, array['uuid']::name[]);

select is(
  (select p.prosecdef from pg_proc p
    where p.proname = 'profile_stat_counts' and p.pronamespace = 'public'::regnamespace),
  true, 'profile_stat_counts is SECURITY DEFINER');

select is(
  has_function_privilege('anon', 'public.profile_stat_counts(uuid)', 'execute'),
  false, 'anon cannot execute profile_stat_counts');

select is(
  has_function_privilege('authenticated', 'public.profile_stat_counts(uuid)', 'execute'),
  true, 'authenticated can execute profile_stat_counts');

-- ── count semantics (viewer B counts target A) ────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-000000000068","role":"authenticated"}';

select is(
  (select collabs_count from public.profile_stat_counts('aaaa0000-0000-0000-0000-000000000068')),
  1, 'collabs = completed non-deleted helps only (offered + soft-deleted excluded)');

select is(
  (select events_count from public.profile_stat_counts('aaaa0000-0000-0000-0000-000000000068')),
  1, 'events = attended events only (paid-but-unattended ticket excluded)');

-- ── A blocks B → both directions see zero rows ────────────────────────────────
set local role service_role;
insert into public.blocks (blocker_id, blocked_id)
values ('aaaa0000-0000-0000-0000-000000000068', 'bbbb0000-0000-0000-0000-000000000068');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-000000000068","role":"authenticated"}';

select is(
  (select count(*) from public.profile_stat_counts('aaaa0000-0000-0000-0000-000000000068'))::int,
  0, 'post-block: blocked viewer (B) gets zero rows for blocker (A)');

set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000068","role":"authenticated"}';

select is(
  (select count(*) from public.profile_stat_counts('bbbb0000-0000-0000-0000-000000000068'))::int,
  0, 'post-block: blocker (A) gets zero rows for blocked (B)');

-- ── self-call unaffected by the block ─────────────────────────────────────────
select is(
  (select collabs_count from public.profile_stat_counts('aaaa0000-0000-0000-0000-000000000068')),
  1, 'self-call still returns own collabs count');

select is(
  (select events_count from public.profile_stat_counts('aaaa0000-0000-0000-0000-000000000068')),
  1, 'self-call still returns own events count');

reset role;

select * from finish();
rollback;
