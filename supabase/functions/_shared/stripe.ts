import Stripe from 'npm:stripe';

/** Pinned API version — must match the Dashboard webhook endpoint (08 §4.1). Never float it. */
export const STRIPE_API_VERSION = '2026-03-25.dahlia';

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: STRIPE_API_VERSION,
});

/** Web Crypto provider — required for the async webhook signature check in Deno. */
export const cryptoProvider = Stripe.createSubtleCryptoProvider();
