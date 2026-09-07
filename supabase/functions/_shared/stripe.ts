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

/**
 * A variable's value, or `undefined` when it is unset OR blank.
 *
 * A declared-but-empty secret is what an un-provisioned one looks like on a hosted project, and
 * every consumer here wants the same answer for both: «not configured», never an empty string
 * handed to Stripe as if it were an id or a key.
 *
 * The value is returned TRIMMED, not merely tested trimmed. A secret pasted into the Supabase
 * secrets UI with a trailing newline is set, so no «unset» warning fires, and it is non-blank, so
 * it is used verbatim as the HMAC key — every delivery then fails verification and answers an
 * unlogged 400 for the three days Stripe keeps retrying, against a secret that looks correct in
 * the dashboard. The SDK detects the same hazard (`secretContainsWhitespace`) and can only warn
 * about it after the fact. A price id pasted the same way fails `prices.retrieve` instead (#644).
 */
const nonBlank = (env: EnvPort, name: string): string | undefined => {
  const v = env.get(name);
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
};

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
  return {
    monthly: nonBlank(env, 'STRIPE_PRICE_CIRCLE_MONTHLY'),
    annual: nonBlank(env, 'STRIPE_PRICE_CIRCLE_ANNUAL'),
  };
}

/** The two webhook signing secrets, by endpoint scope. `undefined` where unset or blank. */
export type WebhookSigningSecrets = {
  /** The «Your account» endpoint: Checkout, Billing, Identity, charges, transfers. */
  platform?: string;
  /** The «Connected accounts» endpoint: v1 `account.updated` and every connected-account event. */
  connect?: string;
};

/**
 * Both signing secrets `stripe-webhook` answers for (#702).
 *
 * A Stripe endpoint's scope is set once, at creation, by the `connect` flag — «Your account» or
 * «Connected accounts» — and a connected account's v1 `account.updated` is delivered ONLY to the
 * second kind. One URL can therefore back two endpoints, and a signing secret is per-endpoint, so
 * serving both scopes means holding two secrets. That is why W13 had never fired: the arm was
 * correct, the event never arrived.
 *
 * Neither is required. An unset secret is not fatal here — it simply cannot verify its own scope's
 * deliveries, exactly as a missing `STRIPE_WEBHOOK_SECRET` has always meant «400, nothing written»
 * (RELEASE-RUNBOOK §4.2). Making the Connect secret boot-fatal instead would 500 every event —
 * platform arms included — on any project that lacks it, and handlers.ts names sustained 5xx as
 * the P0 that gets the whole endpoint disabled. index.ts warns once at cold start instead.
 */
export function webhookSigningSecrets(env: EnvPort = denoEnv): WebhookSigningSecrets {
  return {
    platform: nonBlank(env, 'STRIPE_WEBHOOK_SECRET'),
    connect: nonBlank(env, 'STRIPE_CONNECT_WEBHOOK_SECRET'),
  };
}

/**
 * Verify one delivery against every signing secret this deployment holds, in order.
 *
 * The secret CANNOT be chosen by looking at the payload: a top-level `account` field is what marks
 * a connected-account event, and reading it before the signature check would be trusting exactly
 * the bytes under test. So each configured secret is tried until one verifies — an HMAC apiece,
 * and the platform secret first because platform events are the overwhelming majority.
 *
 * A secret that is unset or blank is skipped rather than tried, so an absent Connect secret costs
 * nothing and changes nothing for the platform arms. On a real mismatch the FIRST failure is
 * rethrown — the platform secret's, which is the one an operator is almost always debugging.
 *
 * With none configured at all the throw is NAMED, but do not mistake that for a signal an operator
 * will see. Unlike `stripeClient`, which throws at module scope and so lands in the boot log, this
 * throws per request into handleWebhook's bare catch, which answers «bad signature» 400 and logs
 * nothing. The name is there for a reader with a stack trace and for any future logged path; what
 * actually tells the operator is the cold-start `console.warn` pair in stripe-webhook/index.ts.
 */
export async function verifyWithAnySecret(
  verify: (secret: string) => Promise<Stripe.Event>,
  secrets: readonly (string | undefined)[],
): Promise<Stripe.Event> {
  // Blank is unset here too, not only in `nonBlank` above: this function is exported and a
  // whitespace-only secret is an un-provisioned one, never something to spend an HMAC on.
  const configured = secrets.filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  if (configured.length === 0) {
    throw new Error(
      'No Stripe webhook signing secret is set in this edge function environment: neither ' +
        'STRIPE_WEBHOOK_SECRET nor STRIPE_CONNECT_WEBHOOK_SECRET. Every delivery will 400.',
    );
  }
  const failures: unknown[] = [];
  for (const secret of configured) {
    try {
      return await verify(secret);
    } catch (e) {
      failures.push(e);
    }
  }
  throw failures[0];
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
