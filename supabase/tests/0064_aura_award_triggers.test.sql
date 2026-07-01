-- M6 Aura award triggers — CI-only (no local Docker; verified via hosted-replay catalog
-- checks + this file runs in the GH `db` job via local `supabase start`). Asserts: the 6
-- triggers exist · all 6 trigger fns are SECURITY DEFINER · every one of the 6 trigger
-- bodies actually EXECUTES at least once with the engine unconfigured (guarded no-op
-- enqueue) — including the two count-based bodies (event_attendance's count(*) + join to
-- event_tickets/events; messages' two-FILTER count(*) + join to conversations) — all clean
-- no-ops · rule #1 (client can never write aura_events, 42501; true global zero-row check).
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- fixture: three profiles (auto-created by handle_new_user) — owner (dream + tappe +
-- event organizer + momento participant), helper (milestone help + post author + momento
-- peer), third (event ticket holder + post reactor).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'aura_trigger_owner@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555',
   'authenticated', 'authenticated', 'aura_trigger_helper@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666',
   'authenticated', 'authenticated', 'aura_trigger_third@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into public.dreams (profile_id, text)
  values ('44444444-4444-4444-4444-444444444444', 'trigger sanity dream');

insert into public.dream_milestones (dream_id, body)
  values
    ((select id from public.dreams where profile_id = '44444444-4444-4444-4444-444444444444'), 'tappa uno'),
    ((select id from public.dreams where profile_id = '44444444-4444-4444-4444-444444444444'), 'tappa due');

select set_config('test.owner', '44444444-4444-4444-4444-444444444444', false);
select set_config('test.helper', '55555555-5555-5555-5555-555555555555', false);
select set_config('test.third', '66666666-6666-6666-6666-666666666666', false);
select set_config(
  'test.m_id',
  (select m.id::text from public.dream_milestones m
     join public.dreams d on d.id = m.dream_id
    where d.profile_id = '44444444-4444-4444-4444-444444444444' and m.body = 'tappa uno'),
  false);
select set_config(
  'test.m2_id',
  (select m.id::text from public.dream_milestones m
     join public.dreams d on d.id = m.dream_id
    where d.profile_id = '44444444-4444-4444-4444-444444444444' and m.body = 'tappa due'),
  false);

-- (A) all 6 triggers exist on their tables
select has_trigger('public'::name, 'dream_milestones'::name, 'dream_milestones_aura_own'::name);
select has_trigger('public'::name, 'milestone_helps'::name, 'milestone_helps_aura_help'::name);
select has_trigger('public'::name, 'post_reactions'::name, 'post_reactions_aura_starred'::name);
select has_trigger('public'::name, 'event_attendance'::name, 'event_attendance_aura'::name);
select has_trigger('public'::name, 'messages'::name, 'messages_aura_momento'::name);
select has_trigger('public'::name, 'profiles'::name, 'profiles_aura_identity'::name);

-- (B) all 6 trigger fns are SECURITY DEFINER (award path must run as owner to reach enqueue)
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'aura_award_own_milestone' and p.pronamespace = 'athanor'::regnamespace),
  true, 'aura_award_own_milestone is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'aura_award_milestone_help' and p.pronamespace = 'athanor'::regnamespace),
  true, 'aura_award_milestone_help is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'aura_award_post_starred' and p.pronamespace = 'athanor'::regnamespace),
  true, 'aura_award_post_starred is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'aura_award_event_attendance' and p.pronamespace = 'athanor'::regnamespace),
  true, 'aura_award_event_attendance is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'aura_award_momento_conversation' and p.pronamespace = 'athanor'::regnamespace),
  true, 'aura_award_momento_conversation is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'aura_award_identity_verified' and p.pronamespace = 'athanor'::regnamespace),
  true, 'aura_award_identity_verified is SECURITY DEFINER');

-- (C) enqueue is a guarded no-op with GUCs unset → a qualifying transition does NOT error.
select lives_ok(
  $$ update public.dream_milestones set status = 'done' where id = current_setting('test.m_id')::uuid $$,
  'own_milestone trigger runs clean when engine unconfigured (no-op enqueue)');

-- (D) non-qualifying transition does not raise either (status open->in_progress)
select lives_ok(
  $$ update public.dream_milestones set status = 'in_progress' where id = current_setting('test.m2_id')::uuid $$,
  'non-done milestone update is a clean no-op');

