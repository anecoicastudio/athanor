begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

-- #218 screen_candidacy(): the one screening transition path, and every way it refuses.
-- FUND-52 · D4 (ballot final), D5 (objective criteria), D6 (reasons + appeal).
-- Fixture: any live cycle is parked 'closed' first (no-op in CI's empty stack; on the
-- staging smoke it frees fund_editions_one_active for the fixture cycle, all rolled back).
-- Four candidates: u1 verified (the pass path), u2 unverified (identity re-check + the
-- reject/reopen path), u3 suspended (sanction re-check), u4 verified (the freeze path).

-- closure_reason since #216: a closed row must name why (fund_editions_closure_reason_shape);
-- 'realized' is a fixture value, rolled back with everything else.
update public.fund_editions set phase = 'closed', closure_reason = 'realized' where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('b0000000-0000-0000-0000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'scr_u' || i || '@test.athanor', '{}'::jsonb, now(), now()
  from generate_series(1, 4) i;

-- u3 is verified AND suspended, so the sanction refusal is what fires (identity is
-- checked first in the ladder).
update public.profiles set identity_verified = true
 where id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003',
              'b0000000-0000-0000-0000-000000000004');
update public.profiles set suspended_until = now() + interval '7 days'
 where id = 'b0000000-0000-0000-0000-000000000003';

set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('00000000-0000-0000-0000-0000000000ed', now() + interval '30 days', 5000000, 'candidacy', true, false,
          100000, 3, 1, 10, 'fixture costs statement', 'none');
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents)
select ('d0000000-0000-0000-0000-00000000000' || i)::uuid,
       '00000000-0000-0000-0000-0000000000ed',
       ('b0000000-0000-0000-0000-00000000000' || i)::uuid,
       's', 'g', 'i', 'v.mp4', 'p', 800000, 500000
  from generate_series(1, 4) i;

-- ── structure: the published criteria ───────────────────────────────────────────────────
select has_table('public', 'screening_criteria', 'screening_criteria exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.screening_criteria'::regclass),
  'RLS enabled on screening_criteria');
select results_eq(
  $$ select code from public.screening_criteria order by sort $$,
  $$ values ('identity_verified'), ('proposal_complete'), ('no_moderation_sanction'), ('plan_coherent') $$,
  'exactly D5''s four objective criteria, in publication order — and no Aura criterion');
select is(
  has_table_privilege('anon', 'public.screening_criteria', 'select'),
  true, 'published means published: anon reads the criteria (FUND-52, the #237 page)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ insert into public.screening_criteria (code, sort) values ('aura_floor', 5) $$,
  '42501', null, 'a client cannot add a criterion (D5 is not client-amendable)');
reset role;

-- ── structure: the transition function ──────────────────────────────────────────────────
select has_function('public', 'screen_candidacy', array['uuid','text','text[]'],
  'screen_candidacy(uuid, text, text[]) exists');
select has_column('public', 'dream_candidacies', 'rejection_reasons',
  'dream_candidacies carries rejection_reasons');

-- service-role only (rule 8): the clients hold no execute
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'start') $$,
  '42501', null, 'authenticated cannot execute screen_candidacy');
reset role;
set local role anon;
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'start') $$,
  '42501', null, 'anon cannot execute screen_candidacy');
reset role;

-- ── the refusal ladder, as the real caller (service_role) ───────────────────────────────
set local role service_role;

select throws_ok(
  $$ select public.screen_candidacy('00000000-0000-0000-0000-00000000dead', 'start') $$,
  'P0001', 'candidacy not found', 'an unknown candidacy refuses');
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'promote') $$,
  'P0001', 'unknown decision', 'a decision outside the vocabulary refuses');
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'pass',
                                    array['plan_coherent']) $$,
  'P0001', 'reasons only on rejection', 'reasons on a non-reject decision refuse');

-- start: submitted → screening
select is(
  public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'start'),
  'screening', 'start moves submitted → screening');
select is(
  (select status from public.dream_candidacies where id = 'd0000000-0000-0000-0000-000000000001'),
  'screening', 'the status write landed');
select is(
  (select count(*)::int from public.audit_log
    where action = 'screen_start'
      and edition_id = '00000000-0000-0000-0000-0000000000ed'
      and candidacy_id = 'd0000000-0000-0000-0000-000000000001'
      and actor_id is null and report_id is null),
  1, 'one audit_log row records the start (fund shape: edition, no report, no user actor)');
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'start') $$,
  'P0001', 'invalid transition', 'start is not re-runnable on a screening row');
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'reopen') $$,
  'P0001', 'invalid transition', 'reopen needs a rejected row');

