import { z } from 'zod';

/** The cycle model (#215, FUND-SPEC §1): candidacy → screening → voting → announcement → realization → closed. */
export const fundPhaseSchema = z.enum([
  'candidacy',
  'screening',
  'voting',
  'announcement',
  'realization',
  'closed',
]);
export type FundPhase = z.infer<typeof fundPhaseSchema>;

/**
 * fund_editions.closure_reason (#216/#221, D33) — why a cycle closed: realized, one of the
 * three void causes (below the FUND-42 floor, below the FUND-43 quorum, winner declined),
 * or realization_failed (D33's post-tranche branch — declared failed with evidence).
 * Present exactly when phase = 'closed' (DB shape CHECK); close_cycle() writes it.
 */
export const fundClosureReasonSchema = z.enum([
  'realized',
  'voided_underfunded',
  'voided_quorum',
  'voided_declined',
  'realization_failed',
]);
export type FundClosureReason = z.infer<typeof fundClosureReasonSchema>;

/** Public read-model of one event-driven fund cycle (the identifier stays fund_editions, D39). */
export const fundEditionSchema = z.object({
  id: z.string().uuid(),
  target_at: z.string(), // ISO timestamptz — the server-authoritative countdown clock
  goal_cents: z.number().int().positive(),
  phase: fundPhaseSchema,
  candidacy_window_open: z.boolean(),
  contributions_enabled: z.boolean(),
  winner_candidacy_id: z.string().uuid().nullable(),
  // Ballot window (FUND-15) — published at open, enforced by cast_vote from #217 on.
  voting_starts_at: z.string().nullable(),
  voting_ends_at: z.string().nullable(),
  // The three deferred per-cycle minimums (FUND-SPEC §5) — NOT NULL in the DB, no default.
  min_funding_cents: z.number().int().nonnegative(),
  min_voters: z.number().int().positive(),
  min_candidacies: z.number().int().positive(),
  // Declared economics (#232, D15/D16) — NOT NULL in the DB, non-blank, frozen at open.
  split_pct: z.number().int().min(0).max(100),
  cost_fee_statement: z.string().min(1),
  equity_declared: z.string().min(1),
  // Failure states (#216) — closure reason exactly when closed; the FUND-42 announcement
  // snapshot, null until #220 writes it; the FUND-45 carry-forward, 0 = nothing carried.
  closure_reason: fundClosureReasonSchema.nullable(),
  confirmed_pool_cents: z.number().int().nonnegative().nullable(),
  carried_in_cents: z.number().int().nonnegative(),
  // #221: rollover provenance — the predecessor this cycle's carried_in_cents moved from;
  // NULL on a cycle opened from nothing. Unique where present (one successor per predecessor).
  carried_from_edition_id: z.string().uuid().nullable(),
  // #220: when the winner confirmed deliverability at confirmed_pool_cents — NULL until
  // record_winner_decision('confirm'); stays NULL on a decline (closure_reason says so).
  winner_confirmed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FundEdition = z.infer<typeof fundEditionSchema>;

/** Public read-model of the live-ticker aggregate cache (backend 06 §2.3). */
export const fundAggregateSchema = z.object({
  edition_id: z.string().uuid(),
  raised_cents: z.number().int().nonnegative(),
  contributor_count: z.number().int().nonnegative(),
  updated_at: z.string(),
});
export type FundAggregate = z.infer<typeof fundAggregateSchema>;

/** Client → `create-contribution-session` edge-fn input (backend 08 §3.2). Min €1, no max. */
export const contributionSessionInputSchema = z.object({
  editionId: z.string().uuid(),
  amountCents: z.number().int().min(100), // ≥ €1 (PRD §4.11) — the GIFT, never the charge
  // #236: the optional fee coverage. Optional in every sense — omitted means declined, which
  // is what the unticked checkbox sends (CRD 2011/83/EU Art. 22 excludes pre-ticked boxes).
  // A flag, never an amount: the server does its own gross-up, so a client cannot name the
  // figure it will be charged (the same reason amountCents is re-floored server-side).
  coverFees: z.boolean().optional(),
});
export type ContributionSessionInput = z.infer<typeof contributionSessionInputSchema>;

/** Read-model of a Stripe contribution row (backend 06 §2.2). Owner reads own; written only by the webhook. */
export const fundContributionSchema = z.object({
  id: z.string().uuid(),
  edition_id: z.string().uuid(),
  profile_id: z.string().uuid(), // NOT NULL since #239 — contributions are never anonymous (D24)
  // #236: the split. amount_cents is THE GIFT — the money the fund receives, the figure every
  // pool computation reads, and the amount an operator refunds (a refund returns the
  // contribution, never the coverage). coverage_cents is the optional top-up that paid Stripe.
  amount_cents: z.number().int().nonnegative(),
  coverage_cents: z.number().int().nonnegative(),
  // Generated column (amount_cents + coverage_cents) = the Checkout session's amount_total,
  // i.e. the reconciliation handle against Stripe. Non-nullable here although the generated
  // types say `number | null`: the generator types every generated column as nullable, but an
  // addition over two NOT NULL columns cannot produce one.
  charged_cents: z.number().int().nonnegative(),
  currency: z.string(),
  stripe_checkout_session_id: z.string(),
  stripe_payment_intent_id: z.string().nullable(),
  // pending = the column default, never written by the webhook (every enabled payment method
  // reports its outcome on checkout.session.completed) · succeeded = settled, the only status
  // the aggregate counts · refunded = reversed after settling (refund or dispute).
  status: z.enum(['pending', 'succeeded', 'refunded']),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FundContribution = z.infer<typeof fundContributionSchema>;
