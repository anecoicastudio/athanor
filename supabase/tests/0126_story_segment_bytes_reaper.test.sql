-- Story-segment bytes reaper (#31): the deletion half of the story-segment storage gap.
--
-- 20260809151111 hides an expired/soft-deleted segment's object; 20260614230935 soft-deletes
-- the rows; 20260821075230 (+ 20260821082216, the review follow-up) adds the part that frees
-- the bytes. Deletion goes through the Storage API (the edge function), so what SQL owns —
-- and what this file asserts — is the candidate predicate `story_segment_reap_candidates`,
-- the pg_net caller, the extended nightly wrapper, and the rescheduled job. The predicate is
-- the storage SELECT policy's descriptor predicate INVERTED with a 1 h grace, and the three
-- cases the issue names are each a fixture row below: a pinned, undeleted step is never a
-- candidate, an in-flight upload is never a candidate, and a seeded row the hourly staging
-- refresh revives in place is never a candidate while the refresh runs — nor after it
-- catches up from a gap. The inverse relationship is checked against the REAL policy, read
-- as a member, not against a copy of its text.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- ── 1. the candidate enumeration: shape and grants ───────────────────────────
select has_function('public', 'story_segment_reap_candidates', array['integer', 'interval'],
  'story_segment_reap_candidates(p_limit, p_grace) exists');
select isnt_definer('public', 'story_segment_reap_candidates', array['integer', 'interval'],
  'story_segment_reap_candidates is security INVOKER — service_role needs no definer rights (20260821082216)');
select is(
  (select proconfig from pg_proc
    where oid = 'public.story_segment_reap_candidates(integer, interval)'::regprocedure),
  array['search_path=""'], 'story_segment_reap_candidates locks search_path to empty');
select volatility_is('public', 'story_segment_reap_candidates', array['integer', 'interval'], 'stable',
  'story_segment_reap_candidates is STABLE: it lists, the Storage API deletes');
select ok(not has_function_privilege('anon', 'public.story_segment_reap_candidates(integer, interval)', 'execute'),
  'anon cannot enumerate reap candidates');
select ok(not has_function_privilege('authenticated', 'public.story_segment_reap_candidates(integer, interval)', 'execute'),
  'authenticated cannot enumerate reap candidates');
select ok(not has_function_privilege('public', 'public.story_segment_reap_candidates(integer, interval)', 'execute'),
  'public cannot enumerate reap candidates');
select ok(has_function_privilege('service_role', 'public.story_segment_reap_candidates(integer, interval)', 'execute'),
  'service_role — the reaper''s client — can');

-- ── 2. the pg_net caller ─────────────────────────────────────────────────────
select has_function('public', 'invoke_story_segment_reaper', array[]::text[],
  'invoke_story_segment_reaper exists');
select is_definer('public', 'invoke_story_segment_reaper', array[]::text[],
  'invoke_story_segment_reaper is security definer (posts HTTP only, like every pg_net caller)');
select is(
  (select proconfig from pg_proc where oid = 'public.invoke_story_segment_reaper()'::regprocedure),
  array['search_path=""'], 'invoke_story_segment_reaper locks search_path to empty');
select ok(not has_function_privilege('anon', 'public.invoke_story_segment_reaper()', 'execute'),
  'anon cannot invoke the reaper');
select ok(not has_function_privilege('authenticated', 'public.invoke_story_segment_reaper()', 'execute'),
  'authenticated cannot invoke the reaper');
select ok(not has_function_privilege('public', 'public.invoke_story_segment_reaper()', 'execute'),
  'public cannot invoke the reaper');
-- reads config through the resolver, so a Vault rotation is picked up (rule 8) …
select ok(
  (select prosrc from pg_proc where oid = 'public.invoke_story_segment_reaper()'::regprocedure)
    like '%runtime_setting%',
  'the caller resolves url/key through athanor.runtime_setting');
-- … and presents it on the apikey header, never a hand-built Authorization bearer.
select ok(
  (select prosrc from pg_proc where oid = 'public.invoke_story_segment_reaper()'::regprocedure)
    like '%edge_auth_headers%',
  'the caller builds headers through athanor.edge_auth_headers');

-- ── 3. the extended nightly wrapper ──────────────────────────────────────────
select has_function('public', 'prune_expired_story_segments', array[]::text[],
  'prune_expired_story_segments exists');
select isnt_definer('public', 'prune_expired_story_segments', array[]::text[],
  'prune_expired_story_segments is security invoker (does its own DML, like live_window_sweep)');
select is(
  (select proconfig from pg_proc where oid = 'public.prune_expired_story_segments()'::regprocedure),
  array['search_path=""'], 'prune_expired_story_segments locks search_path to empty');
select ok(not has_function_privilege('anon', 'public.prune_expired_story_segments()', 'execute'),
  'anon cannot run the prune');
select ok(not has_function_privilege('authenticated', 'public.prune_expired_story_segments()', 'execute'),
  'authenticated cannot run the prune');
select ok(not has_function_privilege('public', 'public.prune_expired_story_segments()', 'execute'),
  'public cannot run the prune');
-- The post rides on DML: it must be exception-guarded so a broken pg_net half can never roll
-- back the row prune (20260821082216; the enqueue_media_process shape).
select ok(
  (select prosrc from pg_proc where oid = 'public.prune_expired_story_segments()'::regprocedure)
    like '%exception when others%',
  'the reaper post is exception-guarded — a failed post never rolls back the row prune');

-- ── fixtures (postgres, before any role switch) ──────────────────────────────
-- A authors every segment; V is an ordinary member (not blocked, not banned) who reads the
-- bucket under the real storage SELECT policy in §4.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'reaper_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'reaper_v@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- Descriptor rows. Object keys follow the real layout {uid}/{id}.{ext}
-- (apps/native/src/lib/media/paths.ts); every object below is inserted with an explicit
-- created_at so the age term is under test and never "now()".
insert into public.story_segments (id, author_id, kind, storage_path, pinned, expires_at, deleted_at)
values
  -- A: live, unpinned — the ordinary case
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'video',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-00000000000a.mp4',
   false, now() + interval '12 hours', null),
  -- B: expired two hours ago, unpinned — the bug: hidden since 24h, bytes never freed
  ('bbbbbbbb-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'video',
   '11111111-1111-1111-1111-111111111111/bbbbbbbb-0000-0000-0000-00000000000b.mp4',
   false, now() - interval '2 hours', null),
  -- C: expired two hours ago, PINNED — «un passo del percorso» survives (PRD §4.5)
  ('cccccccc-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'video',
   '11111111-1111-1111-1111-111111111111/cccccccc-0000-0000-0000-00000000000c.mp4',
   true, now() - interval '2 hours', null),
  -- D: live expiry, soft-deleted two hours ago — the author took it down
  ('dddddddd-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'video',
   '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.mp4',
   false, now() + interval '12 hours', now() - interval '2 hours'),
  -- E: soft-deleted ten minutes ago — hidden, but inside the grace
  ('eeeeeeee-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'video',
   '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-00000000000e.mp4',
   false, now() + interval '12 hours', now() - interval '10 minutes'),
  -- F: expired ten minutes ago, unpinned — hidden, but inside the grace
  ('ffffffff-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'photo',
   '11111111-1111-1111-1111-111111111111/ffffffff-0000-0000-0000-00000000000f.jpg',
   false, now() - interval '10 minutes', null),
  -- I: pinned, but soft-deleted two hours ago — pinned survives expiry, not a take-down
  ('19191919-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'video',
   '11111111-1111-1111-1111-111111111111/19191919-0000-0000-0000-000000000019.mp4',
   true, now() - interval '2 hours', now() - interval '2 hours'),
  -- K: the seeded shape after a refresh gap — expired 30 h ago, pruned 6 h ago, bytes uploaded
  -- 40 days ago by the media runbook. staging_refresh_world() revives it below, in place.
  ('5eed5eed-0000-0000-0000-00000000005e', '11111111-1111-1111-1111-111111111111', 'video',
   '11111111-1111-1111-1111-111111111111/5eed5eed-0000-0000-0000-00000000005e.mp4',
   false, now() - interval '30 hours', now() - interval '6 hours');

insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('story-segments', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-00000000000a.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/bbbbbbbb-0000-0000-0000-00000000000b.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/cccccccc-0000-0000-0000-00000000000c.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-00000000000e.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/ffffffff-0000-0000-0000-00000000000f.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  -- G: no descriptor yet and ten minutes old — an upload in flight (or a bytes-first writer)
  ('story-segments', '11111111-1111-1111-1111-111111111111/07070707-0000-0000-0000-000000000007.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '10 minutes'),
  -- H: no descriptor and thirty days old — an orphan, e.g. a row insert that never landed
  ('story-segments', '11111111-1111-1111-1111-111111111111/08080808-0000-0000-0000-000000000008.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/19191919-0000-0000-0000-000000000019.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  ('story-segments', '11111111-1111-1111-1111-111111111111/5eed5eed-0000-0000-0000-00000000005e.mp4',
   '11111111-1111-1111-1111-111111111111', now() - interval '40 days'),
  -- J: another bucket entirely, no descriptor of any kind — not this reaper's business
  ('post-media', '11111111-1111-1111-1111-111111111111/0a0a0a0a-0000-0000-0000-00000000000a.jpg',
   '11111111-1111-1111-1111-111111111111', now() - interval '30 days');

-- ── 4. the predicate, row by row (default grace = 1 hour) ─────────────────────
create temporary view reap as
  select name from public.story_segment_reap_candidates(1000);

select is((select count(*)::int from reap where name like '%/aaaaaaaa-%'), 0,
  'A live + unpinned → not a candidate');
select is((select count(*)::int from reap where name like '%/bbbbbbbb-%'), 1,
  'B expired 2h ago + unpinned → candidate');
select is((select count(*)::int from reap where name like '%/cccccccc-%'), 0,
  'C expired 2h ago but PINNED → never a candidate');
select is((select count(*)::int from reap where name like '%/dddddddd-%'), 1,
  'D soft-deleted 2h ago (expiry still live) → candidate: a take-down loses its bytes');
select is((select count(*)::int from reap where name like '%/eeeeeeee-%'), 0,
  'E soft-deleted 10 min ago → not yet: inside the grace');
select is((select count(*)::int from reap where name like '%/ffffffff-%'), 0,
  'F expired 10 min ago → not yet: inside the grace');
select is((select count(*)::int from reap where name like '%/07070707-%'), 0,
  'G no descriptor, object 10 min old → not a candidate: an upload in flight is never reaped');
select is((select count(*)::int from reap where name like '%/08080808-%'), 1,
  'H no descriptor, object 30 days old → candidate: an orphan');
select is((select count(*)::int from reap where name like '%/19191919-%'), 1,
  'I pinned but soft-deleted 2h ago → candidate: pinned survives expiry, not a take-down');
select is((select count(*)::int from reap where name like '%/0a0a0a0a-%'), 0,
  'J an object in another bucket → not this reaper''s');
select is((select count(*)::int from reap where name like '%/5eed5eed-%'), 1,
  'K seeded shape after a refresh gap (expired 30h, pruned 6h ago) → candidate until revived');
select set_eq(
  $$ select name from reap $$,
  array[
    '11111111-1111-1111-1111-111111111111/bbbbbbbb-0000-0000-0000-00000000000b.mp4',
    '11111111-1111-1111-1111-111111111111/dddddddd-0000-0000-0000-00000000000d.mp4',
    '11111111-1111-1111-1111-111111111111/08080808-0000-0000-0000-000000000008.mp4',
    '11111111-1111-1111-1111-111111111111/19191919-0000-0000-0000-000000000019.mp4',
    '11111111-1111-1111-1111-111111111111/5eed5eed-0000-0000-0000-00000000005e.mp4'
  ]::text[],
  'the candidate set is exactly {B, D, H, I, K} and nothing else');

-- limit and order: oldest object first, clamped to at least one
select is(
  (select name from public.story_segment_reap_candidates(1)),
  '11111111-1111-1111-1111-111111111111/5eed5eed-0000-0000-0000-00000000005e.mp4',
  'p_limit = 1 returns the OLDEST candidate (40 days) — the backlog drains in order');
select is((select count(*)::int from public.story_segment_reap_candidates(0)), 1,
  'p_limit = 0 is clamped to 1 — a zero never means "everything"');

-- The relationship with the storage SELECT policy, checked against the REAL policy rather than
-- a copy of its text: at grace 0 the candidate set and what an ordinary member can read must
-- partition the bucket. The member is V — not the author, not blocked, not banned — so the
-- policy's viewer-side arms (owner-folder regex, not_blocked, not_banned; 20260818114947) all
-- pass and only the descriptor predicate decides. A fourth arm added to the policy tomorrow
-- shows up here as a readable candidate or an unreadable non-candidate.
create temporary table cand0 as
  select name from public.story_segment_reap_candidates(1000, interval '0');
grant select on cand0 to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects o join cand0 c on c.name = o.name),
  0, 'at grace 0 no candidate is readable by a member under the live storage SELECT policy');
