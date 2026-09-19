-- Athanor — STAGING demo world, step 1 of 2: the fund edition, in English.
--
-- Run BEFORE seed-staging.sql, on an emptied staging project (see demo-world.sql's header for
-- the whole order). fund_editions' declaration columns are frozen by
-- fund_editions_freeze_declarations once the row exists, so an English cost_fee_statement can
-- only be written by creating the row. seed-staging.sql §12 then meets this row and its
-- `on conflict do nothing` keeps it. Same id, same numbers — only the two prose columns differ.
--
-- Same two gates as seed-staging.sql. Never production.

begin;

do $$
begin
  if coalesce(athanor.runtime_setting('environment'), '') <> 'staging' then
    raise exception 'REFUSING: the environment marker is %, expected ''staging''.',
      coalesce(athanor.runtime_setting('environment'), '<unset>');
  end if;
  if coalesce(current_setting('app.settings.seed_confirm', true), '') <> 'yes' then
    raise exception 'REFUSING: run "set app.settings.seed_confirm = ''yes'';" in this session first.';
  end if;
end $$;

insert into public.fund_editions (id, target_at, goal_cents, phase, candidacy_window_open, contributions_enabled,
                                  voting_starts_at, voting_ends_at,
                                  min_funding_cents, min_voters, min_candidacies,
                                  split_pct, cost_fee_statement, equity_declared)
values (md5('fundedition:2027')::uuid,
        (date_trunc('year', now()) + interval '1 year' + interval '5 months')::timestamptz,
        5000000, 'voting', true, true,
        now() - interval '7 days', now() + interval '23 days',
        100000, 5, 3,
        10,
        'For this cycle Athanor keeps 10%. It covers only part of the operating costs and payment fees; Athanor deliberately absorbs the difference. Real costs are published in the end-of-cycle report.',
        'No equity stake in the project for this cycle.')
on conflict do nothing;

commit;
