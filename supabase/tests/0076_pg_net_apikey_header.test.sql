-- DB→edge credential moves to the `apikey` header (new Supabase secret keys are not JWTs).
-- The five enqueue functions were replaced with `create or replace`, so this asserts the
-- things a replace can silently break — trigger bindings, security definer, locked
-- search_path, revoked execute — plus the header shape itself.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- ── the shared header builder ────────────────────────────────────────────────
select has_function('athanor', 'edge_auth_headers', array['text'], 'edge_auth_headers exists');

-- A new-style secret key goes ONLY on apikey: the platform parses an Authorization bearer
-- as a JWT, and sb_secret_ is not one, so sending both would be rejected upstream.
select is(
  athanor.edge_auth_headers('sb_secret_abc') -> 'apikey',
  '"sb_secret_abc"'::jsonb,
  'secret key rides apikey'
);
select ok(
  not (athanor.edge_auth_headers('sb_secret_abc') ? 'Authorization'),
  'secret key never rides Authorization'
);

-- A legacy service_role JWT still sends both, so this migration and the GUC cutover are
-- independently revertible in either order.
select is(
  athanor.edge_auth_headers('eyJhbGciOiJIUzI1NiJ9.legacy') -> 'Authorization',
  '"Bearer eyJhbGciOiJIUzI1NiJ9.legacy"'::jsonb,
  'legacy key still rides Authorization'
);
select is(
  athanor.edge_auth_headers('eyJhbGciOiJIUzI1NiJ9.legacy') -> 'apikey',
  '"eyJhbGciOiJIUzI1NiJ9.legacy"'::jsonb,
  'legacy key also rides apikey (gate reads apikey first)'
);
select is(
  athanor.edge_auth_headers('sb_secret_x') ->> 'Content-Type',
  'application/json',
  'content type preserved'
);

-- Underscores in the LIKE pattern are escaped: a key merely CONTAINING the text must not
-- be mistaken for one starting with the prefix.
select ok(
  athanor.edge_auth_headers('sbXsecretXabc') ? 'Authorization',
  'the sb_secret_ prefix match is not a wildcard match'
);

select function_privs_are(
  'athanor', 'edge_auth_headers', array['text'], 'authenticated', array[]::text[],
  'edge_auth_headers not executable by authenticated'
);
select function_privs_are(
  'athanor', 'edge_auth_headers', array['text'], 'anon', array[]::text[],
  'edge_auth_headers not executable by anon'
);

-- ── the five replaced functions keep their hardening ─────────────────────────
select has_function('public',  'enqueue_push', array['uuid','text','text','jsonb','text'], 'enqueue_push exists');
select has_function('public',  'invoke_score_engine_decay', 'invoke_score_engine_decay exists');
select has_function('athanor', 'enqueue_score_award', array['uuid','text','uuid','text'], 'enqueue_score_award exists');
select has_function('athanor', 'enqueue_notification', array['uuid','text','text','jsonb','jsonb'], 'enqueue_notification exists');
select has_function('public',  'enqueue_media_process', 'enqueue_media_process exists');

-- Asserted as "none of them lacks the property" rather than "exactly N have it": these names
-- are overloadable (enqueue_score_award gained a 5-arg counterparty form in 20260808180801),
-- and a count would fail on a legitimate new overload while still passing if an existing one
-- silently lost security definer and another was added.
select is_empty(
  $$ select n.nspname || '.' || p.proname || '/' || p.pronargs from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname, p.proname) in (
              ('public','enqueue_push'), ('public','invoke_score_engine_decay'),
              ('athanor','enqueue_score_award'), ('athanor','enqueue_notification'),
              ('public','enqueue_media_process'))
        and not p.prosecdef $$,
  'every enqueue function is still security definer'
);

select is_empty(
  $$ select n.nspname || '.' || p.proname || '/' || p.pronargs from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname, p.proname) in (
              ('public','enqueue_push'), ('public','invoke_score_engine_decay'),
              ('athanor','enqueue_score_award'), ('athanor','enqueue_notification'),
              ('public','enqueue_media_process'))
        and 'search_path=""' <> all(coalesce(p.proconfig, array[]::text[])) $$,
  'every enqueue function still has a locked (empty) search_path'
);

select function_privs_are(
  'public', 'enqueue_push', array['uuid','text','text','jsonb','text'], 'authenticated',
  array[]::text[], 'enqueue_push not executable by authenticated'
);
select function_privs_are(
  'athanor', 'enqueue_notification', array['uuid','text','text','jsonb','jsonb'], 'authenticated',
  array[]::text[], 'enqueue_notification not executable by authenticated'
);

-- ── create-or-replace must not have detached the triggers ────────────────────
select has_trigger('public', 'momento_proposals', 'momento_proposals_push', 'momento push trigger intact');
select has_trigger('public', 'messages', 'messages_push', 'message push trigger intact');
select has_trigger('storage', 'objects', 'media_process_enqueue', 'media process trigger intact');

-- ── the guard still holds: unconfigured GUCs are a silent no-op ──────────────
-- These run with app.settings.* unset, which is the state of a fresh `db reset`.
select lives_ok(
  $$ select public.enqueue_push('00000000-0000-0000-0000-000000000001'::uuid, 'moment', 'notif.tpl.moment', '{}'::jsonb, 'ref') $$,
  'enqueue_push no-ops when unconfigured'
);
select lives_ok(
  $$ select public.invoke_score_engine_decay() $$,
  'invoke_score_engine_decay no-ops when unconfigured'
);
select lives_ok(
  $$ select athanor.enqueue_score_award('00000000-0000-0000-0000-000000000001'::uuid, 'report_upheld', '00000000-0000-0000-0000-000000000002'::uuid, 'low') $$,
  'enqueue_score_award no-ops when unconfigured'
);
select lives_ok(
  $$ select athanor.enqueue_notification('00000000-0000-0000-0000-000000000001'::uuid, 'moment', 'notif.tpl.moment', '{}'::jsonb, '{}'::jsonb) $$,
  'enqueue_notification no-ops when unconfigured'
);

-- No caller may build headers for itself.
select throws_ok(
  $$ set local role authenticated; select athanor.edge_auth_headers('sb_secret_x') $$,
  '42501',
  null,
  'authenticated cannot call edge_auth_headers'
);

select * from finish();
rollback;
