begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- ── seed ────────────────────────────────────────────────────────────────────────────
-- two members. The handle_new_user trigger auto-creates their public.profiles rows.
-- user_a gets an aura_scores snapshot (score 700); user_b gets none — the asymmetry is the
-- point. Under the old Aura-weighted trigger these two voters would have weighed 0.700 and
-- 0.000; under equal vote (R-C) both weigh 1.000, and the seed below proves Aura is ignored
-- in BOTH directions: having a score does not inflate a vote, lacking one does not erase it.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'voter_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'voter_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- aura snapshot for user_a only. The trigger no longer reads it; the row stays so the
-- "Aura does not tilt the tally" assertion below is non-vacuous.
insert into public.aura_scores (profile_id, score)
  values ('11111111-1111-1111-1111-111111111111', 700);

-- one open cycle in the voting phase (service_role — fund_editions is service-role write only)
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies)
  values ('00000000-0000-0000-0000-0000000000ed', now() + interval '30 days', 1000000, 'voting', true, false,
          100000, 5, 3);
-- two votable candidacies, one per author (status submitted). Written as owner (bypasses the
-- identity-verified insert gate — exactly the service-role path).
insert into public.dream_candidacies (id, edition_id, profile_id, story, goal, impact, video_url, plan, status)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000ed',
   '11111111-1111-1111-1111-111111111111','s','g','i','11111111-1111-1111-1111-111111111111/a.mp4','p','submitted'),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000ed',
   '22222222-2222-2222-2222-222222222222','s','g','i','22222222-2222-2222-2222-222222222222/b.mp4','p','submitted');
reset role;

-- ── schema / RLS ──────────────────────────────────────────────────────────────────────
select has_table('public', 'candidacy_votes', 'candidacy_votes exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.candidacy_votes'::regclass),
  'RLS enabled on candidacy_votes'
);
select policies_are(
  'public', 'candidacy_votes',
  array['candidacy_votes_select_own','candidacy_votes_insert_own','candidacy_votes_delete_own',
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'exactly the three vote policies'
);
select is(
  (select indexdef from pg_indexes
   where schemaname='public' and indexname='candidacy_votes_one_per_edition'),
  'CREATE UNIQUE INDEX candidacy_votes_one_per_edition ON public.candidacy_votes USING btree (edition_id, voter_id)',
  'unique index on (edition_id, voter_id)'
);

-- ── one vote per edition + server-written weight ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- user_a casts a direct vote (weight defaults 0 → RLS ok → trigger writes the constant 1.000)
select lives_ok(
  $$ insert into public.candidacy_votes (edition_id, candidacy_id, voter_id)
     values ('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111') $$,
  'member can cast a vote'
);

-- a second vote (other candidacy, SAME edition) → unique violation
select throws_ok(
  $$ insert into public.candidacy_votes (edition_id, candidacy_id, voter_id)
     values ('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111') $$,
  '23505', null, 'one vote per member per edition (unique violation)'
);

-- client CANNOT set a non-zero weight: the BEFORE-INSERT trigger sees the original NEW.weight
-- and raises 42501 on tamper (a RLS WITH CHECK runs too late — the trigger has already
-- overwritten weight with the snapshot). Delete the first vote so the unique index is free.
delete from public.candidacy_votes where voter_id = '11111111-1111-1111-1111-111111111111';
select throws_ok(
  $$ insert into public.candidacy_votes (edition_id, candidacy_id, voter_id, weight)
     values ('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111', 5.0) $$,
  '42501', null, 'client cannot set a non-zero weight (trigger tamper guard)'
);

-- re-insert with default weight → trigger writes the constant. user_a HAS an aura_scores row
-- with score 700; the old trigger would have stored 0.700 here. Equal vote ignores it.
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id)
  values ('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111');
select is(
  (select weight from public.candidacy_votes where voter_id = '11111111-1111-1111-1111-111111111111'),
  1.000::numeric, 'weight is server-written 1.000 — a score of 700 does not inflate a vote'
);

