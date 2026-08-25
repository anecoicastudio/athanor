// Major pinned to match the type-level import in stripe-webhook/handlers.ts —
// deno.lock is gitignored, so unpinned specifiers would float on every deploy.
import Stripe from 'npm:stripe@22';
import type { EnvPort } from './keys.ts';

/**
 * Pinned API version — must match the Dashboard webhook endpoint (08 §4.1). Never float it.
 * Aligned with the stripe@22 SDK's pinned version (2026-08-07); the Dashboard webhook
 * endpoint is deploy-deferred (RELEASE-RUNBOOK §4.2) and must be created at this version.
 */
export const STRIPE_API_VERSION = '2026-05-27.dahlia';

/**
 * Nothing in this module runs at import time (#541).
 *
 * It used to hold `export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, …)`,
 * so importing it read the secret. release-fund-payout is internal, and rule 8 gives an
 * internal function exactly one gate with nothing in front of it — but an import runs before
 * the handler, so on the isolate's cold start that read happened ahead of
 * `requireServiceRole(req)`. (Once per isolate, not once per request: a module is evaluated
 * on first import and every warm request reuses it.) Deferring the read to first use puts it
 * back behind the gate, because every consumer dereferences the client inside a capability
 * closure that only runs once its own gate has passed.
 *
 * Env is injectable, like _shared/keys.ts, so tests say nothing about which secrets this
 * machine happens to hold. The client is memoized per env port, so the production path still
 * builds exactly one client per isolate — same client, same config, one construction.
 */
const denoEnv: EnvPort = { get: (name) => Deno.env.get(name) };

const clients = new WeakMap<EnvPort, Stripe>();

/** The Stripe client, built on first use and memoized. Throws if the secret is absent. */
export function stripeClient(env: EnvPort = denoEnv): Stripe {
  const memo = clients.get(env);
  if (memo) return memo;
  const key = env.get('STRIPE_SECRET_KEY');
  if (typeof key !== 'string' || key.trim() === '') {
    // Named explicitly. The SDK's own failure is «Neither apiKey nor config.authenticator
    // provided», which reads like an SDK misuse rather than an unset secret — and in
    // stripe-webhook it would surface through handleWebhook's signature catch as a plain
    // «bad signature» 400, sending the operator after the wrong secret entirely.
    throw new Error(
      'STRIPE_SECRET_KEY is not set in this edge function environment. It is read on first ' +
        'use, not at import, so this surfaces at the first Stripe call rather than at boot.',
    );
  }
  const built = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  clients.set(env, built);
  return built;
}

type SubtleCryptoProvider = ReturnType<typeof Stripe.createSubtleCryptoProvider>;

let subtleCrypto: SubtleCryptoProvider | undefined;

/**
 * Web Crypto provider — required for the async webhook signature check in Deno.
 * Reads no env, so it was never a rule-8 problem; it is lazy for the same reason the client
 * is, so that «this module does no work at import time» holds without an exception to check.
 */
export function cryptoProvider(): SubtleCryptoProvider {
  return (subtleCrypto ??= Stripe.createSubtleCryptoProvider());
}