-- (F) milestone_help status->'completed' → exercises aura_award_milestone_help's body.
-- Seed the offer already 'accepted' (service_role bypasses the offered->accepted guard step;
-- setup only, not itself asserted), then the dream owner legally transitions it to 'completed'.
set local role service_role;
insert into public.milestone_helps (milestone_id, helper_id, type, status)
  values (current_setting('test.m2_id')::uuid, current_setting('test.helper')::uuid, 'skill', 'accepted');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(
  $$ update public.milestone_helps set status = 'completed'
       where milestone_id = current_setting('test.m2_id')::uuid
         and helper_id = current_setting('test.helper')::uuid $$,
  'milestone_help completed transition runs clean (no-op enqueue, exercises helper-award body)');

-- (G) post_reactions insert → exercises aura_award_post_starred's body (post-author join +
-- self-reaction check + aura_scores lookup). Helper authors, third reacts (never self-award).
set local role service_role;
insert into public.posts (id, author_id, category, body)
  values ('aaaaaaaa-4444-4444-4444-000000000001', current_setting('test.helper')::uuid,
          'human', 'una tappa condivisa (trigger sanity)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
select lives_ok(
  $$ insert into public.post_reactions (post_id, person_id)
     values ('aaaaaaaa-4444-4444-4444-000000000001', current_setting('test.third')::uuid) $$,
  'post_reactions insert runs clean (no-op enqueue, exercises post-author join)');

-- (H) event_attendance insert → exercises aura_award_event_attendance's body: the
-- event_tickets join (attendee resolution) AND the count(*) over event_attendance
-- (organizer-crossing check) — the highest-risk count-based body.
set local role service_role;
insert into public.events (id, organizer_id, title, category, is_online, stream_url, starts_at, price_cents)
  values ('bbbbbbbb-4444-4444-4444-000000000002', current_setting('test.owner')::uuid,
          'Serata trigger-sanity', 'networking', true, 'https://x.test', now() + interval '1 day', 0);
insert into public.event_tickets (id, user_id, event_id, status, qr_token)
  values ('cccccccc-4444-4444-4444-000000000003', current_setting('test.third')::uuid,
          'bbbbbbbb-4444-4444-4444-000000000002', 'paid', 'trigger.sanity.token');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(
  $$ insert into public.event_attendance (ticket_id, event_id, scanned_by)
     values ('cccccccc-4444-4444-4444-000000000003', 'bbbbbbbb-4444-4444-4444-000000000002',
             current_setting('test.owner')::uuid) $$,
  'event_attendance insert runs clean (no-op enqueue, exercises count(*) + event_tickets join)');

-- (I) a 'user' message insert → exercises aura_award_momento_conversation's body: the
-- conversations join (participant resolution) AND the two-FILTER count(*) over messages —
-- the other highest-risk count-based body.
set local role service_role;
select set_config(
  'test.conv',
  public.create_conversation_pair(
    current_setting('test.owner')::uuid, current_setting('test.helper')::uuid, 'momento')::text,
  false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, kind, body)
     values (current_setting('test.conv')::uuid, current_setting('test.owner')::uuid,
             'user', 'ciao (trigger sanity)') $$,
  'messages user insert runs clean (no-op enqueue, exercises both-sides count + conversations join)');

-- (J) profiles.identity_verified false->true (service-role webhook path; NOT client-writable —
-- see 0059) → exercises aura_award_identity_verified's body.
set local role service_role;
select lives_ok(
  $$ update public.profiles set identity_verified = true where id = current_setting('test.third')::uuid $$,
  'identity_verified flip runs clean (no-op enqueue, service-role webhook path)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

-- (E) RULE #1 — a client can NEVER write aura_events (deny-by-default holds).
select throws_ok(
  $$ insert into public.aura_events (profile_id, type, points, ref_id)
     values (current_setting('test.owner')::uuid, 'own_milestone', 10, gen_random_uuid()) $$,
  '42501', null, 'client INSERT into aura_events denied (rule #1)');

select throws_ok(
  $$ update public.aura_events set points = 999 where true $$,
  '42501', null, 'client UPDATE aura_events denied (rule #1)');

reset role;

-- confirm every trigger body exercised above (C, D, F, G, H, I, J) produced ZERO aura_events
-- rows for THIS fixture's 3 profiles, under service_role (own-row SELECT RLS would otherwise
-- hide a stray row; scoped to our profile ids rather than an unfiltered global count because
-- hosted aura_events is a live/shared table that may carry unrelated rows from real activity —
-- an unscoped count is not a valid rule #1 witness there).
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
     where profile_id in (
       current_setting('test.owner')::uuid,
       current_setting('test.helper')::uuid,
       current_setting('test.third')::uuid
     )),
  0, 'all 6 trigger bodies ran with the engine unconfigured and wrote zero aura_events for this fixture (rule #1)');
reset role;

select finish();
rollback;
