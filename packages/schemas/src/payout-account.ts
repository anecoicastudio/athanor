import { z } from 'zod';

/**
 * Read-model of the Connect Express account cache (#245, ruling #244; design doc "Data
 * model" · payout_accounts): one row per profile, written ONLY by the stripe-webhook
 * `account.updated` branch — Stripe is the source of truth (rule 6). The capability flags
 * gate #247's transfers and are NOT NULL default false in the DB, so a null here is a bug
 * upstream, not a state to absorb: the schema throws rather than guessing.
 */
export const payoutAccountSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  stripe_account_id: z.string().min(1), // acct_… — never blank
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  onboarded_at: z.string().nullable(), // ISO timestamptz — null until onboarding completes
  created_at: z.string(),
  updated_at: z.string(),
});
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;
