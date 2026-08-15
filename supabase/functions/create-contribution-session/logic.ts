import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';

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
  amountCents: number;
};

/** Server-side floor (rule #10 / PRD §4.11): integer minor units, ≥ €1, no max. */
export function isValidContributionAmount(amountCents: number): boolean {
  return Number.isInteger(amountCents) && amountCents >= 100;
}

/**
 * Phases that accept contributions (D34 / PRD §4.11): from cycle open through closure,
 * realization included — post-snapshot money lands in the same cycle and carries forward.
 * Anything not listed (`closed`, or a phase this build does not know) refuses before
 * Stripe is ever called — money code fails closed.
 */
export const CONTRIBUTION_OPEN_PHASES: readonly string[] = [
  'candidacy',
  'screening',
  'voting',
  'announcement',
  'realization',
];

/**
 * Pure params builder. The amount is the SERVER-VALIDATED value (never Stripe-trusted
 * blindly); metadata.kind routes the shared webhook (W3); profile_id is the verified caller.
 */
export function buildContributionSessionParams(
  editionId: string,
  amountCents: number,
  profileId: string,
  appBase: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amountCents, // minor units, server-validated
          product_data: { name: 'Dai Vita al Tuo Sogno — contributo' },
        },
      },
    ],
    // Webhook routing (W3) keys on metadata.kind. profile_id is the verified caller, never the body.
    metadata: { kind: 'contribution', edition_id: editionId, profile_id: profileId },
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
  const { profileId, editionId, amountCents } = input;

  // Server-side floor (rule #10 / PRD §4.11): never trust the client amount; ≥ €1, no max.
  if (!isValidContributionAmount(amountCents)) return error('amount must be at least €1', 400);

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
      buildContributionSessionParams(edition.id, amountCents, profileId, appBase),
    );
    if (!session.url) return error('could not start checkout', 500);
    return json({ url: session.url });
  } catch {
    return error('could not start checkout', 500);
  }
}