-- pass re-checks D5's machine-checkable half: u2 is NOT identity-verified
select is(
  public.screen_candidacy('d0000000-0000-0000-0000-000000000002', 'start'),
  'screening', 'u2''s candidacy enters screening');
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000002', 'pass') $$,
  'P0001', 'identity not verified', 'pass refuses when identity is no longer verified (D5)');

-- ...and u3 sits under an active suspension
select is(
  public.screen_candidacy('d0000000-0000-0000-0000-000000000003', 'start'),
  'screening', 'u3''s candidacy enters screening');
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000003', 'pass') $$,
  'P0001', 'moderation sanction active', 'pass refuses under an active sanction (D5)');

-- reject: reasons are mandatory and drawn from the published criteria only (D6)
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000002', 'reject') $$,
  'P0001', 'rejection requires reasons', 'a reasonless rejection refuses');
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000002', 'reject',
                                    array['aura_too_low']) $$,
  'P0001', 'unknown criterion', 'a reason outside the published criteria refuses (no Aura reason exists)');
select is(
  public.screen_candidacy('d0000000-0000-0000-0000-000000000002', 'reject',
                          array['identity_verified','plan_coherent']),
  'rejected', 'a reasoned rejection lands');
select is(
  (select rejection_reasons from public.dream_candidacies
    where id = 'd0000000-0000-0000-0000-000000000002'),
  array['identity_verified','plan_coherent'], 'the rejection carries its reasons on the row');
select is(
  (select reason from public.audit_log
    where action = 'screen_reject' and candidacy_id = 'd0000000-0000-0000-0000-000000000002'),
  'criteria not met: identity_verified, plan_coherent',
  'the audit row names the failed criteria');
reset role;

-- the rejected author reads their own reasons — a candidate is told what to fix (D5/D6)
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select rejection_reasons from public.dream_candidacies
    where id = 'd0000000-0000-0000-0000-000000000002'),
  array['identity_verified','plan_coherent'], 'the rejected author reads their own reasons');
reset role;

-- reopen: the appeal path (D6) — back to screening, reasons cleared
set local role service_role;
select is(
  public.screen_candidacy('d0000000-0000-0000-0000-000000000002', 'reopen'),
  'screening', 'reopen moves rejected → screening (the appeal)');
select is(
  (select rejection_reasons from public.dream_candidacies
    where id = 'd0000000-0000-0000-0000-000000000002'),
  null, 'reopen clears the recorded reasons');

-- the pass path itself: u1 is verified and unsanctioned
select is(
  public.screen_candidacy('d0000000-0000-0000-0000-000000000001', 'pass'),
  'shortlisted', 'pass moves screening → shortlisted');
reset role;

-- rejection_reasons is not a client surface: even the author of a submitted row cannot
-- write it — the two-sided CHECK refuses reasons off status='rejected'.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ update public.dream_candidacies set rejection_reasons = array['plan_coherent']
      where id = 'd0000000-0000-0000-0000-000000000004' $$,
  '23514', null, 'reasons cannot exist off a rejected row (two-sided CHECK)');
reset role;

-- ── D4: once the ballot opens the field is fixed ────────────────────────────────────────
-- Open the ballot for real (window + minimum → the fund_editions_ballot_open trigger
-- admits it; C1 is shortlisted, min_candidacies = 1)…
set local role service_role;
update public.fund_editions
   set voting_starts_at = now() - interval '1 hour', voting_ends_at = now() + interval '1 day'
 where id = '00000000-0000-0000-0000-0000000000ed';
update public.fund_editions set phase = 'voting'
 where id = '00000000-0000-0000-0000-0000000000ed';
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000004', 'start') $$,
  'P0001', 'screening out of phase', 'from voting on, no screening decision lands (D4)');

-- …and the belt: a lagging phase with a passed voting_starts_at refuses too.
update public.fund_editions set phase = 'screening'
 where id = '00000000-0000-0000-0000-0000000000ed';
select throws_ok(
  $$ select public.screen_candidacy('d0000000-0000-0000-0000-000000000004', 'start') $$,
  'P0001', 'ballot already open', 'a passed voting_starts_at freezes screening even in a lagging phase');
reset role;

-- ── rule #1: screening emits zero Aura ──────────────────────────────────────────────────
select is(
  (select count(*)::int from public.aura_events
    where ref_id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002',
                     'd0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004')),
  0, 'the whole screening flow emits no aura_events');

-- ── the audit CHECKs still pin shapes ───────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.audit_log (action, edition_id) values ('screen_bogus', '00000000-0000-0000-0000-0000000000ed') $$,
  '23514', null, 'an action outside the vocabulary is a CHECK violation');
select throws_ok(
  $$ insert into public.audit_log (action) values ('screen_pass') $$,
  '23514', null, 'a screening audit row requires edition_id (fund shape)');

select * from finish();
rollback;
