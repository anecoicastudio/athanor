import type Stripe from 'npm:stripe@22';
import { error, json } from '../_shared/respond.ts';

// Session construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// env + singleton wiring) and injects everything here (repo convention: DI over mocks).
// Deliberately does NOT import ../_shared/stripe.ts — only type-level `npm:stripe` —
// so tests typecheck without STRIPE_SECRET_KEY in the env.

export type VerificationSessionCtx = {
  /** stripe.identity.verificationSessions.create — the only outbound call; no charge */
  createVerificationSession: (
    params: Stripe.Identity.VerificationSessionCreateParams,
  ) => Promise<Stripe.Identity.VerificationSession>;
  /** APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
};

export type VerificationSessionInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
};

/**
 * Pure params builder. `profile_id` in metadata is what webhook W9 reads back to write the
 * verifications row and flip profiles.identity_verified — so it must come from getUser(),
 * never from the request body (rule #8).
 */
export function buildVerificationSessionParams(
  profileId: string,
  appBase: string,
): Stripe.Identity.VerificationSessionCreateParams {
  return {
    type: 'document',
    metadata: { profile_id: profileId },
    return_url: `${appBase}verify?status=complete`,
  };
}

/**
 * Creates a Stripe Identity VerificationSession and returns its hosted URL. Writes nothing:
 * the verifications row and the profiles.identity_verified flip are the webhook's job (W9),
 * never this function's (rule #6 — money and trust state is a cache of Stripe webhooks).
 */
export async function createVerificationSession(
  ctx: VerificationSessionCtx,
  input: VerificationSessionInput,
): Promise<Response> {
  try {
    const session = await ctx.createVerificationSession(
      buildVerificationSessionParams(input.profileId, ctx.appBase),
    );
    // Stripe types url as nullable; handing the app a null would surface as a tap that
    // silently does nothing rather than an error anyone can act on.
    if (!session.url) return error('could not start verification', 500);
    return json({ url: session.url });
  } catch {
    return error('could not start verification', 500);
  }
}
