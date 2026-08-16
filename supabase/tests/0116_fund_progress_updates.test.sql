-- #230 — public progress updates bound to the cycle.
-- FUND-26 («the community can follow the project's progress») · docs/FUND-SPEC.md
-- §"Realization" · divergence D-14.
--
-- Asserts, in the database: the confirmed WINNER writes, and only while the cycle is in
-- 'realization'; a stranger cannot post, spoof the author, or edit what the winner wrote;
-- the world — signed out included — reads the trail; a withdrawal is a soft delete that
-- disappears from every public read while staying readable to its author; a note's phase
-- link cannot point at another cycle's plan; the feed's keyset order is stable while rows
-- arrive underneath a reader; and posting earns ZERO Aura (rule #1).
--
-- The write half runs as a CLIENT throughout (`set local role authenticated` + a jwt
-- claim): the claim #230 makes is about the winner writing through RLS, and a service-role
-- fixture would prove nothing about it.
--
-- WHAT IS DELIBERATELY NOT ASSERTED: any interaction with close_cycle(). Progress is
-- evidence, not a gate — the outcome is close_cycle()'s operator-supplied parameter and the
-- tranche gate is #231's verified_at. A test that wired the two would be asserting a
-- mechanism the spec does not have.
begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

-- fixture: park any live cycle (staging smoke; no-op in CI) — the 0108/0110/0114/0115 pattern
update public.fund_editions set phase = 'closed', closure_reason = 'realized'
 where phase <> 'closed';

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '01160000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'progress_win@test.athanor', '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '01160000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'progress_other@test.athanor', '{}'::jsonb, now(), now());

-- ── structure ───────────────────────────────────────────────────────────────────────────
select has_table('public', 'realization_updates', 'realization_updates exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.realization_updates'::regclass),
  'RLS enabled on realization_updates');
-- The whole shape, pinned. This is rule #3's structural teeth as much as a schema check:
-- a reaction count or a view count would have to appear in this list to exist, and the
-- assertion is what makes adding one a deliberate act rather than a drive-by column.
select columns_are('public', 'realization_updates',
  array['id', 'edition_id', 'profile_id', 'plan_phase_id', 'body',
        'deleted_at', 'created_at', 'updated_at'],
  'no reaction count, no view count, no column that could become one (rule #3)');
select policies_are('public', 'realization_updates',
  array['realization_updates_select_live',
        'realization_updates_select_own',
        'realization_updates_select_admin',
        'realization_updates_insert_own_realizing',
        'realization_updates_update_own_realizing',
        -- #106's restrictive net (20260816101609): a member speaking in public does so
        -- while active. The plan carries no net and should not — see that migration.
        'active_write_insert', 'active_write_update', 'active_write_delete'],
  'the public/own/admin selects, the winner''s insert and update, and #106''s net — no permissive delete policy, ever');
select has_trigger('public', 'realization_updates', 'realization_updates_touch_updated_at',
  'realization_updates carries the touch_updated_at trigger');
select has_trigger('public', 'realization_updates', 'realization_updates_binds_winner',
  'realization_updates carries the winner-binding trigger');
select col_is_null('public', 'realization_updates', 'deleted_at',
  'deleted_at is nullable: this IS user content, unlike the plan (#228 omitted it on purpose)');
select has_index('public', 'realization_updates', 'realization_updates_feed',
  'the feed index exists — (edition_id, created_at desc, id desc) where deleted_at is null (rule #9)');

-- What a policy cannot say, the grants do.
select ok(
  not has_table_privilege('authenticated', 'public.realization_updates', 'delete'),
  'no client hard-deletes a public note — withdrawal is deleted_at');
select ok(
  not has_column_privilege('authenticated', 'public.realization_updates', 'edition_id', 'update'),
  'a note never re-targets a cycle');
select ok(
  not has_column_privilege('authenticated', 'public.realization_updates', 'profile_id', 'update'),
  'a note never changes hands');
select ok(
  has_column_privilege('authenticated', 'public.realization_updates', 'deleted_at', 'update'),
  'withdrawal IS an update of deleted_at, so the column is granted');

-- ── fixture: two cycles, each with a confirmed winner and a published plan ──────────────
--   e1 — REALIZATION, pool 50000 / split 10 → payable 45000, winner c1 (profile 1)
--   e2 — closed realized, pool 20000 / split 10 → payable 18000, winner c2 (profile 2)
set local role service_role;
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01160000-0000-0000-0000-0000000000e1', now() + interval '30 days', 5000000, 'realization', false, false,
          100000, 1, 1, 10, 'fixture costs statement', 'none', 50000);
