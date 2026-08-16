begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- ── seed ────────────────────────────────────────────────────────────────────────────
-- three members; handle_new_user auto-creates their profiles rows.
--   card_a — candidacy author, owns the linked dream
--   card_b — a second candidate; the THIRD-PARTY reader for the history assertions
--            (neither helper nor dream owner, i.e. every voter on the ballot)
--   card_c — the helper, and the owner of a soft-deleted dream
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'card_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'card_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'card_c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- user_a's active dream → the view's `title` (left join on active, non-deleted dream), and
-- the dream candidacy A links (#227). user_c's dream is soft-deleted on purpose.
insert into public.dreams (id, profile_id, text, status, deleted_at)
  values
    ('00000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
     'Una casa-laboratorio', 'active', null),
    ('00000000-0000-0000-0000-0000000000d2', '33333333-3333-3333-3333-333333333333',
     'Un sogno cancellato', 'active', now());

set local role service_role;

-- Two tappe on the linked dream: one done, one open. Only the done one is history (#227).
insert into public.dream_milestones (id, dream_id, body, status)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'Trovare lo spazio', 'done'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'Comprare il forno', 'open'),
  -- under the soft-deleted dream: a done milestone that must NOT become history
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d2', 'Una tappa orfana', 'done');

-- Two helps from user_c: one completed (history), one merely offered (a promise, not
-- history). Written as service_role because the insert policy pins new helps to 'offered'.
insert into public.milestone_helps (milestone_id, helper_id, type, status)
values
  ('00000000-0000-0000-0000-0000000000f1', '33333333-3333-3333-3333-333333333333', 'skill', 'completed'),
  ('00000000-0000-0000-0000-0000000000f2', '33333333-3333-3333-3333-333333333333', 'connection', 'offered');

-- one open edition + two candidacies (service_role bypasses the identity gate):
--   user_a → shortlisted (members-visible: the ballot is the SCREENED set from #218 on),
--            links dream d1;
--   user_b → rejected (own-only), links nothing
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
  values ('00000000-0000-0000-0000-0000000000ed', now() + interval '30 days', 1000000, 'candidacy', true, false,
          100000, 5, 3, 10, 'fixture costs statement', 'none');
insert into public.dream_candidacies (id, edition_id, profile_id, story, goal, impact, video_url, thumb_path, plan, status, budget_cents, min_viable_cents, skills_needed, category, dream_id, rejection_reasons)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000ed',
   '11111111-1111-1111-1111-111111111111','s','g','i','11111111-1111-1111-1111-111111111111/a.mp4',
   '11111111-1111-1111-1111-111111111111/a-thumb.jpg','p','shortlisted', 800000, 500000,
   array['design','video'], 'artistic', '00000000-0000-0000-0000-0000000000d1', null),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000ed',
   '22222222-2222-2222-2222-222222222222','s','g','i','22222222-2222-2222-2222-222222222222/b.mp4',
   null,'p','rejected', 800000, 500000, '{}', null, null, array['plan_coherent']);
reset role;

-- ── schema ────────────────────────────────────────────────────────────────────────────
select has_view('public', 'fund_candidate_cards', 'fund_candidate_cards view exists');

-- ── title resolves to the author's active dream ───────────────────────────────────────
-- as user_b, user_a's shortlisted candidacy card carries the active dream text as title.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select title from public.fund_candidate_cards where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  'Una casa-laboratorio', 'title is the author active dream text'
);

