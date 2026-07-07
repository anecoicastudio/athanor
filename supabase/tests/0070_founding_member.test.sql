-- 0070_founding_member.test.sql
-- P4.2 — Prime Stelle founding cohort flag. Asserts: column exists with default false ·
-- clients cannot write it (m7 column-grant lockdown, 42501) · another authenticated member
-- can read the flag (badge renders on person-detail) · granting it (service_role, the ops
-- path) confers ZERO Aura (rule #1 — cosmetic only, PS-2/PS-5).
-- CI-only (hosted lacks pgtap).

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── seed two members (auth trigger fires → profiles auto-created) ─────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000070',
   'authenticated', 'authenticated', 'founding_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb0000-0000-0000-0000-000000000070',
   'authenticated', 'authenticated', 'founding_b@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── schema shape ───────────────────────────────────────────────────────────────────────────
select has_column('public', 'profiles', 'founding_member', 'profiles.founding_member exists');

select is(
  (select founding_member from public.profiles where id = 'aaaa0000-0000-0000-0000-000000000070'),
  false,
  'founding_member defaults to false'
);

-- ── client-unwritable (rule #1 posture: the badge is granted, never self-assigned) ─────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000070","role":"authenticated"}';

select throws_ok(
  $$ update public.profiles set founding_member = true where id = 'aaaa0000-0000-0000-0000-000000000070' $$,
  '42501', null,
  'client cannot self-grant founding_member (column-grant lockdown)'
);

reset role;

-- ── service_role grants the badge (the ops path) ───────────────────────────────────────────
set local role service_role;
update public.profiles set founding_member = true
  where id = 'aaaa0000-0000-0000-0000-000000000070';
reset role;

-- ── another member reads the flag (badge renders on person-detail) ─────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbb0000-0000-0000-0000-000000000070","role":"authenticated"}';

select is(
  (select founding_member from public.profiles where id = 'aaaa0000-0000-0000-0000-000000000070'),
  true,
  'authenticated member reads another member''s founding flag'
);

reset role;

-- ── zero Aura (rule #1): granting the badge produced no score events, at all ───────────────
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
    where profile_id = 'aaaa0000-0000-0000-0000-000000000070'),
  0,
  'founding grant confers ZERO aura_events (rule #1 — cosmetic only)'
);

select is(
  (select count(*)::int from public.aura_scores
    where profile_id = 'aaaa0000-0000-0000-0000-000000000070'),
  0,
  'founding grant touches no aura_scores (rule #1)'
);
reset role;

select * from finish();
rollback;