insert into public.fund_editions (id, target_at, goal_cents, phase, closure_reason, candidacy_window_open,
                                  contributions_enabled, min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared, confirmed_pool_cents)
  values ('01160000-0000-0000-0000-0000000000e2', now() + interval '30 days', 100000, 'closed', 'realized',
          false, false, 1, 1, 1, 10, 'fixture costs statement', 'none', 20000);
reset role;

insert into public.dream_candidacies
  (id, edition_id, profile_id, story, goal, impact, video_url, plan, budget_cents, min_viable_cents, status)
values
  ('01160000-0000-0000-0000-0000000000c1', '01160000-0000-0000-0000-0000000000e1',
   '01160000-0000-0000-0000-000000000001', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner'),
  ('01160000-0000-0000-0000-0000000000c2', '01160000-0000-0000-0000-0000000000e2',
   '01160000-0000-0000-0000-000000000002', 's', 'g', 'i', 'v.mp4', 'p', 800000, 500000, 'winner');

set local role service_role;
update public.fund_editions
   set winner_candidacy_id = '01160000-0000-0000-0000-0000000000c1', winner_confirmed_at = now()
 where id = '01160000-0000-0000-0000-0000000000e1';
update public.fund_editions
   set winner_candidacy_id = '01160000-0000-0000-0000-0000000000c2', winner_confirmed_at = now()
 where id = '01160000-0000-0000-0000-0000000000e2';
-- A published plan per cycle, each with one phase. #229's authoring path is 0115's; here a
-- plan exists only so a note has a phase to point at, and so the CROSS-CYCLE phase can be
-- refused with a real id rather than a fabricated one.
insert into public.realization_plans (id, edition_id, candidacy_id, objective, expected_result, published_at)
values
  ('01160000-0000-0000-0000-0000000000d1', '01160000-0000-0000-0000-0000000000e1',
   '01160000-0000-0000-0000-0000000000c1', 'aprire il laboratorio', 'un laboratorio aperto', now()),
  ('01160000-0000-0000-0000-0000000000d2', '01160000-0000-0000-0000-0000000000e2',
   '01160000-0000-0000-0000-0000000000c2', 'un altro sogno', 'un altro risultato', now());
insert into public.realization_plan_phases (id, plan_id, sort, title, scheduled_for, amount_cents, verification_criteria)
values
  ('01160000-0000-0000-0000-0000000000f1', '01160000-0000-0000-0000-0000000000d1',
   1, 'allestimento', current_date, 20000, 'contratto firmato'),
  ('01160000-0000-0000-0000-0000000000f2', '01160000-0000-0000-0000-0000000000d2',
   1, 'altra fase', current_date, 10000, 'altra verifica');
reset role;

-- ── the winner posts, as a client ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000001',
             'Le chiavi sono nostre. Il laboratorio esiste.') $$,
  'the confirmed winner posts a note about the project — no relay, no service role');
select lives_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, plan_phase_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000001',
             '01160000-0000-0000-0000-0000000000f1', 'Allestimento finito, foto in arrivo.') $$,
  'and one bound to a phase of their own cycle''s plan');
select throws_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, plan_phase_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000001',
             '01160000-0000-0000-0000-0000000000f2', 'la fase di un altro') $$,
  'P0001', 'plan phase belongs to another cycle',
  'a note cannot be filed under another cycle''s phase — an attribution that can lie is worse than none');
select throws_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, plan_phase_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000001',
             '01160000-0000-0000-0000-00000000ffff', 'una fase che non esiste') $$,
  'P0001', 'plan phase not found', 'nor under a phase that does not exist');
select throws_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000001', '   ') $$,
  '23514', null, 'a blank body is refused by the CHECK the Zod schema mirrors');

-- ── a member who is not this cycle's winner ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000002',
             'parlo io del sogno di un altro') $$,
  'P0001', 'not the cycle winner',
  'a stranger cannot speak for a funded project — the trigger binds the author, not only the policy');
