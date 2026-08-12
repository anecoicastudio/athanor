-- `athanor.runtime_setting(text)` returns edge-function URLs and — critically — the project's
-- secret key as plain text, so its ACL is the whole story: an execute grant to anon or
-- authenticated would hand `sb_secret_…` to any client over RPC. The seven pg_net callers were
-- replaced with `create or replace`, so this also re-asserts what a replace can silently break.
--
-- The Vault half is not asserted here: `vault.decrypted_secrets` holds no secrets on a fresh
-- CI stack, which is exactly the "unconfigured" state the callers' no-op guards expect. What
-- IS asserted is that the GUC wins when set (the fixture every other pgTAP file relies on) and
-- that a missing name resolves to NULL rather than raising.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ── the resolver itself ──────────────────────────────────────────────────────
select has_function('athanor', 'runtime_setting', array['text'], 'runtime_setting exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'athanor' and p.proname = 'runtime_setting'),
  true, 'runtime_setting is security definer');
select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'athanor' and p.proname = 'runtime_setting'),
  array['search_path=""'], 'runtime_setting locks search_path to empty');

-- ── the ACL: nothing client-reachable may execute it ─────────────────────────
select ok(not has_function_privilege('anon', 'athanor.runtime_setting(text)', 'execute'),
  'anon cannot execute runtime_setting');
select ok(not has_function_privilege('authenticated', 'athanor.runtime_setting(text)', 'execute'),
  'authenticated cannot execute runtime_setting');
select ok(not has_function_privilege('public', 'athanor.runtime_setting(text)', 'execute'),
  'public cannot execute runtime_setting');

-- ── resolution order: GUC wins, absent name is NULL not an error ─────────────
-- A probe name rather than a real one, so the result does not depend on which Vault secrets
-- the target project happens to hold (CI has none; a hosted project has eight).
select is(athanor.runtime_setting('pgtap_probe'), null,
  'a name with neither GUC nor Vault entry resolves to NULL — the callers'' no-op state');
select set_config('app.settings.pgtap_probe', 'http://engine.invalid/score-engine', true);
select is(athanor.runtime_setting('pgtap_probe'), 'http://engine.invalid/score-engine',
  'a set GUC wins — local stack and pgTAP fixtures keep working');
select set_config('app.settings.pgtap_probe', '', true);
select is(athanor.runtime_setting('pgtap_probe'), null,
  'an empty GUC counts as unset, not as an empty URL');

-- ── the seven callers survived create-or-replace intact ──────────────────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (('athanor','enqueue_notification'), ('athanor','enqueue_score_award'),
                                     ('public','enqueue_push'), ('public','enqueue_media_process'),
                                     ('public','invoke_score_engine_decay'))
      and p.prosecdef),
  7, 'all seven pg_net callers are still security definer');

select ok(not has_function_privilege('authenticated', 'public.invoke_score_engine_decay()', 'execute'),
  'authenticated cannot invoke the decay entrypoint');
select ok(not has_function_privilege('anon', 'public.invoke_score_engine_decay()', 'execute'),
  'anon cannot invoke the decay entrypoint');
select ok(not has_function_privilege('authenticated',
  'athanor.enqueue_score_award(uuid, text, uuid, text)', 'execute'),
  'authenticated cannot enqueue a score award');
select ok(not has_function_privilege('authenticated',
  'athanor.enqueue_score_award(uuid, text, uuid, text, uuid)', 'execute'),
  'authenticated cannot enqueue a score award (counterparty overload)');
select ok(not has_function_privilege('authenticated',
  'athanor.enqueue_score_award(uuid, text, uuid, text, uuid, integer)', 'execute'),
  'authenticated cannot enqueue a score award (reviewer overload)');
select ok(not has_function_privilege('authenticated',
  'athanor.enqueue_notification(uuid, text, text, jsonb, jsonb)', 'execute'),
  'authenticated cannot enqueue a notification');

-- ── the callers read through the resolver, not current_setting ───────────────
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_score_engine_decay') like '%runtime_setting%',
  'decay reads config through runtime_setting');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_score_engine_decay')
    not like '%current_setting(''app.settings%',
  'decay no longer reads the GUC directly');
-- runtime_setting itself is the one legitimate reader — it is the fallback chain.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('athanor','public')
      and p.prosrc like '%current_setting(''app.settings.%'
      and p.proname <> 'runtime_setting'),
  '', 'no pg_net caller reads an app.settings GUC directly any more');

-- ── the header builder is still the only way a key reaches the wire ──────────
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_media_process') like '%edge_auth_headers%',
  'media-process enqueue still builds headers via edge_auth_headers');

select * from finish();
rollback;
