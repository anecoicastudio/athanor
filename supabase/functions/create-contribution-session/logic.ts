import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';

// Contribution-session construction extracted from index.ts so it is unit-testable
// (deno test): index.ts keeps the transport shell (OPTIONS/method guard, requireUser,
// version gate, body parse, env + singleton wiring) and injects everything here (repo
// convention: DI over mocks). Deliberately does NOT import ../_shared/stripe.ts — only
// type-level `npm:stripe` — so tests typecheck without STRIPE_SECRET_KEY in the env.

export type ContributionSessionCtx = {
  /** the caller's own client — fund editions are public reads */
  userClient: SupabaseClient;
  /** stripe.checkout.sessions.create — the only outbound Stripe call */
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
  ) => Promise<Stripe.Checkout.Session>;
  /** APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
};

export type ContributionSessionInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
  editionId: string;
  /** THE GIFT — the money the fund receives. Never the charge; the floor applies here. */
  amountCents: number;
  /**
   * #236: whether the payer chose to also cover Stripe's processing. A flag, never a figure —
   * the gross-up below is the server's, so the number shown on the disclosure screen is
   * display only. Arrives from `req.json()` and is therefore untyped at runtime: only
   * literal `true` is consent (see coverageRequested).
   */
  coverFees?: boolean;
};

/**
 * The €1 minimum (PRD §4.11). A named constant, never a scattered literal.
 *
 * DUPLICATED, deliberately, exactly as the Stripe rate constants below are:
 * `packages/schemas/src/fund.ts` declares this same number for every TypeScript caller — the
 * zod schema, `@athanor/core`'s parser, the screens — but `supabase/functions` lives outside
 * the pnpm workspace and cannot import a workspace package. The DB CHECK in
 * `20260618153032_m7_contributions.sql` is the third copy and the last line of defence.
 *
 * The three are kept honest by pinning the identical value on each side under a named test:
 * `logic.test.ts` here, `fund.test.ts` in schemas, pgTAP `0118_fund_fee_coverage` for the
 * CHECK. Change one, change all three (#387).
 */
export const MIN_CONTRIBUTION_CENTS = 100;

/** Server-side floor (PRD §4.11): integer minor units, ≥ €1, no max. */
export function isValidContributionAmount(amountCents: number): boolean {
  return Number.isInteger(amountCents) && amountCents >= MIN_CONTRIBUTION_CENTS;
}

/**
 * Stripe's EU standard rate for European cards: 1.5% + €0,25. Named constants, one place.
 *
 * DUPLICATED, deliberately: `packages/core/src/fund/fees.ts` carries the same two constants
 * and the same formula for the disclosure screen's preview. `supabase/functions` lives
 * outside the pnpm workspace and cannot import @athanor/core, so there is no shared module
 * to reach for. THIS copy is the authority — the server recomputes and the client is never
 * trusted — and the two are kept honest by asserting identical fixtures on both sides
 * (logic.test.ts and fees.test.ts). Change one, change both.
 */
export const STRIPE_FEE_BPS = 150;
export const STRIPE_FEE_FIXED_CENTS = 25;

export type FeeCoverage = {
  giftCents: number;
  coverageCents: number;
  /** what the card is charged = Stripe's amount_total */
  chargedCents: number;
};

/**
 * Gross up a gift so the fund nets it whole after Stripe's cut (FUND-51).
 *
 * The cut is a percentage of the CHARGE, not of the gift, so the equation is recursive:
 * `charged - (charged·pct + fixed) >= gift`  ⟹  `charged = ceil((gift + fixed) / (1 - pct))`.
 * Adding `gift·pct + fixed` instead leaves the fund short by the percentage of the fee itself.
 * Rounds UP to the cent, by at most one: the alternative hands the last cent to whichever way
 * Stripe rounds its own fee. Integer arithmetic — a cents value must never reach a payment
 * boundary carrying a binary-fraction artifact.
 *
 * Callers must have passed isValidContributionAmount first; this is not a validator.
 */
export function feeCoverage(giftCents: number): FeeCoverage {
  const numerator = (giftCents + STRIPE_FEE_FIXED_CENTS) * 10_000;
  const denominator = 10_000 - STRIPE_FEE_BPS;
  const chargedCents = Math.floor(numerator / denominator) + (numerator % denominator > 0 ? 1 : 0);
  return { giftCents, coverageCents: chargedCents - giftCents, chargedCents };
}

/**
 * Only literal `true` is consent. The flag comes off `req.json()`, so at runtime it can be
 * a string, a number or an object; truthy-coercion would let `'false'` or `1` charge a payer
 * more than the amount they chose. CRD 2011/83/EU Art. 22 wants an express choice, and money
 * code fails closed — anything that is not exactly `true` means the box was not ticked.
 */
function coverageRequested(coverFees: unknown): boolean {
  return coverFees === true;
}

