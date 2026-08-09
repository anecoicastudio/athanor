-- The pairwise-dampening key: aura_events.counterparty_id, and the trigger that fills it.
--
-- PRD 4.9 promises "reciprocal exchanges dampened (pairwise diminishing returns)". That is only
-- true if the engine can tell WHO the other party was. Before 20260808180801 it could not: the
-- award payload carried only the milestone_helps row id, which is unique per help, so the
-- exchange index never advanced past 1 and two colluding accounts kept the full +40 forever.
--
-- enqueue_score_award is a no-op unless the score_engine GUCs are set (deliberately, so a
-- pre-deploy database never blocks a write), so the enqueue itself cannot be observed here.
-- What IS asserted: the column and its index exist, the award trigger resolves the confirming
-- dream owner, and rule 1 still holds — no client may write the new column.
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- ── the column ───────────────────────────────────────────────────────────────
select has_column('public'::name, 'aura_events'::name, 'counterparty_id'::name,
  'aura_events.counterparty_id exists');
select col_type_is('public'::name, 'aura_events'::name, 'counterparty_id'::name, 'uuid',
  'counterparty_id is a uuid');
select col_is_null('public'::name, 'aura_events'::name, 'counterparty_id'::name,
  'counterparty_id is nullable — solo events have no counterparty');

-- It references profiles, so a counterparty id can never be a value profiles never issued.
select col_is_fk('public'::name, 'aura_events'::name, array['counterparty_id'],
  'counterparty_id is a foreign key to profiles');

-- The dampening count filters on (profile_id, type, counterparty_id) on every two-sided award.
select has_index('public'::name, 'aura_events'::name, 'aura_events_pair'::name,
  'aura_events_pair index supports the dampening count');

-- ── rule 1: the ledger stays engine-only ─────────────────────────────────────
-- A member who could write counterparty_id could pick a counterparty they have never traded
-- with and reset their own dampening curve to full points.
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'public' and tablename = 'aura_events' and cmd <> 'SELECT' $$,
  'no client write policy on aura_events (rule #1)'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'aura_events'
       and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'anon/authenticated hold no write grant on aura_events'
);

-- ── the enqueue overload ─────────────────────────────────────────────────────
select has_function('athanor', 'enqueue_score_award',
  array['uuid', 'text', 'uuid', 'text', 'uuid'],
  'the 5-arg enqueue_score_award (with counterparty) exists');
select has_function('athanor', 'enqueue_score_award',
  array['uuid', 'text', 'uuid', 'text'],
  'the 4-arg form still exists for solo awards (report_upheld et al.)');
select function_privs_are('athanor', 'enqueue_score_award',
  array['uuid', 'text', 'uuid', 'text', 'uuid'], 'authenticated', array[]::text[],
  'authenticated cannot call the 5-arg enqueue');
select function_privs_are('athanor', 'enqueue_score_award',
  array['uuid', 'text', 'uuid', 'text', 'uuid'], 'anon', array[]::text[],
  'anon cannot call the 5-arg enqueue');

-- The secret rides `apikey`, never Authorization: a sb_secret_… key is not a JWT and the
-- platform rejects it when sent as a bearer. Regression guard for this migration specifically,
-- which reintroduced the hand-built header in an earlier draft.
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'athanor' and p.proname = 'enqueue_score_award' and p.pronargs = 5)
    like '%edge_auth_headers%',
  'the 5-arg enqueue builds its headers with athanor.edge_auth_headers'
);
-- Matched as the SQL string literal it would have to be in a hand-built jsonb_build_object,
-- so the word appearing in a comment (as it does, explaining the rule) does not trip it.
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'athanor' and p.proname = 'enqueue_score_award' and p.pronargs = 5)
    not like '%''Authorization''%',
  'the 5-arg enqueue never hand-builds an Authorization bearer'
);

-- ── the trigger resolves the confirming owner ────────────────────────────────
-- Fixtures: OWNER's dream has a tappa; HELPER offers on it and OWNER confirms.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'owner@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'helper@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

insert into public.dreams (id, profile_id, text, status)
values ('dddddddd-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
        'Aprire uno studio di ceramica', 'active');

insert into public.dream_milestones (id, dream_id, body, status, position)
values ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'dddddddd-0000-0000-0000-00000000000d',
        'Trovare il forno', 'open', 1);

insert into public.milestone_helps (id, milestone_id, helper_id, type, message, status)
values ('bbbbbbbb-0000-0000-0000-0000000000b1'::uuid, 'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
        '22222222-2222-2222-2222-222222222222', 'skill', 'Ne ho uno', 'offered');

-- milestone_helps_guard permits only offered -> accepted -> completed, so accept first.
update public.milestone_helps set status = 'accepted'
  where id = 'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid;

-- The award fires on the -> completed transition. Confirming must not raise, which is the
-- regression this guards: the trigger now joins dream_milestones -> dreams, and a mistake there
-- aborts the owner's confirmation rather than merely losing the counterparty.
select lives_ok(
  $$ update public.milestone_helps set status = 'completed'
       where id = 'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid $$,
  'confirming a help still succeeds with the owner lookup in the trigger'
);

-- The lookup the trigger performs, asserted on the same fixtures: help -> milestone -> dream
-- -> owner. If this resolves to the wrong profile, the engine dampens against a stranger and
-- the colluding pair is untouched.
select is(
  (select d.profile_id
     from public.milestone_helps h
     join public.dream_milestones m on m.id = h.milestone_id
     join public.dreams d on d.id = m.dream_id
     where h.id = 'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the help resolves to the dream owner, not to the helper'
);

-- ...and it is emphatically not the helper, which would dampen a member against themselves.
select isnt(
  (select d.profile_id
     from public.milestone_helps h
     join public.dream_milestones m on m.id = h.milestone_id
     join public.dreams d on d.id = m.dream_id
     where h.id = 'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'the counterparty is never the helper themselves'
);

select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'athanor' and p.proname = 'aura_award_milestone_help')
    like '%dreams%',
  'the milestone_help award trigger resolves the owner through dreams'
);

select * from finish();
rollback;
