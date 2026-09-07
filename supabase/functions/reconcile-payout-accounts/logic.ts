import { z } from 'npm:zod@3';
import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { handleAccountUpdated } from '../_shared/payout-account-cache.ts';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';

type Db = SupabaseClient;

// Optional body. `{}` (or no body at all) reconciles every row; naming one account narrows it,
// which is what an operator wants after a single organiser reports a stuck CTA. `.strict()` so a
// typo'd key is a 400 rather than a silent full sweep.
const payload = z.object({ stripeAccountId: z.string().min(1).optional() }).strict();

export type ReconcileCtx = {
  /** Service-role client — payout_accounts grants clients no write path (#245). */
  admin: Db;
  /** stripe.accounts.retrieve. The only outbound call this function makes. */
  retrieveAccount: (id: string) => Promise<Stripe.Account>;
};

/** One row's outcome. `unchanged` and `corrected` both mean Stripe was reached and we agree now. */
export type AccountOutcome = {
  stripeAccountId: string;
  status: 'corrected' | 'unchanged' | 'failed';
  /** Present when Stripe disagreed with the cache, so the log says WHAT moved, not just that it did. */
  from?: { chargesEnabled: boolean; payoutsEnabled: boolean };
  to?: { chargesEnabled: boolean; payoutsEnabled: boolean };
};

/** A cached row, narrowed to the columns a reconcile compares. */
type CachedRow = {
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
};

/**
 * Reconcile the payout_accounts cache against Stripe (#707).
 *
 * WHY THIS EXISTS. The capability columns are written by exactly one thing — the W13
 * `account.updated` arm — and a delivery that never happens leaves no trace anywhere. On
 * 2026-09-06 an organiser's completion event fired 49 minutes before the «Connected accounts»
 * endpoint existed, so it was delivered nowhere; the row sat at `false` for a day and
 * `stripe_webhook_events` was silent, because silence is what "never delivered" looks like.
 * A repaired row does not close that: the reverse case is worse and entirely uncovered — if
 * Stripe REVOKES a capability while the endpoint is down or mis-scoped, the cache stays `true`
 * and `release-fund-payout` will attempt a transfer against an account that can no longer take
 * one.
 *
 * SHAPE. This follows W11 (`stripe-webhook/handlers.ts`), the repo's one precedent for
 * retrieve-then-write: retrieve the object from Stripe and write the cache **by calling the same
 * handler the webhook arm uses**. `handleAccountUpdated` therefore stays the single writer of
 * these three columns, which is what keeps rule 6 true — Stripe remains the source of truth and
 * our row remains a cache of what Stripe says, whether Stripe pushed it or we asked.
 *
 * ONE ROW AT A TIME, AND FAILURES DO NOT ABORT. A Stripe error on one account says nothing about
 * the next, and a sweep that stops at the first failure would leave the rest unreconciled while
 * reporting a number that looks like progress. Each outcome is reported; the caller decides.
 *
 * NOT SCHEDULED. There is no cron job behind this. It is invoked by an operator (or by a script)
 * when a row is suspected stale or after a webhook outage — see docs/RELEASE-RUNBOOK.md §4.2.
 * Making it periodic is the thing that would also catch a revocation unasked, and that is a
 * separate decision with a migration behind it.
 */
export async function reconcilePayoutAccounts(ctx: ReconcileCtx, req: Request): Promise<Response> {
  const { admin, retrieveAccount } = ctx;

  // An empty body is the whole-sweep case, so a parse failure on empty text is not an error.
  const raw = await req.text();
  const parsed = payload.safeParse(raw.trim() === '' ? {} : safeJson(raw));
  if (!parsed.success) return error('invalid body', 400);
  const { stripeAccountId } = parsed.data;

  let query = admin
    .from('payout_accounts')
    .select('stripe_account_id,charges_enabled,payouts_enabled');
  if (stripeAccountId) query = query.eq('stripe_account_id', stripeAccountId);

  const { data, error: selErr } = await query;
  if (selErr) return error('could not read payout accounts', 500);

  const rows = (data ?? []) as CachedRow[];
  const outcomes: AccountOutcome[] = [];

  for (const row of rows) {
    let account: Stripe.Account;
    try {
      account = await retrieveAccount(row.stripe_account_id);
    } catch (e) {
      // #416: the real reason goes to the function log, never to the response.
      logStripeFailure(`reconcile-payout-accounts: accounts.retrieve ${row.stripe_account_id}`, e);
      outcomes.push({ stripeAccountId: row.stripe_account_id, status: 'failed' });
      continue;
    }

    const from = { chargesEnabled: row.charges_enabled, payoutsEnabled: row.payouts_enabled };
    const to = {
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
    };
    const drifted =
      from.chargesEnabled !== to.chargesEnabled || from.payoutsEnabled !== to.payoutsEnabled;

    // Written even when the flags agree: `onboarded_at` is stamped set-once by the same handler
    // and can be NULL on a row whose flags happen to match, which is exactly the 2026-09-06 shape
    // once a later event corrected the flags but not the stamp. Skipping the write on flag
    // equality would leave that row half-repaired and invisible.
    try {
      await handleAccountUpdated(admin, account);
    } catch {
      outcomes.push({ stripeAccountId: row.stripe_account_id, status: 'failed', from, to });
      continue;
    }

    outcomes.push(
      drifted
        ? { stripeAccountId: row.stripe_account_id, status: 'corrected', from, to }
        : { stripeAccountId: row.stripe_account_id, status: 'unchanged' },
    );
  }

  return json({
    checked: outcomes.length,
    corrected: outcomes.filter((o) => o.status === 'corrected').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    outcomes,
  });
}

/** JSON.parse that yields a value zod will reject rather than throwing out of the parse step. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
