-- 'failed' is a terminal state for a delayed debit that never cleared (SEPA). It must be
-- accepted by the CHECK, and it must never reach the public ticker — only 'succeeded' counts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.fund_editions (id, year, target_at, goal_cents, phase, contributions_enabled)
values ('eee00000-0000-0000-0000-000000000001', 2031, now() + interval '30 days', 100000, 'community', true);

-- the new status is accepted
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000001', null, 5000, 'eur', 'cs_failed_1', 'failed') $$,
  'status failed is accepted'
);

-- the old ones still are
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000001', null, 5000, 'eur', 'cs_pending_1', 'pending') $$,
  'status pending still accepted'
);
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000001', null, 700, 'eur', 'cs_ok_1', 'succeeded') $$,
  'status succeeded still accepted'
);

-- and junk is still rejected
select throws_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000001', null, 5000, 'eur', 'cs_junk_1', 'whatever') $$,
  '23514',
  null,
  'an unknown status is still rejected by the CHECK'
);

-- the ticker counts ONLY succeeded: 700 from one contributor, ignoring failed and pending
select public.recompute_fund_aggregate('eee00000-0000-0000-0000-000000000001');
select is(
  (select raised_cents from public.fund_aggregates
    where edition_id = 'eee00000-0000-0000-0000-000000000001'),
  700::bigint,
  'failed and pending money never reaches the ticker'
);
-- and the failed row is still there to be shown as a receipt — retired, not deleted
select is(
  (select status from public.fund_contributions where stripe_checkout_session_id = 'cs_failed_1'),
  'failed',
  'the failed contribution is retained for the receipts screen'
);

select * from finish();
rollback;
