begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

-- ── seed ────────────────────────────────────────────────────────────────────────────
-- two members; handle_new_user auto-creates their profiles rows.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'card_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'card_b@test.athanor', '{"locale":"en"}'::jsonb, now(), now());

-- user_a's active dream → the view's `title` (left join on active, non-deleted dream)
insert into public.dreams (profile_id, text, status)
  values ('11111111-1111-1111-1111-111111111111', 'Una casa-laboratorio', 'active');

-- one open edition + two candidacies (service_role bypasses the identity gate):
--   user_a → submitted (members-visible);  user_b → rejected (own-only)
set local role service_role;
insert into public.fund_editions (id, year, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled)
  values ('00000000-0000-0000-0000-0000000000ed', 2027, now() + interval '30 days', 1000000, 'community', true, false);
insert into public.dream_candidacies (id, edition_id, profile_id, story, goal, impact, video_url, plan, status)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000ed',
   '11111111-1111-1111-1111-111111111111','s','g','i','11111111-1111-1111-1111-111111111111/a.mp4','p','submitted'),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000ed',
   '22222222-2222-2222-2222-222222222222','s','g','i','22222222-2222-2222-2222-222222222222/b.mp4','p','rejected');
reset role;

-- ── schema ────────────────────────────────────────────────────────────────────────────
select has_view('public', 'fund_candidate_cards', 'fund_candidate_cards view exists');

-- ── title resolves to the author's active dream ───────────────────────────────────────
-- as user_b, user_a's submitted candidacy card carries the active dream text as title.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select title from public.fund_candidate_cards where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  'Una casa-laboratorio', 'title is the author active dream text'
);

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

select * from finish();
rollback;