-- The spoof: the BEFORE trigger passes (that profile IS the winner), so what refuses here
-- is the insert policy's WITH CHECK pinning profile_id to the caller. Both gates are
-- needed, and this is the assertion that proves neither is the other's restatement.
select throws_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000001',
             'firmo con il nome del vincitore') $$,
  '42501', null, 'and cannot post under the winner''s name — WITH CHECK pins profile_id to the caller');
-- Their OWN cycle is closed: realization is over, so its trail is frozen.
select throws_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, body)
     values ('01160000-0000-0000-0000-0000000000e2', '01160000-0000-0000-0000-000000000002',
             'il mio ciclo è chiuso ma scrivo lo stesso') $$,
  '42501', null,
  'a closed cycle takes no further notes — «bound to the cycle» is a window in time, not only an FK');
-- RLS filters an UPDATE rather than raising; what it cost is measured from anon, below.
update public.realization_updates set body = 'dirottato';

-- ── the world reads it, signed out included (FUND-26) ───────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select count(*)::int from public.realization_updates
    where edition_id = '01160000-0000-0000-0000-0000000000e1'),
  2, 'anon reads the cycle''s trail — this is the transparency promise, not a members-only feed');
select is(
  (select count(*)::int from public.realization_updates where body = 'dirottato'),
  0, 'the stranger''s UPDATE reached no row');

-- ── withdrawal is a soft delete ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ update public.realization_updates set body = 'Le chiavi sono nostre. Il laboratorio è aperto.'
      where body = 'Le chiavi sono nostre. Il laboratorio esiste.' $$,
  'the author corrects their own note while the cycle is realizing');
select lives_ok(
  $$ update public.realization_updates set deleted_at = now()
      where plan_phase_id = '01160000-0000-0000-0000-0000000000f1' $$,
  'and withdraws one — an UPDATE of deleted_at, the only removal there is');
select throws_ok(
  $$ delete from public.realization_updates $$,
  '42501', null, 'a hard delete is refused at the grant, whatever a policy might allow');
select is(
  (select count(*)::int from public.realization_updates where deleted_at is not null),
  1, 'the withdrawn note stays readable to its author (realization_updates_select_own)');
-- USING carries `deleted_at is null` and WITH CHECK does not: withdrawal works, and a
-- withdrawn note is not editable again.
update public.realization_updates set body = 'ci ripenso'
 where plan_phase_id = '01160000-0000-0000-0000-0000000000f1';
select is(
  (select count(*)::int from public.realization_updates where body = 'ci ripenso'),
  0, 'a withdrawn note cannot be edited back into existence');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select count(*)::int from public.realization_updates
    where edition_id = '01160000-0000-0000-0000-0000000000e1'),
  1, 'the withdrawn note is gone from every public read');

-- ── #106's net: a member speaking in public does so while active ────────────────────────
-- The plan deliberately carries no net (20260816101609's header says why); a public note
-- does, and this is that claim's teeth. Reads stay open throughout — a suspension silences
-- the author, it does not delete the community's trail.
set local role service_role;
update public.profiles set suspended_until = now() + interval '7 days'
 where id = '01160000-0000-0000-0000-000000000001';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ insert into public.realization_updates (edition_id, profile_id, body)
     values ('01160000-0000-0000-0000-0000000000e1', '01160000-0000-0000-0000-000000000001',
             'scrivo mentre sono sospeso') $$,
  '42501', null, 'a suspended winner cannot post — the restrictive net ANDs on top of the insert policy');
select is(
  (select count(*)::int from public.realization_updates
    where edition_id = '01160000-0000-0000-0000-0000000000e1' and deleted_at is null),
  1, 'and their existing trail is still readable — suspended is not erased');
set local role service_role;
update public.profiles set suspended_until = null
 where id = '01160000-0000-0000-0000-000000000001';
reset role;