/**
 * Phases that accept contributions (D34 / PRD §4.11): from cycle open through closure,
 * realization included — post-snapshot money lands in the same cycle and carries forward.
 * Anything not listed (`closed`, or a phase this build does not know) refuses before
 * Stripe is ever called — money code fails closed.
 *
 * DUPLICATED, deliberately, exactly as the constants above are: `@athanor/core`'s
 * `CONTRIBUTION_PHASES` derives the same five values from the zod enum for every TypeScript
 * caller, and `supabase/functions` is outside the pnpm workspace with no import path to it.
 * The two are kept honest by a mirror test in `logic.test.ts` that reads
 * `packages/schemas/src/fund.ts` off disk and fails if the vocabulary drifts (#382, the
 * `config-invariants` idiom).
 */
export const CONTRIBUTION_OPEN_PHASES: readonly string[] = [
  'candidacy',
  'screening',
  'voting',
  'announcement',
  'realization',
];

/**
 * Pure params builder. The gift is the SERVER-VALIDATED value (never Stripe-trusted blindly)
 * and the coverage is SERVER-COMPUTED (#236); metadata.kind routes the shared webhook (W3);
 * profile_id is the verified caller.
 *
 * A covered contribution is TWO line items, not one grossed-up total: the payer's own Stripe
 * receipt then shows the gift and the coverage separately, which is what «the deduction is
 * disclosed» has to mean once they have paid. The uncovered path is unchanged.
 *
 * metadata carries both figures because the webhook reconciles them against Stripe's
 * amount_total before writing the row — Stripe stays the source of truth (rule #6), and our
 * split has to add up to its number or the row is refused.
 */
export function buildContributionSessionParams(
  editionId: string,
  giftCents: number,
  coverageCents: number,
  profileId: string,
  appBase: string,
): Stripe.Checkout.SessionCreateParams {
  const lineItem = (unitAmount: number, name: string) => ({
    quantity: 1,
    price_data: {
      currency: 'eur',
      unit_amount: unitAmount, // minor units, server-validated
      product_data: { name },
    },
  });
  return {
    mode: 'payment',
    line_items:
      coverageCents > 0
        ? [
            lineItem(giftCents, 'Dai Vita al Tuo Sogno — contributo'),
            lineItem(coverageCents, 'Dai Vita al Tuo Sogno — copertura costi di pagamento'),
          ]
        : [lineItem(giftCents, 'Dai Vita al Tuo Sogno — contributo')],
    // Webhook routing (W3) keys on metadata.kind. profile_id is the verified caller, never the body.
    metadata: {
      kind: 'contribution',
      edition_id: editionId,
      profile_id: profileId,
      gift_cents: String(giftCents),
      coverage_cents: String(coverageCents),
    },
    success_url: `${appBase}annual?contrib=success`,
    cancel_url: `${appBase}annual?contrib=cancel`,
  };
}

/**
 * Gates in order: amount floor (≥ €1, integer) → edition exists → contributions_enabled
 * re-asserted (the app shouldn't have called when off) → contribution window (D34: open
 * phases only). The contribution row + aggregate are written by the webhook (W3), never here.
 */
export async function createContributionSession(
  ctx: ContributionSessionCtx,
  input: ContributionSessionInput,
): Promise<Response> {
  const { userClient, createCheckoutSession, appBase } = ctx;
  const { profileId, editionId, amountCents, coverFees } = input;

  // Server-side floor (PRD §4.11): never trust the client amount; ≥ €1, no max.
  // The floor is on the GIFT: coverage may not lift a sub-€1 contribution over the line, so
  // this runs before any gross-up.
  if (!isValidContributionAmount(amountCents)) return error('amount must be at least €1', 400);

  // #236: recomputed here, never taken from the body. The screen showed the payer a figure;
  // this is the one that is charged, and the two agree because they run the same formula.
  const coverageCents = coverageRequested(coverFees) ? feeCoverage(amountCents).coverageCents : 0;

  // Load the edition (public read) and re-assert the legal flag — the app shouldn't have called when off.
  const { data: edition, error: edErr } = await userClient
    .from('fund_editions')
    .select('id,contributions_enabled,phase')
    .eq('id', editionId)
    .maybeSingle();
  if (edErr) return error('edition lookup failed', 500);
  if (!edition) return error('edition not found', 404);
  if (!edition.contributions_enabled) return error('contributions are not open', 403);
  // D34 window: a closed (or unknown) phase refuses before Stripe. These `{error}`
  // strings are the stable contract the screen maps to copy (#103 idiom) — a window
  // refusal must never read as a payment failure.
  if (!CONTRIBUTION_OPEN_PHASES.includes(edition.phase)) return error('the cycle is closed', 403);

  try {
    const session = await createCheckoutSession(
      buildContributionSessionParams(edition.id, amountCents, coverageCents, profileId, appBase),
    );
    if (!session.url) return error('could not start checkout', 500);
    return json({ url: session.url });
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure('create-contribution-session: checkout.sessions.create', e);
    return error('could not start checkout', 500);
  }
}