-- ── no per-voter leak + public aggregate tally ────────────────────────────────────────
-- user_b votes for their own candidacy too
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.candidacy_votes (edition_id, candidacy_id, voter_id)
  values ('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222');

-- user_a cannot see user_b's votes (own-row SELECT only)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.candidacy_votes where voter_id = '22222222-2222-2222-2222-222222222222')::bigint,
  0::bigint, 'no per-voter leak — own-row SELECT only'
);

-- the public tally returns one aggregate row per candidacy (both voted) — never a voter_id
select is(
  (select count(*) from public.candidacy_tally('00000000-0000-0000-0000-0000000000ed'))::bigint,
  2::bigint, 'candidacy_tally returns aggregates for both candidacies'
);

-- ── move-vote via cast_vote (atomic delete + insert) ──────────────────────────────────
-- reset user_a's vote so cast_vote owns the (edition, voter) row cleanly
delete from public.candidacy_votes where voter_id = '11111111-1111-1111-1111-111111111111';
select cast_vote('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000a1');
select is(
  (select count(*) from public.candidacy_votes where voter_id = '11111111-1111-1111-1111-111111111111')::bigint,
  1::bigint, 'cast_vote leaves exactly one vote'
);
-- move the vote to the other candidacy — still one vote, now on cand_b
select cast_vote('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000b1');
select is(
  (select candidacy_id from public.candidacy_votes where voter_id = '11111111-1111-1111-1111-111111111111'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'cast_vote moves the vote (no duplicate)'
);

-- ── phase gate ────────────────────────────────────────────────────────────────────────
-- flip the cycle out of the voting phase (service role) → cast_vote refuses
reset role;
update public.fund_editions set phase='screening' where id='00000000-0000-0000-0000-0000000000ed';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select cast_vote('00000000-0000-0000-0000-0000000000ed','00000000-0000-0000-0000-0000000000a1') $$,
  'P0001', null, 'cast_vote phase-gated to voting (outside it → P0001)'
);

-- ── zero Aura ─────────────────────────────────────────────────────────────────────────
-- voting emits NO aura_events for either candidacy (rule #1; aura_events cols are type/ref_id)
reset role;
select is(
  (select count(*) from public.aura_events
   where ref_id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1'))::bigint,
  0::bigint, 'voting awards zero Aura (no aura_events)'
);

-- ── equal vote (R-C) ──────────────────────────────────────────────────────────────────
-- Both members have voted by now: user_a with an aura_scores row of 700, user_b with no row at
-- all — the case the old trigger coalesced to weight 0, i.e. a ballot that contributed nothing
-- to the weighted tally. Neither is true any more.
select is(
  (select count(*) from public.candidacy_votes where weight is distinct from 1.000)::bigint,
  0::bigint, 'every stored weight is exactly 1.000 — Aura never tilts the tally (R-C)'
);

-- ...and it is a CONSTRAINT, not merely a convention the trigger happens to honour. service_role
-- holds UPDATE on this table and there is no UPDATE trigger, so without the CHECK a stray write
-- could re-introduce weighting: consensusPercent flips to the weighted share as soon as one row
-- is non-1.000. Asserted AS service_role, the role that actually holds the UPDATE grant.
set local role service_role;
select throws_ok(
  $$ update public.candidacy_votes set weight = 0.500
      where voter_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514', null, 'weight cannot be moved off 1.000, even by service_role (CHECK)'
);
reset role;

-- The trigger must still be bound after the create-or-replace chain (091835 → 094524). `create or
-- replace` preserves the OID so the binding survives, but a future replace could drop it silently.
select has_trigger(
  'public', 'candidacy_votes', 'candidacy_votes_set_weight',
  'the weight trigger is still bound after the equal-vote replacements'
);

-- ...and it is INVOKER now. The DEFINER rationale (20260618131250:50) was "reads aura_scores
-- cross-RLS"; the body reads nothing, so definer would be an unneeded privilege. Pinned so a
-- future replace cannot quietly restore it.
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_candidacy_vote_weight'),
  false, 'set_candidacy_vote_weight is security invoker (it reads nothing)'
);

select * from finish();
rollback;
