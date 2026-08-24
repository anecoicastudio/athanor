// Major pinned to match the type-level import in stripe-webhook/handlers.ts —
// deno.lock is gitignored, so unpinned specifiers would float on every deploy.
import Stripe from 'npm:stripe@22';

/**
 * Pinned API version — must match the Dashboard webhook endpoint (08 §4.1). Never float it.
 * Aligned with the stripe@22 SDK's pinned version (2026-08-07); the Dashboard webhook
 * endpoint is deploy-deferred (RELEASE-RUNBOOK §4.2) and must be created at this version.
 */
export const STRIPE_API_VERSION = '2026-05-27.dahlia';

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: STRIPE_API_VERSION,
});

/** Web Crypto provider — required for the async webhook signature check in Deno. */
export const cryptoProvider = Stripe.createSubtleCryptoProvider();
