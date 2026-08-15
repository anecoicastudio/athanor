import { z } from 'zod';

/**
 * Read-model of one recorded fund payout transfer (#247, ruling #244): a cache of Stripe
 * `transfer.created` / `transfer.reversed` webhooks — the release path requests, the
 * webhook records (rule 6). The basis columns snapshot the cycle's frozen declared
 * retention (#232): payable is DERIVED from pool and split, never chosen, and the
 * cross-field checks below mirror the table's CHECK constraints — a row that fails them
 * is an upstream bug to surface, not a state to absorb.
 */
export const payoutLedgerSchema = z
  .object({
    id: z.string().uuid(),
    edition_id: z.string().uuid(),
    destination_account_id: z.string().min(1), // acct_… — Stripe truth, survives erasure
    amount_cents: z.number().int().positive(),
    reversed_cents: z.number().int().nonnegative(),
    currency: z.string(),
    pool_cents: z.number().int().nonnegative(), // confirmed_pool_cents at release
    split_pct: z.number().int().min(0).max(100),
    payable_cents: z.number().int().nonnegative(),
    // 'reversed' means fully reversed, exactly; a partial reversal stays 'released'.
    status: z.enum(['released', 'reversed']),
    stripe_transfer_id: z.string().min(1), // tr_… — row-level idempotency
    created_at: z.string(),
    updated_at: z.string(),
  })
  .superRefine((row, ctx) => {
    if (row.reversed_cents > row.amount_cents) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reversal exceeds amount' });
    }
    // The #232 rider, mirrored: floor(pool × (100 − split) / 100), same truncation as
    // the bigint division in the table's CHECK.
    if (row.payable_cents !== Math.floor((row.pool_cents * (100 - row.split_pct)) / 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'payable not derived from basis' });
    }
    if ((row.status === 'reversed') !== (row.reversed_cents === row.amount_cents)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'status contradicts reversal' });
    }
  });
export type PayoutLedgerRow = z.infer<typeof payoutLedgerSchema>;
