// Major pinned to match the type-level import in stripe-webhook/handlers.ts —
// deno.lock is gitignored, so unpinned specifiers would float on every deploy.
import Stripe from 'npm:stripe@22';
import { denoEnv, type EnvPort } from './keys.ts';

/**
 * Pinned API version — must match the Dashboard webhook endpoint (08 §4.1). Never float it.
 *
 * It EQUALLED the SDK's own latest when it was set (stripe@22.2.2, 2026-08-07); the SDK has
 * since moved past it — 22.4.0 and 22.5.0 both top out at `2026-07-29.dahlia` — so this
 * constant now sits behind the library, and `stripeClient` casts to say that is on purpose.
 *
 * Advancing it is NOT the fix for that type error. The endpoint carries a version too, so
 * moving this without re-creating the Dashboard webhook endpoint at the same version changes
 * event payload shapes underneath the signature check — the incident this constant exists to
 * prevent. The endpoint is deploy-deferred (RELEASE-RUNBOOK §4.2) and must be created at
 * exactly this version.
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
 * Env is injectable through _shared/keys.ts's port, so tests say nothing about which secrets
 * this machine happens to hold. The client is memoized per env port, so the production path
 * still builds exactly one client per isolate — same client, same config, one construction.
 *
 * stripe-webhook is the one consumer that still resolves at import; its index.ts says why.
 */
const clients = new WeakMap<EnvPort, Stripe>();

/** The SDK's own config type, derived from the constructor so a rename cannot strand it. */
type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>;

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
      'STRIPE_SECRET_KEY is not set in this edge function environment. Every consumer but ' +
        'stripe-webhook resolves the client on first use, so this normally surfaces at the ' +
        'first Stripe call rather than at boot.',
    );
  }
  const built = new Stripe(key, {
    // The pin is DELIBERATELY older than the SDK's default, and stripe-node types `apiVersion`
    // as the single literal that its own release defaults to — so under any newer stripe@22
    // this assignment is a type error by construction. CI is where that bites: `deno.lock` is
    // gitignored (.gitignore:55), so a local run pins stripe@22.2.2 while CI resolves the
    // newest 22.x and types the field as a later version. It stayed invisible until #541,
    // because no test imported this module and the constructor was never type-checked.
    // Casting is the right answer, not floating the pin: the version must match the Dashboard
    // webhook endpoint (08 §4.1) or event payload shapes change under the signature check, and
    // stripe.test.ts asserts the exact string this passes.
    apiVersion: STRIPE_API_VERSION as unknown as StripeConfig['apiVersion'],
  });
  clients.set(env, built);
  return built;
}

/** The two Circle Price ids, by plan. `undefined` where the variable is unset or blank. */
export type CirclePriceIds = { monthly?: string; annual?: string };

/**
 * The Circle Price ids the app quotes AND charges — one resolver for both (#674 item 9).
 *
 * `get-circle-prices` and `create-circle-checkout` used to read `STRIPE_PRICE_CIRCLE_MONTHLY`
 * / `_ANNUAL` each with its own pair of `Deno.env.get` calls, so a name typo in one function
 * would have the app quote one Price and Checkout charge another, both functions individually
 * green. The names live here once; a blank value reads as unset so an empty secret is the
 * same «price not configured» as a missing one, never an empty-string id sent to Stripe.
 * RELEASE-RUNBOOK §4.2's cutover table cites this as the single read site.
 */
export function circlePriceIds(env: EnvPort = denoEnv): CirclePriceIds {
  const read = (name: string): string | undefined => {
    const v = env.get(name);
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
  };
  return {
    monthly: read('STRIPE_PRICE_CIRCLE_MONTHLY'),
    annual: read('STRIPE_PRICE_CIRCLE_ANNUAL'),
  };
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
