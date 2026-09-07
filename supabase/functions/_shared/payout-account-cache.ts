import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// The single writer of payout_accounts' capability columns, extracted from
// stripe-webhook/handlers.ts so a second caller can reach it (#707).
//
// It lives here rather than in the webhook because no edge function imports from another
// function's directory — every cross-function specifier in supabase/functions/ resolves into
// _shared/, and `reconcile-payout-accounts` needs exactly this write. Extracting beats
// duplicating: two writers of the same three columns would have to be kept in step by hand, and
// the point of the reconcile is that Stripe is the source of truth for all three at once.
//
// stripe-webhook re-exports this as its W13 arm, so `handlers.test.ts` and the webhook's own
// surface are unchanged. Deliberately does NOT import ../_shared/stripe.ts — only type-level
// `npm:stripe` — for the same reason handlers.ts does not: so tests typecheck independently of
// the pinned-apiVersion/SDK-types drift in that module.

type Db = SupabaseClient;

/**
 * W13 — account.updated: maintain the payout_accounts cache (#245/#246) as Stripe walks the
 * Express account through KYC. Both directions on purpose: Stripe grants AND revokes
 * capabilities (new requirements past their deadline flip payouts_enabled back to false), and
 * #247's transfer gate must fail closed on the revocation, not just open on the grant.
 * Update-only, matched on stripe_account_id: the row is inserted by create-payout-onboarding,
 * so an unmatched id means the account is not ours or the profile was erased and the row
 * cascaded away — recreating it would resurrect a deleted profile's pointer. Ack either way.
 * Idempotent: a redelivery rewrites the same flags, and onboarded_at is guarded set-once.
 *
 * `eventAccountId` is the delivery's top-level `event.account` (#702). Stripe sets it on every
 * connected-account event, and only a «Connected accounts»-scoped endpoint receives one — which
 * is why this arm had never fired. For account.updated it equals `account.id`, so preferring it
 * changes nothing today; it is here because the event, not its data object, is what Stripe
 * guarantees names the account, and an arm keyed on the guarantee survives a re-scope.
 *
 * The reconcile path (#707) calls this with an account it RETRIEVED rather than one Stripe
 * pushed, and passes no eventAccountId — there is no event, so `account.id` is the only name
 * available and it is the right one.
 */
export async function handleAccountUpdated(
  db: Db,
  account: Stripe.Account,
  eventAccountId?: string,
): Promise<void> {
  const stripeAccountId = eventAccountId ?? account.id;
  const { error: updErr } = await db
    .from('payout_accounts')
    .update({
      charges_enabled: !!account.charges_enabled,
      payouts_enabled: !!account.payouts_enabled,
    })
    .eq('stripe_account_id', stripeAccountId);
  if (updErr) throw updErr;

  // onboarded_at means "when onboarding completed", not "last account event": stamp it on the
  // first event with details_submitted and never move it — the is-null guard makes replays
  // and later capability events no-ops here.
  //
  // On the reconcile path (#707) the stamp is the reconcile's clock, which can be days after the
  // onboarding it records — a row whose completion event was never delivered has no earlier time
  // available, and Stripe's Account object carries none. Every consumer reads this column as
  // null-vs-not-null (packages/api/src/payouts.ts, the composer's CTA), so the widened meaning
  // costs nothing today; it would matter the day something treats it as a date.
  if (account.details_submitted) {
    const { error: onbErr } = await db
      .from('payout_accounts')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('stripe_account_id', stripeAccountId)
      .is('onboarded_at', null);
    if (onbErr) throw onbErr;
  }
}
