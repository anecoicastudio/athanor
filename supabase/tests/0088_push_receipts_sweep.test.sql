-- push_receipts (#128) holds Expo ticket ids awaiting a receipt. It is service-role-only
-- plumbing, so the whole point of this file is that a client cannot reach it at all — and that
-- the reach is cut at the GRANT layer, not merely filtered by RLS. An RLS-only denial would
-- return 0 rows and look like "nothing pending" to anyone probing; 42501 says no.
--
-- Also asserts the hourly cron entrypoint: security definer, locked search_path, execute
-- revoked from every client role (it resolves the project's secret key through
-- athanor.runtime_setting), and a no-op rather than an error when push is unconfigured — which
-- is the state every fresh CI stack and every pre-deploy project is in.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'user_a@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

-- ── table shape ──────────────────────────────────────────────────────────────
select has_table('public', 'push_receipts', 'push_receipts table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.push_receipts'::regclass),
  'RLS enabled on push_receipts'
);
select policies_are(
  'public', 'push_receipts',
  array[]::text[],
  'no client policies on push_receipts — service role only'
);
select has_index('public', 'push_receipts', 'push_receipts_created_at_idx',
  'push_receipts has the created_at index the sweep orders by');
select has_trigger('public', 'push_receipts', 'push_receipts_touch_updated_at',
  'push_receipts touches updated_at');

-- ── the client cannot reach it, at the privilege layer ───────────────────────
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select count(*) from public.push_receipts $$,
  '42501', 'permission denied for table push_receipts', 'anon cannot read push_receipts'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select count(*) from public.push_receipts $$,
  '42501', 'permission denied for table push_receipts',
  'a member cannot read push_receipts either — not even their own'
);
select throws_ok(
  $$ insert into public.push_receipts (receipt_id, token, profile_id)
     values ('r-1', 'ExponentPushToken[x]', '11111111-1111-1111-1111-111111111111') $$,
  '42501', 'permission denied for table push_receipts', 'a member cannot forge a receipt row'
);
select throws_ok(
  $$ delete from public.push_receipts $$,
  '42501', 'permission denied for table push_receipts',
  'a member cannot delete receipt rows (which would hide a dead token from the sweep)'
);
reset role;

-- ── service role writes it (the edge function's path) ────────────────────────
select lives_ok(
  $$ insert into public.push_receipts (receipt_id, token, profile_id)
     values ('r-1', 'ExponentPushToken[aaa]', '11111111-1111-1111-1111-111111111111') $$,
  'service role stores a pending ticket'
);
select throws_ok(
  $$ insert into public.push_receipts (receipt_id, token, profile_id)
     values ('r-1', 'ExponentPushToken[bbb]', '11111111-1111-1111-1111-111111111111') $$,
  '23505', null, 'receipt_id is unique — a resent ticket does not duplicate the row'
);

-- the token is denormalized on purpose: deleting the token must NOT delete the pending receipt,
-- or a device that unregisters between send and sweep loses the very evidence of its death.
insert into public.push_tokens (profile_id, token, platform)
  values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[aaa]', 'ios');
delete from public.push_tokens where token = 'ExponentPushToken[aaa]';
select is(
  (select count(*) from public.push_receipts where receipt_id = 'r-1'),
  1::bigint,
  'deleting the push token leaves the pending receipt row standing'
);

-- profile cascade still applies (the row is about a person's device)
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select count(*) from public.push_receipts),
  0::bigint,
  'receipts cascade away with the profile'
);

-- ── the cron entrypoint ──────────────────────────────────────────────────────
select has_function('public', 'invoke_push_receipt_sweep', array[]::text[],
  'invoke_push_receipt_sweep exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_push_receipt_sweep'),
  true, 'invoke_push_receipt_sweep is security definer');
select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_push_receipt_sweep'),
  array['search_path=""'], 'invoke_push_receipt_sweep locks search_path to empty');
select ok(not has_function_privilege('anon', 'public.invoke_push_receipt_sweep()', 'execute'),
  'anon cannot invoke the sweep');
select ok(not has_function_privilege('authenticated', 'public.invoke_push_receipt_sweep()', 'execute'),
  'authenticated cannot invoke the sweep');
select ok(not has_function_privilege('public', 'public.invoke_push_receipt_sweep()', 'execute'),
  'public cannot invoke the sweep');

-- reads config through the resolver, so a Vault rotation is picked up (rule 8)
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_push_receipt_sweep') like '%runtime_setting%',
  'the sweep resolves url/key through athanor.runtime_setting');

-- unconfigured (no GUC, no Vault secret) → returns quietly instead of raising, so the hourly
-- job never fills the log on a project where push has not been wired up yet.
select lives_ok(
  $$ select public.invoke_push_receipt_sweep() $$,
  'the sweep is a no-op when push_dispatch_url/_key are unset'
);

-- ── the schedule ─────────────────────────────────────────────────────────────
select is(
  (select schedule from cron.job where jobname = 'push-receipt-sweep'),
  '23 * * * *',
  'the sweep runs hourly — Expo keeps a receipt about a day, so ~24 attempts before it expires'
);

select * from finish();
rollback;
