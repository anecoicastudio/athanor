-- FUND-51 / #236 — the optional fee coverage, and the split a refund needs.
--
-- A contributor may choose to add Stripe's processing cost on top of the gift so the fund
-- receives the gift whole. The choice is STRICTLY OPTIONAL and never a surcharge (PSD2
-- Art. 62(4) / D.Lgs. 218/2017 ban mandatory surcharges on capped-interchange instruments),
-- and its checkbox defaults unticked (CRD 2011/83/EU Art. 22 excludes pre-ticked boxes;
-- whether Art. 22 reaches a donation's optional coverage is counsel's question, #250).
--
-- WHICH COLUMN MEANS WHAT — the decision this migration exists to make.
--
-- `amount_cents` keeps meaning THE GIFT: the money the fund actually receives and the only
-- figure the pool is ever computed from. It is not re-pointed at Stripe's charge, and that
-- is deliberate: five live functions already read it as the pool — recompute_fund_aggregate
-- (the public ticker), enter_announcement (the FUND-42 snapshot into confirmed_pool_cents),
-- declare_winner (the FUND-42 floor), close_cycle and rollover_voided (the FUND-45 carry) —
-- and every one of them wants the gift. Redefining the column to the charge would have
-- silently taught all five to count processing costs as generosity: a public ticker inflated
-- by money the fund never held, a funding floor clearable with Stripe's fees, and a
-- confirmed_pool_cents that promises the winner more than exists. Adding the coverage
-- ALONGSIDE leaves all five correct by construction and changes no function here.
--
-- Historical rows are unaffected in meaning: before this migration no coverage could be
-- taken, so `amount_cents` was already exactly the gift on every row ever written.
--
-- `coverage_cents` is the top-up; `charged_cents` is generated, never written, and exists
-- so the row still reconciles to Stripe: charged_cents = the Checkout session's amount_total.
-- Rule 6 is intact — Stripe stays the source of truth and this row remains its cache; the
-- webhook refuses any session whose amount_total does not equal gift + coverage.
--
-- A REFUND RETURNS THE CONTRIBUTION, NEVER THE COVERAGE (FUND-51). Stripe does not return
-- processing on a refund, so returning the coverage would cost the fund money it never held.
-- The amount an operator refunds is therefore `amount_cents` — the gift — and because the
-- pool never counted the coverage in the first place, un-counting a reversed contribution
-- is already exact: reverseContribution's status flip removes precisely the gift, whether
-- the operator refunded the gift alone or the whole charge. The gift-only property lives in
-- what the operator refunds; the ticker's correctness under either choice lives here.
--
-- The €1 floor is unchanged and stays on the GIFT (`amount_cents >= 100`, 20260618153032):
-- coverage may not push a sub-€1 contribution over the line. On the floor the fee is ~27%
-- of the gift — the floor stays and the deduction is disclosed (#235's screen), rather than
-- the minimum being raised to hide it.
--
-- Zero Aura, as ever (rule #1): nothing here mints score. Covering processing costs is the
-- most temptingly rewardable act in the product and is worth exactly nothing —
-- packages/core/src/score/weights.test.ts names `fund_fee_coverage` as non-creditable.

-- ── 1. the coverage ─────────────────────────────────────────────────────────────────────
alter table public.fund_contributions
  add column coverage_cents bigint not null default 0;

-- Non-negative only. No upper bound on purpose: the pool is protected by the pre-existing
-- `amount_cents >= 100` CHECK (a malformed split can only shrink the gift, and below €1 the
-- insert is refused), and a bound derived from today's Stripe rate would become a false
-- refusal the day the rate moves.
alter table public.fund_contributions
  add constraint fund_contributions_coverage_cents_check check (coverage_cents >= 0);

-- ── 2. the charge, derived ──────────────────────────────────────────────────────────────
-- Generated, so no query can ever disagree with the sum and no writer can drift it out of
-- step with its parts. This is the figure to reconcile against Stripe.
alter table public.fund_contributions
  add column charged_cents bigint
    generated always as (amount_cents + coverage_cents) stored;

comment on column public.fund_contributions.amount_cents is
  '#236: THE GIFT — the money the fund receives, and the only figure any pool computation reads (recompute_fund_aggregate, enter_announcement, declare_winner, close_cycle, rollover_voided). Also the amount an operator refunds: a refund returns the contribution, never the coverage (FUND-51). The €1 floor is on this column, never on the charge.';

comment on column public.fund_contributions.coverage_cents is
  '#236: the OPTIONAL fee coverage the contributor chose to add so the gift arrives whole — Stripe''s cut, grossed up recursively (charged = ceil((gift + fixed) / (1 - pct))). 0 = declined, the default and the unticked box (CRD 2011/83/EU Art. 22). Never counted as pool, never returned on a refund, never Aura.';

comment on column public.fund_contributions.charged_cents is
  '#236: what the card was actually charged = the Checkout session''s amount_total. Generated, never written: the webhook refuses a session whose amount_total does not equal amount_cents + coverage_cents, so this column is the reconciliation handle against Stripe (rule #6).';