-- Scoped to the fixture owner folder: on a populated stack (staging's seeded world) the bucket
-- holds other members' live objects too, and they are readable without being fixtures.
select is(
  (select count(*)::int from storage.objects o
    where o.bucket_id = 'story-segments'
      and o.name like '11111111-1111-1111-1111-111111111111/%'),
  (select 10 - count(*)::int from cand0 where name like '11111111-1111-1111-1111-111111111111/%'),
  'what a member can read of the fixtures is exactly the ten objects minus the candidates — inverses, by the real policy');
reset role;

-- The staging refresh, verbatim in shape (refresh-staging.sql §9): revive K in place. No
-- re-upload happens there, so the object stays 40 days old — and must leave the set anyway.
update public.story_segments
   set expires_at = now() + interval '20 hours', deleted_at = null
 where id = '5eed5eed-0000-0000-0000-00000000005e';
select is((select count(*)::int from reap where name like '%/5eed5eed-%'), 0,
  'K revived in place by the hourly refresh → no longer a candidate, however old its bytes');

-- ── 5. the nightly wrapper: rows first, then the (unconfigured → silent) reaper call ──
-- No GUC, no Vault row on this stack: runtime_setting returns NULL and the guard must TAKE
-- the no-op branch — `if v_url is null or …` tests NULL explicitly, where a bare
-- `if v_url != ''` would be NULL → false → fall through to http_post.
select lives_ok(
  $$ select public.prune_expired_story_segments() $$,
  'prune runs with no Vault pair: rows pruned, reaper call a quiet no-op, no error loop');
select isnt((select deleted_at from public.story_segments where id = 'bbbbbbbb-0000-0000-0000-00000000000b'),
  null, 'B (expired, unpinned) is soft-deleted by the prune — 20260614230935''s behaviour, unchanged');
select isnt((select deleted_at from public.story_segments where id = 'ffffffff-0000-0000-0000-00000000000f'),
  null, 'F (expired 10 min ago, unpinned) is soft-deleted by the prune too');
select is((select deleted_at from public.story_segments where id = 'cccccccc-0000-0000-0000-00000000000c'),
  null, 'C (pinned) is left alone by the prune');
select is((select deleted_at from public.story_segments where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  null, 'A (live) is left alone by the prune');
select is((select count(*)::int from reap where name like '%/ffffffff-%'), 0,
  'F just pruned → still inside the grace: tonight''s prune feeds TOMORROW''s reap, never the same pass');
-- Half-configured is still unconfigured: url present, key absent → same quiet no-op.
select set_config('app.settings.story_segment_reaper_url', 'http://localhost:1/x', true);
select lives_ok(
  $$ select public.invoke_story_segment_reaper() $$,
  'url set but key absent → still a no-op, never an unauthenticated post');

-- ── 6. the schedule: same job, extended ───────────────────────────────────────
select is((select count(*)::int from cron.job where jobname = 'prune-expired-story-segments'), 1,
  'exactly one prune-expired-story-segments job — extended, not duplicated');
select is(
  (select schedule from cron.job where jobname = 'prune-expired-story-segments'),
  '17 3 * * *', 'the job keeps its 03:17 nightly slot');
select ok(
  (select command from cron.job where jobname = 'prune-expired-story-segments')
    like '%prune_expired_story_segments()%',
  'cron calls the wrapper — rows then bytes, never a literal key in cron.job.command');
select ok(
  (select command from cron.job where jobname = 'prune-expired-story-segments')
    not like '%update %',
  'the inline UPDATE from 20260614230935 no longer lives in cron.job.command');

select * from finish();
rollback;
