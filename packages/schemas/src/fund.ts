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
  // Declared economics — nullable shape; #232 owns the frozen-at-open semantics.
  split_pct: z.number().int().min(0).max(100).nullable(),
  cost_fee_statement: z.string().nullable(),
  equity_declared: z.string().nullable(),
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
  amountCents: z.number().int().min(100), // ≥ €1 (PRD §4.11)
});
export type ContributionSessionInput = z.infer<typeof contributionSessionInputSchema>;

/** Read-model of a Stripe contribution row (backend 06 §2.2). Owner reads own; written only by the webhook. */
export const fundContributionSchema = z.object({
  id: z.string().uuid(),
  edition_id: z.string().uuid(),
  profile_id: z.string().uuid().nullable(),
  amount_cents: z.number().int().nonnegative(),
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
