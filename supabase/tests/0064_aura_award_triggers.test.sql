-- M6 Aura award triggers — CI-only (no local Docker; verified via hosted-replay catalog
-- checks + this file runs in the GH `db` job via local `supabase start`). Asserts: the 6
-- triggers exist · trigger fns are SECURITY DEFINER · a qualifying transition runs clean
-- with the engine unconfigured (guarded no-op enqueue) · a non-qualifying transition is
-- also a clean no-op · rule #1 (client can never write aura_events, 42501).
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- fixture: one owner profile (auto-created by handle_new_user), a dream, two tappe
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'aura_trigger_owner@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into public.dreams (profile_id, text)
  values ('44444444-4444-4444-4444-444444444444', 'trigger sanity dream');

insert into public.dream_milestones (dream_id, body)
  values
    ((select id from public.dreams where profile_id = '44444444-4444-4444-4444-444444444444'), 'tappa uno'),
    ((select id from public.dreams where profile_id = '44444444-4444-4444-4444-444444444444'), 'tappa due');

select set_config('test.owner', '44444444-4444-4444-4444-444444444444', false);
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

-- (B) trigger fns are SECURITY DEFINER (award path must run as owner to reach enqueue)
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'aura_award_own_milestone' and p.pronamespace = 'athanor'::regnamespace),
  true, 'aura_award_own_milestone is SECURITY DEFINER');

-- (C) enqueue is a guarded no-op with GUCs unset → a qualifying transition does NOT error.
select lives_ok(
  $$ update public.dream_milestones set status = 'done' where id = current_setting('test.m_id')::uuid $$,
  'own_milestone trigger runs clean when engine unconfigured (no-op enqueue)');

-- (D) non-qualifying transition does not raise either (status open->in_progress)
select lives_ok(
  $$ update public.dream_milestones set status = 'in_progress' where id = current_setting('test.m2_id')::uuid $$,
  'non-done milestone update is a clean no-op');

-- (E) RULE #1 — a client can NEVER write aura_events (deny-by-default holds).
select throws_ok(
  $$ insert into public.aura_events (profile_id, type, points, ref_id)
     values (current_setting('test.owner')::uuid, 'own_milestone', 10, gen_random_uuid()) $$,
  '42501', null, 'client INSERT into aura_events denied (rule #1)');

select throws_ok(
  $$ update public.aura_events set points = 999 where true $$,
  '42501', null, 'client UPDATE aura_events denied (rule #1)');

reset role;

-- confirm the qualifying transition really did produce zero aura_events rows (service_role
-- for a true global count — own-row SELECT RLS would otherwise hide any stray row).
set local role service_role;
select is(
  (select count(*)::int from public.aura_events where profile_id = '44444444-4444-4444-4444-444444444444'),
  0, 'own_milestone qualifying transition wrote zero aura_events (engine unconfigured, no-op)');
reset role;

select finish();
rollback;