-- ── the feed's keyset order, and its stability while rows arrive (rule #9) ──────────────
-- Three notes sharing one created_at is the concurrent-insert case in its hardest form:
-- `created_at desc` alone cannot order them, so the tie-break on id is the whole reason the
-- cursor is a PAIR. An OFFSET pager passes the first assertion below and fails the third.
set local role service_role;
delete from public.realization_updates;
insert into public.realization_updates (id, edition_id, profile_id, body, created_at)
values
  ('01160000-0000-0000-0000-00000000a001', '01160000-0000-0000-0000-0000000000e1',
   '01160000-0000-0000-0000-000000000001', 'nota a', '2026-08-16T10:00:00Z'),
  ('01160000-0000-0000-0000-00000000a002', '01160000-0000-0000-0000-0000000000e1',
   '01160000-0000-0000-0000-000000000001', 'nota b', '2026-08-16T10:00:00Z'),
  ('01160000-0000-0000-0000-00000000a003', '01160000-0000-0000-0000-0000000000e1',
   '01160000-0000-0000-0000-000000000001', 'nota c', '2026-08-16T10:00:00Z');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
-- Page 1: the newest two in (created_at desc, id desc).
select is(
  (select array_agg(body order by created_at desc, id desc) from (
     select body, created_at, id from public.realization_updates
      where edition_id = '01160000-0000-0000-0000-0000000000e1'
      order by created_at desc, id desc limit 2) page1),
  array['nota c', 'nota b'],
  'page 1 is the newest two, tie-broken on id — a total order, never an ambiguous one');
-- Page 2 from the cursor (the last row of page 1) — the api layer's exact predicate.
select is(
  (select array_agg(body order by created_at desc, id desc) from (
     select body, created_at, id from public.realization_updates
      where edition_id = '01160000-0000-0000-0000-0000000000e1'
        and (created_at, id) < ('2026-08-16T10:00:00Z'::timestamptz,
                                '01160000-0000-0000-0000-00000000a002'::uuid)
      order by created_at desc, id desc limit 2) page2),
  array['nota a'],
  'page 2 continues strictly after the cursor — no row repeated, none skipped');

-- A note arrives between the two fetches. The cursor page must not move: that is the
-- property an OFFSET does not have, and the reason rule #9 exists.
set local role service_role;
insert into public.realization_updates (id, edition_id, profile_id, body, created_at)
values ('01160000-0000-0000-0000-00000000a004', '01160000-0000-0000-0000-0000000000e1',
        '01160000-0000-0000-0000-000000000001', 'nota d (arrivata dopo)', '2026-08-16T11:00:00Z');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select array_agg(body order by created_at desc, id desc) from (
     select body, created_at, id from public.realization_updates
      where edition_id = '01160000-0000-0000-0000-0000000000e1'
        and (created_at, id) < ('2026-08-16T10:00:00Z'::timestamptz,
                                '01160000-0000-0000-0000-00000000a002'::uuid)
      order by created_at desc, id desc limit 2) page2),
  array['nota a'],
  'the same cursor returns the same page after a concurrent insert — offset 2 would now skip «nota a»');
select is(
  (select count(*)::int from public.realization_updates
    where edition_id = '01160000-0000-0000-0000-0000000000e1'),
  4, 'and the new note is simply the newest — the trail grows at the head');
select is(
  (select body from public.realization_updates
    where edition_id = '01160000-0000-0000-0000-0000000000e1' and deleted_at is null
    order by created_at desc, id desc limit 1),
  'nota d (arrivata dopo)', 'newest first is what the feed returns');

-- ── rule #1 tooth: posting progress earns ZERO Aura ─────────────────────────────────────
-- The same claim #228/#229 make from the plan's side: nothing in the fund grants points,
-- and the trail the community follows is not a farm.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01160000-0000-0000-0000-000000000001","role":"authenticated"}';
select triggers_are('public', 'realization_updates',
  array['realization_updates_touch_updated_at', 'realization_updates_binds_winner'],
  'exactly two triggers, and neither awards Aura — a score trigger here would make posting earn');
select is(
  (select count(*)::int from public.aura_events
   where profile_id in ('01160000-0000-0000-0000-000000000001',
                        '01160000-0000-0000-0000-000000000002')),
  0, 'no aura_events for either fixture profile (posting progress = 0 Aura)');

-- ── the boundary this issue does NOT cross ──────────────────────────────────────────────
-- Progress is evidence, never a declaration: close_cycle() reads no note, and nothing above
-- moved the cycle. Asserted so a future change that wires the two has to delete this line
-- on purpose.
select is(
  (select phase from public.fund_editions where id = '01160000-0000-0000-0000-0000000000e1'),
  'realization', 'posting notes never moves the cycle — closure stays close_cycle()''s act (#221/#231)');

select * from finish();
rollback;
