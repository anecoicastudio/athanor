-- gdpr export-ready producer (#129, 20260813162227) — asserts: the trigger exists · its fn
-- is SECURITY DEFINER (must run as owner to reach the guarded enqueue) · the CHECKs admit
-- the new 'gdprExport' type on both tables · the requested→processing→ready path runs clean
-- through the REAL writer (service-role UPDATE) while the fan-out URL/key are unresolved
-- (guarded no-op) · zero notifications rows land (fan-out edge fn stays the sole writer).
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- fixture: one member with a requested export job (profile via handle_new_user)
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'gdpr_notif_member@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

select set_config('test.member', 'aaaaaaaa-1111-4111-8111-111111111111', false);

-- (A) trigger + definer
select has_trigger('public'::name, 'gdpr_export_jobs'::name, 'gdpr_export_jobs_notify_ready'::name);
select is(
  (select p.prosecdef from pg_proc p
     where p.proname = 'notify_gdpr_export_ready' and p.pronamespace = 'athanor'::regnamespace),
  true, 'notify_gdpr_export_ready is SECURITY DEFINER');

-- (B) both CHECKs admit 'gdprExport' (service-role-shaped direct writes; rolled back anyway)
select lives_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       values (current_setting('test.member')::uuid, 'gdprExport', 'notif.tpl.gdprExport') $$,
  'notifications_type_check admits gdprExport');
select lives_ok(
  $$ insert into public.notification_preferences (profile_id, type, channel)
       values (current_setting('test.member')::uuid, 'gdprExport', 'push') $$,
  'notification_preferences_type_check admits gdprExport');
select throws_ok(
  $$ insert into public.notifications (recipient_id, type, template_key)
       values (current_setting('test.member')::uuid, 'somethingElse', 'notif.tpl.generic') $$,
  '23514', null, 'the type set stays closed');

-- clean the direct inserts so (D) counts only what the trigger path produced
delete from public.notifications where recipient_id = current_setting('test.member')::uuid;
delete from public.notification_preferences where profile_id = current_setting('test.member')::uuid;

-- (C) the real path: member requests (RLS insert), backend flips status (service-role UPDATE)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.gdpr_export_jobs (profile_id)
  values (current_setting('test.member')::uuid);
reset role;

select set_config('test.job',
  (select id::text from public.gdpr_export_jobs
    where profile_id = current_setting('test.member')::uuid), false);

select lives_ok(
  $$ update public.gdpr_export_jobs set status = 'processing'
      where id = current_setting('test.job')::uuid $$,
  'requested->processing runs clean (no enqueue on this edge)');
select lives_ok(
  $$ update public.gdpr_export_jobs
        set status = 'ready', download_url = 'https://signed.example/x',
            expires_at = now() + interval '72 hours'
      where id = current_setting('test.job')::uuid $$,
  'processing->ready runs clean (guarded no-op enqueue)');

-- (C2) #721: the OTHER terminal outcome reaches the member too. Before this the producer fired
-- only on 'ready', so a member whose archive never arrived was told nothing and had to reopen the
-- screen to find out. Same type and entity_ref, different template key.
select lives_ok(
  $$ update public.gdpr_export_jobs set status = 'failed'
      where id = current_setting('test.job')::uuid $$,
  'ready->failed runs clean (guarded no-op enqueue)');
-- Asserted on the FUNCTION rather than on a row, because the fan-out is unresolved here and
-- enqueue_notification writes nothing (D): what must be true is that the 'failed' arm exists and
-- names the right template.
select matches(
  pg_get_functiondef('athanor.notify_gdpr_export_ready()'::regprocedure),
  'notif\.tpl\.gdprExportFailed',
  'the producer carries a failed arm with its own template key');
select matches(
  pg_get_functiondef('athanor.notify_gdpr_export_ready()'::regprocedure),
  'old\.status is distinct from ''failed''',
  'and guards it on the TRANSITION, so the lease''s repeated writes cannot re-notify');
-- Both assertions above read the function body, and a body assertion passes for the wrong reason
-- the moment the TRIGGER stops reaching it: a `when (new.status = 'ready')` added to the trigger
-- would make the failed arm dead code with the mirror still green. Asserted as the absence of a
-- qual rather than by matching the triggerdef text, which would have the same weakness.
select is(
  (select tgqual from pg_trigger
    where tgrelid = 'public.gdpr_export_jobs'::regclass
      and tgname = 'gdpr_export_jobs_notify_ready'),
  null, 'and the trigger carries no WHEN, so both arms are actually reachable');

-- (D) fan-out unresolved => enqueue returned before net.http_post; nothing wrote notifications
select is(
  (select count(*)::int from public.notifications
     where recipient_id = current_setting('test.member')::uuid),
  0, 'the producer ran with fan-out unresolved and wrote zero notifications (guarded no-op)');

select finish();
rollback;
