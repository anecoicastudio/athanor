begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

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
insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies)
  values ('00000000-0000-0000-0000-0000000000ed', now() + interval '30 days', 1000000, 'candidacy', true, false,
          100000, 5, 3);
insert into public.dream_candidacies (id, edition_id, profile_id, story, goal, impact, video_url, thumb_path, plan, status)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000ed',
   '11111111-1111-1111-1111-111111111111','s','g','i','11111111-1111-1111-1111-111111111111/a.mp4',
   '11111111-1111-1111-1111-111111111111/a-thumb.jpg','p','submitted'),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000ed',
   '22222222-2222-2222-2222-222222222222','s','g','i','22222222-2222-2222-2222-222222222222/b.mp4',
   null,'p','rejected');
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

-- The bug was a poster column no reader could reach. A column that exists on the table but
-- never made it into the view is the same blank card, so assert the view, not the table.
select is(
  (select thumb_path from public.fund_candidate_cards
    where candidacy_id='00000000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111/a-thumb.jpg',
  'fund_candidate_cards exposes thumb_path'
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
