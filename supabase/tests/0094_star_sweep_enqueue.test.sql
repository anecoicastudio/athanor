-- 0094_star_sweep_enqueue.test.sql
-- Issue #121 — Ambasciatore for invite-only profiles. Invite activation is worth ZERO
-- Aura (rule #1, no aura_events type), so it never reaches the score-engine's award
-- mode — where star evaluation lived. 20260813120003 adds athanor.enqueue_star_sweep
-- + two triggers on public.invites that enqueue a stars-only engine run
-- ({ mode: 'stars' }) for the INVITER when a row becomes activated.
-- Asserts: catalog shape (functions SECURITY DEFINER, client-uncallable; both triggers
-- exist) · engine unconfigured → activation still lands (fail-open, signup never blocked)
-- · queue witness: an activated signup enqueues exactly one stars body targeting the
-- inviter · a not-yet-activated INSERT enqueues nothing · the null→now() UPDATE flip
-- enqueues · re-touching an already-activated row does not · rule #1 stays true with the
-- new trigger in place (activation writes no aura_events row).
-- CI-only (hosted lacks pgtap); pg_net's worker never sees uncommitted queue rows, so
-- net.http_request_queue is a safe in-txn witness of the exact enqueued payload (0064 K).

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── seed inviter A (auth trigger fires → profile auto-created) ────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000094',
   'authenticated', 'authenticated', 'star_sweep_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000094","role":"authenticated"}';
select set_config('test.code', public.ensure_referral_code(), false);
reset role;

-- ── (A) catalog shape ─────────────────────────────────────────────────────────────────────
select has_function('athanor'::name, 'enqueue_star_sweep'::name, array['uuid'],
  'athanor.enqueue_star_sweep(uuid) exists');

select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'enqueue_star_sweep' and p.pronamespace = 'athanor'::regnamespace),
  true, 'enqueue_star_sweep is SECURITY DEFINER (resolves the engine key via Vault)');

select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'star_sweep_invite_activated' and p.pronamespace = 'athanor'::regnamespace),
  true, 'star_sweep_invite_activated is SECURITY DEFINER');

select has_trigger('public'::name, 'invites'::name, 'invites_star_sweep_ins'::name);
select has_trigger('public'::name, 'invites'::name, 'invites_star_sweep_upd'::name);

-- ── (B) a client can never call the enqueue directly ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-0000-0000-000000000094","role":"authenticated"}';
select throws_ok(
  $$ select athanor.enqueue_star_sweep('aaaa0000-0000-0000-0000-000000000094'::uuid) $$,
  '42501', null, 'client cannot call enqueue_star_sweep (execute revoked)');
reset role;

-- ── (C) engine unconfigured → guarded no-op: activation still lands, signup never blocked ─
select lives_ok(
  $$ insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
     values ('00000000-0000-0000-0000-000000000000', 'bbbb0000-0000-0000-0000-000000000094',
             'authenticated', 'authenticated', 'star_sweep_b@test.athanor',
             jsonb_build_object('locale', 'it', 'referral_code', current_setting('test.code')),
             now(), now(), now()) $$,
  'activated signup runs clean with the engine unconfigured (fail-open no-op enqueue)');

select is(
  (select (count(*) = 1) from public.invites
    where inviter_id = 'aaaa0000-0000-0000-0000-000000000094'
      and invitee_id = 'bbbb0000-0000-0000-0000-000000000094'
      and activated_at is not null),
  true, 'the invite activation itself landed despite the no-op enqueue');

-- ── (D) queue witness: with the engine configured, activation enqueues a stars run ────────
-- txn-local GUCs (runtime_setting reads the GUC before Vault; rolled back with this txn).
select set_config('app.settings.score_engine_url', 'http://engine.invalid/functions/v1/score-engine', true);
select set_config('app.settings.score_engine_key', 'sb_secret_pgtap_dummy_key', true);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
values ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-000000000094',
        'authenticated', 'authenticated', 'star_sweep_c@test.athanor',
        jsonb_build_object('locale', 'it', 'referral_code', current_setting('test.code')),
        now(), now(), now());

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'mode' = 'stars'),
  1, 'the activated signup enqueued exactly one stars-mode run');

select is(
  (select convert_from(q.body, 'utf8')::jsonb ->> 'profileId'
     from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'mode' = 'stars'
    order by q.id desc limit 1),
  'aaaa0000-0000-0000-0000-000000000094',
  'the stars run targets the INVITER, never the invitee');

-- ── (E) trigger WHEN clauses: only the null→activated transition enqueues ─────────────────
-- Writes as service_role (invites is server-write-only); queue reads back at top level.
-- A pending row (activated_at null; null invitee dodges the unique index) fires nothing…
set local role service_role;
insert into public.invites (inviter_id, code, invitee_id, activated_at)
  values ('aaaa0000-0000-0000-0000-000000000094', current_setting('test.code'), null, null);
reset role;
select set_config('test.pending',
  (select id::text from public.invites
    where inviter_id = 'aaaa0000-0000-0000-0000-000000000094' and activated_at is null), false);

select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'mode' = 'stars'),
  1, 'a not-yet-activated INSERT enqueues nothing (WHEN new.activated_at is not null)');

-- …the null→now() flip enqueues…
set local role service_role;
update public.invites set activated_at = now() where id = current_setting('test.pending')::uuid;
reset role;
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'mode' = 'stars'),
  2, 'the pending→activated UPDATE flip enqueues a stars run');

-- …and re-touching an already-activated row does not.
set local role service_role;
update public.invites set activated_at = now() where id = current_setting('test.pending')::uuid;
reset role;
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'mode' = 'stars'),
  2, 're-touching an already-activated row enqueues nothing (WHEN old.activated_at is null)');

-- ── (F) rule #1 holds with the new trigger in place ───────────────────────────────────────
set local role service_role;
select is(
  (select count(*)::int from public.aura_events
    where profile_id in ('aaaa0000-0000-0000-0000-000000000094',
                         'bbbb0000-0000-0000-0000-000000000094',
                         'cccc0000-0000-0000-0000-000000000094')),
  0, 'invite activation still confers zero Aura — the sweep reads stars, never writes the ledger (rule #1)');
reset role;

select finish();
rollback;
