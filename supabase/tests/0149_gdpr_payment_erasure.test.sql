-- #107 — the erasure job reaches the retained payment tables and the account can be deleted
-- (20260908071656 + 20260908071807). Implements the controller's 2026-09-07 ruling (#184).
--
-- Four claims, and each one is a thing that was broken or impossible before:
--
--   1. PSEUDONYMISE, NEVER DELETE. `gdpr_erase_payment_footprint` nulls the identity on
--      event_tickets and circle_memberships and keeps every money column and Stripe id. The
--      `qr_token` goes with the identity — it is a bearer credential for a turnstile, not a
--      financial fact.
--   2. IT WORKS FOR THE SECOND ERASED MEMBER. The obvious implementation — reassign to the
--      tombstone sentinel, the way the fund reach does — raises 23505 on the second member,
--      because `event_tickets` is unique (user_id, event_id) and `circle_memberships` is unique
--      (profile_id). §4 erases TWO members holding tickets to the SAME event, which is exactly
--      the case a sentinel cannot express.
--   3. THE ACCOUNT CAN ACTUALLY BE DELETED. Four FKs to `profiles` are NO ACTION or RESTRICT, so
--      `auth.admin.deleteUser` raised 23503 for anyone who had ever scanned a ticket or resolved
--      a report. §6 deletes the auth.users row for real and asserts it survives.
--   4. AND THE MONEY SURVIVES THAT DELETE. Both identity columns are ON DELETE CASCADE, so the
--      account delete does not merely fail on un-pseudonymised rows — it destroys ten years of
--      financial records. §6 asserts the rows are still there afterwards, with their amounts.
--
-- The nightly schedule is §7. The edge function's own loop is deno-tested (erasure-job/
-- logic.test.ts); what SQL owns, and what this file asserts, is the two RPCs and the cron job.

begin;

create extension if not exists pgtap with schema extensions;

select plan(72);

-- ── 1. schema: both tables can hold a pseudonymised row ──────────────────────────────────

select col_is_null('public', 'event_tickets', 'user_id',
  'event_tickets.user_id is nullable — NULL is how an erased row leaves unique (user_id, event_id)');
select has_column('public', 'event_tickets', 'erased_at',
  'event_tickets carries erased_at — the signal the sentinel used to carry');
select col_is_null('public', 'circle_memberships', 'profile_id',
  'circle_memberships.profile_id is nullable for the same reason');
select has_column('public', 'circle_memberships', 'erased_at',
  'circle_memberships carries erased_at');

-- The uniques are UNCHANGED, and that is the point of the NULL shape: a partial unique index is
-- not inferable by `ON CONFLICT` without its predicate, and three writers infer these — the
-- ticket webhook arm, the Circle subscription arm and claim_event_seat. Asserted as
-- definitions rather than as behaviour, because a behaviour test would pass while the index
-- quietly became partial underneath it.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.event_tickets'::regclass and conname = 'event_tickets_user_id_event_id_key'),
  'UNIQUE (user_id, event_id)',
  'event_tickets keeps a PLAIN unique (user_id, event_id) — ON CONFLICT still infers it');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.circle_memberships'::regclass and conname = 'circle_memberships_profile_id_key'),
  'UNIQUE (profile_id)',
  'circle_memberships keeps a PLAIN unique (profile_id)');
select col_not_null('public', 'circle_memberships', 'stripe_customer_id',
  'stripe_customer_id stays NOT NULL — the ruling keeps Stripe ids, and it collides with nothing');

-- ── 2. the two functions: shape, posture, privileges ─────────────────────────────────────

select has_function('public', 'gdpr_erase_payment_footprint', array['uuid'],
  'gdpr_erase_payment_footprint exists');
select has_function('public', 'gdpr_release_profile_references', array['uuid'],
  'gdpr_release_profile_references exists');