-- The bug was a poster column no reader could reach. A column that exists on the table but
-- never made it into the view is the same blank card, so assert the view, not the table.
select is(
  (select thumb_path from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111/a-thumb.jpg',
  'fund_candidate_cards exposes thumb_path'
);

-- ── #227: the numbers a voter is being asked to weigh ─────────────────────────────────
-- Same argument as thumb_path above: #225 put these on dream_candidacies, and a column the
-- view never carried is a number no voter can see. min_viable_cents is BALLOT INFORMATION
-- (D11) — its presence here is not, and must never become, a shortfall gate.
select is(
  (select budget_cents from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  800000::bigint, 'fund_candidate_cards exposes budget_cents'
);
select is(
  (select min_viable_cents from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  500000::bigint, 'fund_candidate_cards exposes min_viable_cents'
);
select is(
  (select skills_needed from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  array['design','video'], 'fund_candidate_cards exposes skills_needed'
);
select is(
  (select dream_id from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'fund_candidate_cards exposes dream_id'
);

-- ── #227: the linked dream's CONFIRMED history, read by a third party ─────────────────
-- user_b is neither the helper (user_c) nor the dream owner (user_a) — i.e. every voter.
-- Two tappe exist and one is done; two helps exist and one is completed. The counts are 1
-- and 1, never 2: an open tappa and an offered help are promises, not history.
select is(
  (select dream_milestones_done from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  1, 'a voter sees the linked dream''s DONE milestones (open ones excluded)'
);
select is(
  (select dream_helps_confirmed from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  1, 'a voter sees the linked dream''s COMPLETED helps (offered ones excluded)'
);

-- ...and this is why the count comes from a DEFINER aggregate rather than a join.
-- milestone_helps_select_party admits the helper or the dream owner and nobody else, so the
-- same reader gets ZERO rows from the table directly. A plain join into a security_invoker
-- view would have rendered «helped by no one» about a member who was helped — an RLS
-- artefact wearing the shape of a fact. If this ever starts returning 2, the aggregate is
-- no longer necessary and the view should go back to a join.
select is(
  (select count(*) from public.milestone_helps)::bigint,
  0::bigint, 'a voter reads no milestone_helps rows directly (party-scoped RLS)'
);

-- An unlinked candidacy carries NULL history, not zeros: «no dream linked» and «a linked
-- dream with nothing confirmed yet» are different sentences and the card renders them
-- differently. user_b reads their own rejected row.
select is(
  (select dream_milestones_done from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000b1'),
  null::int, 'an unlinked candidacy has null dream_milestones_done (not 0)'
);
select is(
  (select dream_helps_confirmed from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000b1'),
  null::int, 'an unlinked candidacy has null dream_helps_confirmed (not 0)'
);

-- A soft-deleted dream speaks for nobody, even though its done tappa still exists.
-- Asserted on the function because no fixture candidacy links a dead dream (one candidacy
-- per member per edition), and the branch is worth pinning.
select is(
  (select milestones_done from athanor.dream_confirmed_counts('00000000-0000-0000-0000-0000000000d2')),
  null::int, 'a soft-deleted dream yields no confirmed history'
);

-- A privileged reader must get the counts, not an error. The aggregate sits inside the view
-- now, so EXECUTE on it is a precondition for reading ANY column: the first cut granted it to
-- `authenticated` only and a service-role select on the whole view died with 42501
-- («permission denied for function dream_confirmed_counts»), which is how 20260816153011
-- came to exist. This is the assertion that found it — keep it pointed at the view, not at
-- the function, because the function is not what a privileged surface calls.
set local role service_role;
select is(
  (select dream_milestones_done from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  1, 'a service-role reader gets the confirmed history, not a permission error'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- ── visibility: own rejected card visible to author only ──────────────────────────────
-- user_b sees their own rejected candidacy (own-any-status read on dream_candidacies)
select is(
  (select count(*) from public.fund_candidate_cards
   where profile_id='22222222-2222-2222-2222-222222222222')::bigint,
  1::bigint, 'author sees own rejected candidacy card'
);

-- user_a does NOT see user_b's rejected candidacy (security_invoker → underlying RLS denies)
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.fund_candidate_cards
   where profile_id='22222222-2222-2222-2222-222222222222')::bigint,
  0::bigint, 'rejected candidacy card is private to its author'
);
reset role;

-- ── unauthorised actor: anon ──────────────────────────────────────────────────────────
-- The cross-member case above is the only negative this file carried. A candidacy card is a
-- member's dream, story and video -- the whole surface is members-only, and the view is the
-- one place that joins them into a single readable row. `20260618131250_m7_voting.sql:158`
-- revokes all from anon; assert the door, not the intent.

-- the view is not readable by anon at all (privilege, not row filtering)
select is(
  has_table_privilege('anon', 'public.fund_candidate_cards', 'select'),
  false,
  'anon holds no SELECT privilege on fund_candidate_cards'
);

-- ...and the #227 aggregate is not callable by anon either, so the door holds on the
-- DEFINER function too (its whole job is to cross an RLS boundary).
select is(
  has_function_privilege('anon', 'athanor.dream_confirmed_counts(uuid)', 'execute'),
  false,
  'anon holds no EXECUTE on athanor.dream_confirmed_counts'
);

-- ...and an actual anon read is refused rather than returning an empty set
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.fund_candidate_cards $$,
  '42501', null,
  'anon cannot read fund_candidate_cards (members-only surface)'
);
reset role;

-- security_invoker is what makes the cross-member negative above hold. Without it the view
-- would run as its owner and bypass dream_candidacies RLS entirely, handing every rejected
-- candidacy to every caller -- and the two assertions above would still pass.
select ok(
  exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace,
      unnest(coalesce(c.reloptions, '{}'::text[])) as o
     where n.nspname = 'public' and c.relname = 'fund_candidate_cards'
       and o in ('security_invoker=true', 'security_invoker=on')
  ),
  'fund_candidate_cards is security_invoker (caller RLS composes, not the view owner''s)'
);

select * from finish();
rollback;
