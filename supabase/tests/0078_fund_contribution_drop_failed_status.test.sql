-- 'failed' left the fund_contributions vocabulary along with SEPA (20260808093013). The three
-- pre-SEPA statuses still insert, 'failed' is now rejected, and the column DEFAULT is still one
-- of the accepted values — which is exactly why 'pending' was kept and not removed too.
-- Replaces 0077, which asserted the opposite. See supabase/MIGRATIONS-ERRATA.md.
--
-- On the asymmetry the migration does not spell out: it remaps surviving 'failed' rows but not
-- surviving 'pending' ones, even though a stranded 'pending' is the worse orphan — its promote
-- path is gone (handleContributionSettled deleted, async_payment_succeeded now throws), so it
-- would render «In arrivo» forever and its UNIQUE stripe_checkout_session_id would make any
-- later upsert a no-op. It needs no remap only because it cannot exist: 0352e4c, the commit
-- that first made the webhook write 'pending', never left the fix/payments-and-api-keys branch,
-- so no deployed code has ever produced one. If that stops being true, remap 'pending' too.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.fund_editions (id, target_at, goal_cents, phase, contributions_enabled,
                                  min_funding_cents, min_voters, min_candidacies)
values ('eee00000-0000-0000-0000-000000000078', now() + interval '30 days', 100000, 'voting', true,
        100000, 5, 3);

-- the three surviving statuses still insert
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000078', null, 5000, 'eur', 'cs_pending_78', 'pending') $$,
  'status pending is still accepted'
);
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000078', null, 700, 'eur', 'cs_ok_78', 'succeeded') $$,
  'status succeeded is still accepted'
);
select lives_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000078', null, 5000, 'eur', 'cs_ref_78', 'refunded') $$,
  'status refunded is still accepted'
);

-- the delayed-settlement state is gone
select throws_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000078', null, 5000, 'eur', 'cs_failed_78', 'failed') $$,
  '23514',
  null,
  'status failed is rejected — no code path can produce it since assertSettled'
);

-- and junk is still rejected
select throws_ok(
  $$ insert into public.fund_contributions
       (edition_id, profile_id, amount_cents, currency, stripe_checkout_session_id, status)
     values ('eee00000-0000-0000-0000-000000000078', null, 5000, 'eur', 'cs_junk_78', 'whatever') $$,
  '23514',
  null,
  'an unknown status is still rejected by the CHECK'
);

-- the DEFAULT must remain a legal value: this is why 'pending' survived the revert
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'fund_contributions' and column_name = 'status'),
  $$'pending'::text$$,
  'the column default is still one of the accepted statuses'
);

-- the ticker counts ONLY succeeded: 700, ignoring the pending and refunded rows
select public.recompute_fund_aggregate('eee00000-0000-0000-0000-000000000078');
select is(
  (select raised_cents from public.fund_aggregates
    where edition_id = 'eee00000-0000-0000-0000-000000000078'),
  700::bigint,
  'only succeeded money reaches the ticker'
);

select * from finish();
rollback;