-- INVOKER, following gdpr_erase_fund_footprint (20260815131925:71) and the 20260821082216
-- correction: the only caller is the erasure-job's service-role client, which already holds
-- every table these touch. A postgres-owned DEFINER that can null out money identities is a
-- latent escalation surface, not a convenience.
select ok(
  (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gdpr_erase_payment_footprint'),
  'gdpr_erase_payment_footprint is SECURITY INVOKER');
select ok(
  (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gdpr_release_profile_references'),
  'gdpr_release_profile_references is SECURITY INVOKER');
select is(
  (select proconfig from pg_proc where oid = 'public.gdpr_erase_payment_footprint(uuid)'::regprocedure),
  array['search_path=""'], 'gdpr_erase_payment_footprint locks search_path to empty');
select is(
  (select proconfig from pg_proc where oid = 'public.gdpr_release_profile_references(uuid)'::regprocedure),
  array['search_path=""'], 'gdpr_release_profile_references locks search_path to empty');

-- PostgreSQL grants EXECUTE to PUBLIC on every new function and the pg_default_acl 'f' row adds
-- anon and authenticated (#409), so these four are what the migration's revoke buys.
select ok(not has_function_privilege('anon', 'public.gdpr_erase_payment_footprint(uuid)', 'execute'),
  'anon cannot pseudonymise anybody''s payment rows');
select ok(not has_function_privilege('authenticated', 'public.gdpr_erase_payment_footprint(uuid)', 'execute'),
  'authenticated cannot either');
select ok(not has_function_privilege('anon', 'public.gdpr_release_profile_references(uuid)', 'execute'),
  'anon cannot release another member''s references');
select ok(not has_function_privilege('authenticated', 'public.gdpr_release_profile_references(uuid)', 'execute'),
  'authenticated cannot either');
select ok(has_function_privilege('service_role', 'public.gdpr_erase_payment_footprint(uuid)', 'execute'),
  'service_role — the job''s client — can pseudonymise');
select ok(has_function_privilege('service_role', 'public.gdpr_release_profile_references(uuid)', 'execute'),
  'service_role can release references');

-- ── 3. fixture: two members, one shared event — the case a sentinel cannot express ───────
-- A (…aa) and B (…bb) both hold a ticket to event …e1 and both hold a Circle membership.
-- A also scanned B's ticket (event_attendance.scanned_by), resolved a report (audit_log.actor_id)
-- and invited C (…cc) — the three references that made deleting A impossible.

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-0000-0000-0000000000aa',
   'authenticated', 'authenticated', 'a@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-0000-0000-0000000000bb',
   'authenticated', 'authenticated', 'b@test.athanor', '{"locale":"it"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-0000-0000-0000000000cc',
   'authenticated', 'authenticated', 'c@test.athanor', '{"locale":"it"}'::jsonb, now(), now());

update public.profiles set referral_code = 'AAAA1111'
 where id = '49000000-0000-0000-0000-0000000000aa';

insert into public.events (id, organizer_id, title, category, is_online, venue, geo, starts_at, price_cents)
values ('49000000-0000-0000-0000-0000000000e1', '49000000-0000-0000-0000-0000000000cc',
        'Cerchio di prova', 'networking', false, 'Cascina Cuccagna',
        extensions.st_point(9.2, 45.45)::extensions.geography, now() + interval '10 days', 0);

insert into public.event_tickets (id, user_id, event_id, stripe_payment_id, qr_token, status)
values
  ('49000000-0000-0000-0000-000000000011', '49000000-0000-0000-0000-0000000000aa',
   '49000000-0000-0000-0000-0000000000e1', 'pi_0149_a', 'qr_0149_a', 'paid'),
  ('49000000-0000-0000-0000-000000000012', '49000000-0000-0000-0000-0000000000bb',
   '49000000-0000-0000-0000-0000000000e1', 'pi_0149_b', 'qr_0149_b', 'paid');

insert into public.events (id, organizer_id, title, category, is_online, venue, geo, starts_at, price_cents)
values ('49000000-0000-0000-0000-0000000000e2', '49000000-0000-0000-0000-0000000000cc',
        'Cerchio di prova due', 'networking', false, 'Cascina Cuccagna',
        extensions.st_point(9.2, 45.45)::extensions.geography, now() + interval '20 days', 0);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '49000000-0000-0000-0000-0000000000dd',
        'authenticated', 'authenticated', 'd@test.athanor', '{"locale":"it"}'::jsonb, now(), now());
insert into public.event_tickets (id, user_id, event_id, stripe_payment_id, qr_token, status)
values ('49000000-0000-0000-0000-000000000013', '49000000-0000-0000-0000-0000000000dd',
        '49000000-0000-0000-0000-0000000000e1', 'pi_0149_d', 'qr_0149_d', 'paid');

insert into public.event_tickets (id, user_id, event_id, stripe_payment_id, qr_token, status)
values ('49000000-0000-0000-0000-000000000014', '49000000-0000-0000-0000-0000000000aa',
        '49000000-0000-0000-0000-0000000000e2', 'pi_0149_a2', 'qr_0149_a2', 'paid');

insert into public.circle_memberships (profile_id, stripe_customer_id, stripe_subscription_id, plan, status)
values
  ('49000000-0000-0000-0000-0000000000aa', 'cus_0149_a', 'sub_0149_a', 'monthly', 'active'),
  ('49000000-0000-0000-0000-0000000000bb', 'cus_0149_b', 'sub_0149_b', 'annual', 'active');

-- A scanned B's ticket: the record belongs to B's attendance, not to A's personal data.
insert into public.event_attendance (ticket_id, event_id, scanned_by)
values ('49000000-0000-0000-0000-000000000012', '49000000-0000-0000-0000-0000000000e1',
        '49000000-0000-0000-0000-0000000000aa');

insert into public.reports (id, reporter_id, target_type, target_id, category, note, status)
values ('49000000-0000-0000-0000-0000000000f1', '49000000-0000-0000-0000-0000000000bb',
        'person', '49000000-0000-0000-0000-0000000000cc', 'spam', 'fixture', 'dismissed');
insert into public.audit_log (report_id, actor_id, action, reason)
values ('49000000-0000-0000-0000-0000000000f1', '49000000-0000-0000-0000-0000000000aa',
        'dismiss', 'fixture');

insert into public.invites (inviter_id, code, invitee_id, activated_at)
values ('49000000-0000-0000-0000-0000000000aa', 'AAAA1111',
        '49000000-0000-0000-0000-0000000000cc', now());

-- A's own erasure request — the row the job claims, and the row that has to still be there
-- when the job writes 'done' onto it (§6).
insert into public.gdpr_erasure_requests (id, profile_id, status)
values ('49000000-0000-0000-0000-0000000000d1', '49000000-0000-0000-0000-0000000000aa',
        'processing');

-- ── 4. the guard, then the erasure of A ──────────────────────────────────────────────────

select throws_ok(
  $$ select public.gdpr_erase_payment_footprint(public.gdpr_tombstone_profile_id()) $$,
  'P0001', 'refusing to erase the tombstone sentinel itself',
  'the payment reach refuses the sentinel, like the fund reach does');
select throws_ok(
  $$ select public.gdpr_release_profile_references(public.gdpr_tombstone_profile_id()) $$,
  'P0001', 'refusing to erase the tombstone sentinel itself',
  'the reference release refuses the sentinel too');

select lives_ok(
  $$ select public.gdpr_erase_payment_footprint('49000000-0000-0000-0000-0000000000aa') $$,
  'A''s payment footprint is pseudonymised');

select is(
  (select user_id from public.event_tickets where id = '49000000-0000-0000-0000-000000000011'),
  null, 'A''s ticket has lost its buyer');
select is(
  (select qr_token from public.event_tickets where id = '49000000-0000-0000-0000-000000000011'),
  null, 'and its QR token — an erased member''s ticket must not still open a door');
select is(
  (select stripe_payment_id from public.event_tickets where id = '49000000-0000-0000-0000-000000000011'),
  'pi_0149_a', 'the Stripe payment id is KEPT — pseudonymise, never delete');
select is(
  (select event_id from public.event_tickets where id = '49000000-0000-0000-0000-000000000011'),
  '49000000-0000-0000-0000-0000000000e1'::uuid, 'and the event the money was for');
select ok(
  (select erased_at is not null from public.event_tickets
    where id = '49000000-0000-0000-0000-000000000011'),
  'erased_at is stamped — what the 10-year reaper will key on');
select is(
  (select profile_id from public.circle_memberships where stripe_customer_id = 'cus_0149_a'),
  null, 'A''s membership has lost its member');
select is(
  (select stripe_subscription_id from public.circle_memberships where stripe_customer_id = 'cus_0149_a'),
  'sub_0149_a', 'the subscription id is kept');
select ok(
  (select erased_at is not null from public.circle_memberships where stripe_customer_id = 'cus_0149_a'),
  'and erased_at is stamped there too');

select is(
  (select user_id from public.event_tickets where id = '49000000-0000-0000-0000-000000000012'),
  '49000000-0000-0000-0000-0000000000bb'::uuid, 'B is untouched — one member''s erasure is one member''s');
select ok(
  (select erased_at is null from public.event_tickets where id = '49000000-0000-0000-0000-000000000012'),
  'B''s ticket carries no erased_at');

-- ── 5. THE SECOND MEMBER — the assertion the sentinel shape could not pass ───────────────
-- B holds a ticket to the SAME event and a Circle membership of their own. Under the
-- reassign-to-sentinel design this raises 23505 twice over: (sentinel, e1) already exists in
-- event_tickets, and circle_memberships.profile_id is unique so the sentinel can hold one row.

select lives_ok(
  $$ select public.gdpr_erase_payment_footprint('49000000-0000-0000-0000-0000000000bb') $$,
  'the SECOND erased member does not collide — a sentinel would have raised 23505 here');
select is(
  (select count(*)::int from public.event_tickets
    where event_id = '49000000-0000-0000-0000-0000000000e1' and user_id is null),
  2, 'both erased tickets to the same event coexist');
select is(
  (select count(*)::int from public.circle_memberships where profile_id is null),
  2, 'both erased memberships coexist');

-- Idempotent: the job re-drives a request by hand and nothing must move, least of all the
-- retention clock.
select lives_ok(
  $$ select public.gdpr_erase_payment_footprint('49000000-0000-0000-0000-0000000000aa') $$,
  'a re-run over an already-erased member is a no-op, not an error');

-- ── 6. the references, then the account delete for real ──────────────────────────────────

select throws_ok(
  $$ delete from auth.users where id = '49000000-0000-0000-0000-0000000000aa' $$,
  '23503', null,
  'BEFORE the release, deleting A raises 23503 — this is the bug #107 was filed for');

select lives_ok(
  $$ select public.gdpr_release_profile_references('49000000-0000-0000-0000-0000000000aa') $$,
  'A''s blocking references are released');

select is(
  (select scanned_by from public.event_attendance
    where ticket_id = '49000000-0000-0000-0000-000000000012'),
  public.gdpr_tombstone_profile_id(),
  'B''s check-in survives, scanned by the tombstone rather than by nobody');
select is(
  (select actor_id from public.audit_log where report_id = '49000000-0000-0000-0000-0000000000f1'),
  public.gdpr_tombstone_profile_id(),
  'the moderation trail survives with a pseudonymised actor — NULL there means «a system action»');
select is(
  (select count(*)::int from public.invites where code = 'AAAA1111'),
  0, 'A''s own referral activations are deleted');
select lives_ok(
  $$ select public.gdpr_release_profile_references('49000000-0000-0000-0000-0000000000aa') $$,
  'the release is idempotent too');

select lives_ok(
  $$ delete from auth.users where id = '49000000-0000-0000-0000-0000000000aa' $$,
  'AND NOW the account deletes — the whole point of #107');
select is(
  (select count(*)::int from public.profiles where id = '49000000-0000-0000-0000-0000000000aa'),
  0, 'the profile cascaded away with it');

-- The request row must NOT cascade away with it (20260908073545). Its FK was ON DELETE CASCADE,
-- so the job's own last statement — set status='done' where id = … — would have matched zero
-- rows and said nothing: a fulfilled erasure indistinguishable from one that never ran, which is
-- #107's original complaint in a new form.
select is(
  (select count(*)::int from public.gdpr_erasure_requests
    where id = '49000000-0000-0000-0000-0000000000d1'),
  1, 'the erasure REQUEST survives the erasure it recorded');
select is(
  (select count(*)::int from public.gdpr_erasure_requests
    where id = '49000000-0000-0000-0000-0000000000d1' and profile_id is null),
  1, 'and it survives WITHOUT the identity — SET NULL, not a dangling id');
select lives_ok(
  $$ update public.gdpr_erasure_requests set status = 'done'
      where id = '49000000-0000-0000-0000-0000000000d1' $$,
  'so the job can still mark it done — the row it has to write is still there');
select is(
  (select status from public.gdpr_erasure_requests
    where id = '49000000-0000-0000-0000-0000000000d1'),
  'done', 'the accountability trace: an erasure request that reached done (Art. 5(2))');

-- The money assertion. `event_tickets.user_id` and `circle_memberships.profile_id` are ON DELETE
-- CASCADE, so a delete performed BEFORE the pseudonymisation would have taken these two rows
-- with it — silently, with no error to notice. They are here because the identity was nulled
-- first, which is why the job's deletionSafe flag exists.
select is(
  (select stripe_payment_id from public.event_tickets where id = '49000000-0000-0000-0000-000000000011'),
  'pi_0149_a', 'the erased member''s ticket survives the account delete, with its money');
select is(
  (select stripe_customer_id from public.circle_memberships where stripe_subscription_id = 'sub_0149_a'),
  'cus_0149_a', 'and so does the membership');

-- ── 6b. the OTHER cascade: a third party's erasure must not delete retained tickets ──────
-- events.organizer_id → profiles is ON DELETE CASCADE and event_tickets.event_id → events is
-- too, so erasing the ORGANISER used to delete every ticket every other member bought for their
-- events — retained, pseudonymised ones included. 20260908074427 detaches exactly those before
-- the cascade reads them, and leaves live tickets to cascade exactly as they did.

select ok(not has_function_privilege('anon', 'public.detach_retained_tickets_from_event()', 'execute'),
  'anon cannot execute the detach trigger function (#409 — trigger functions grant EXECUTE to nobody)');
select ok(not has_function_privilege('authenticated', 'public.detach_retained_tickets_from_event()', 'execute'),
  'authenticated cannot either');

select is(
  (select count(*)::int from public.event_tickets
    where event_id = '49000000-0000-0000-0000-0000000000e1'),
  3, 'before: two retained tickets and one live one hang off the organiser''s event');

select lives_ok(
  $$ delete from auth.users where id = '49000000-0000-0000-0000-0000000000cc' $$,
  'the organiser erases their own account');
select is(
  (select count(*)::int from public.events where id = '49000000-0000-0000-0000-0000000000e1'),
  0, 'their event cascaded away, as it always has');

select is(
  (select stripe_payment_id from public.event_tickets where id = '49000000-0000-0000-0000-000000000011'),
  'pi_0149_a', 'A''s RETAINED ticket survived somebody else''s erasure');
select is(
  (select count(*)::int from public.event_tickets
    where id = '49000000-0000-0000-0000-000000000011' and event_id is null),
  1, 'detached rather than deleted — the money row keeps everything but the dead event link');
select is(
  (select stripe_payment_id from public.event_tickets where id = '49000000-0000-0000-0000-000000000012'),
  'pi_0149_b', 'and so did B''s');
select is(
  (select count(*)::int from public.event_tickets where id = '49000000-0000-0000-0000-000000000013'),
  0, 'D''s LIVE ticket cascaded away untouched by the trigger — behaviour is unchanged for live rows');

-- And it has to fire for the role that actually deletes: the erasure job's service-role client.
-- `revoke execute … from public, anon, authenticated` has taken service_role's EXECUTE with it
-- before in this repo, and a trigger that silently stops firing is a retention hole, not a 42501
-- somebody notices. Asserted with a REAL delete under the role, not by reading a privilege.
select ok(
  not has_function_privilege('authenticated', 'public.detach_retained_tickets_from_event()', 'execute'),
  'sanity: the revoke is in force for a client role');
set local role service_role;
select lives_ok(
  $$ delete from public.events where id = '49000000-0000-0000-0000-0000000000e2' $$,
  'service_role — the job''s own client — can delete an event, revoke and all');
reset role;
select is(
  (select count(*)::int from public.event_tickets
    where id = '49000000-0000-0000-0000-000000000014' and event_id is null),
  1, 'and the trigger still fired for it: A''s second retained ticket is detached, not deleted');

-- ── 7. the nightly schedule ──────────────────────────────────────────────────────────────

select has_function('public', 'invoke_erasure_job', 'the pg_net wrapper exists');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'invoke_erasure_job'),
  'invoke_erasure_job is SECURITY DEFINER — cron runs it, and it reads Vault');
select is(
  (select proconfig from pg_proc where oid = 'public.invoke_erasure_job()'::regprocedure),
  array['search_path=""'], 'invoke_erasure_job locks search_path to empty');
select ok(not has_function_privilege('anon', 'public.invoke_erasure_job()', 'execute'),
  'anon cannot post to the erasure job');
select ok(not has_function_privilege('authenticated', 'public.invoke_erasure_job()', 'execute'),
  'authenticated cannot either');

select is((select count(*)::int from cron.job where jobname = 'erasure-nightly'), 1,
  'the erasure job is scheduled — it was deployed and unscheduled from M9 until #107');
select is((select schedule from cron.job where jobname = 'erasure-nightly'), '47 3 * * *',
  'nightly at 03:47 UTC, clear of the 03:11/03:17/03:25 cluster and after gdpr-export');
select ok(
  (select command from cron.job where jobname = 'erasure-nightly')
    like '%invoke_erasure_job()%',
  'cron calls the wrapper — never a literal key in cron.job.command');
select ok(
  (select command from cron.job where jobname = 'erasure-nightly')
    not like '%sb_secret%',
  'no secret is baked into the cron command: a rotation must not need an unschedule');
select ok(
  (select command from cron.job where jobname = 'erasure-nightly')
    not like '%Authorization%',
  'and no Authorization bearer — an sb_secret_… key is not a JWT');

select * from finish();
rollback;
